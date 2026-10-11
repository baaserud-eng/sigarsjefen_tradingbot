/**
 * Kobling til Capital.com sitt API (https://open-api.capital.com).
 *
 * Demo:  https://demo-api-capital.backend-capital.com  (lekepenger)
 * Live:  https://api-capital.backend-capital.com       (ekte penger)
 *
 * Innlogging gir to tokens (CST og X-SECURITY-TOKEN) som sendes med på hvert kall.
 * Økten utløper etter 10 minutter uten aktivitet; da logger vi inn på nytt automatisk.
 */
import { capitalTime } from "../core/time.js";
import type { Candle } from "../strategy/orb.js";
import type { AccountInfo, Broker, MarketInfo, OpenPosition, OpenRequest } from "./types.js";

export interface CapitalConfig {
  env: "demo" | "live";
  apiKey: string;
  identifier: string;
  password: string;
}

interface PricePoint {
  snapshotTimeUTC?: string;
  snapshotTime?: string;
  openPrice: { bid: number; ask: number };
  highPrice: { bid: number; ask: number };
  lowPrice: { bid: number; ask: number };
  closePrice: { bid: number; ask: number };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const mid = (p: { bid: number; ask: number }) => (p.bid + p.ask) / 2;

export class CapitalBroker implements Broker {
  readonly base: string;
  private cst = "";
  private token = "";
  private lastCall = 0;
  private marketCache = new Map<string, { at: number; info: MarketInfo }>();

  constructor(private cfg: CapitalConfig) {
    this.base = cfg.env === "live" ? "https://api-capital.backend-capital.com" : "https://demo-api-capital.backend-capital.com";
  }

  async login(): Promise<void> {
    const res = await fetch(`${this.base}/api/v1/session`, {
      method: "POST",
      headers: { "content-type": "application/json", "X-CAP-API-KEY": this.cfg.apiKey },
      body: JSON.stringify({ identifier: this.cfg.identifier, password: this.cfg.password, encryptedPassword: false }),
    });
    if (!res.ok) {
      const text = (await res.text()).slice(0, 300);
      throw new Error(
        `Innlogging til Capital.com (${this.cfg.env}) feilet (${res.status}): ${text}. ` +
          "Sjekk CAPITAL_API_KEY, CAPITAL_IDENTIFIER (e-post) og CAPITAL_API_PASSWORD (passordet du valgte for API-nøkkelen) i .env.",
      );
    }
    this.cst = res.headers.get("CST") ?? "";
    this.token = res.headers.get("X-SECURITY-TOKEN") ?? "";
    if (!this.cst || !this.token) throw new Error("Capital.com svarte uten innloggings-tokens");
  }

  private async req<T>(method: string, path: string, opts: { body?: unknown; query?: Record<string, string | number> } = {}, retry = true): Promise<T> {
    // Capital.com tillater rundt 10 kall i sekundet. Vi holder oss godt under.
    const wait = this.lastCall + 150 - Date.now();
    if (wait > 0) await sleep(wait);
    this.lastCall = Date.now();
    if (!this.cst) await this.login();

    const url = new URL(this.base + path);
    for (const [k, v] of Object.entries(opts.query ?? {})) url.searchParams.set(k, String(v));
    const res = await fetch(url, {
      method,
      headers: {
        "content-type": "application/json",
        CST: this.cst,
        "X-SECURITY-TOKEN": this.token,
      },
      ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
    });

    if (res.status === 401 && retry) {
      await this.login();
      return this.req<T>(method, path, opts, false);
    }
    if (res.status === 429 && retry) {
      await sleep(1500);
      return this.req<T>(method, path, opts, false);
    }
    const text = await res.text();
    if (!res.ok) throw new Error(`Capital.com ${method} ${path} feilet (${res.status}): ${text.slice(0, 300)}`);
    return (text ? JSON.parse(text) : {}) as T;
  }

  async candles(epic: string, from: Date, to: Date, resolution = "MINUTE_5"): Promise<Candle[]> {
    const body = await this.req<{ prices?: PricePoint[] }>("GET", `/api/v1/prices/${encodeURIComponent(epic)}`, {
      query: { resolution, max: 1000, from: capitalTime(from), to: capitalTime(to) },
    });
    return (body.prices ?? []).map((p) => {
      const ts = p.snapshotTimeUTC ?? p.snapshotTime ?? "";
      return {
        t: Date.parse(ts.endsWith("Z") ? ts : ts + "Z"),
        o: mid(p.openPrice),
        h: mid(p.highPrice),
        l: mid(p.lowPrice),
        c: mid(p.closePrice),
        spread: Math.max(0, p.closePrice.ask - p.closePrice.bid),
      };
    });
  }

  async market(epic: string): Promise<MarketInfo> {
    const cached = this.marketCache.get(epic);
    if (cached && Date.now() - cached.at < 5_000) return cached.info;
    const body = await this.req<{
      instrument?: { epic?: string; name?: string; currency?: string };
      dealingRules?: { minDealSize?: { value?: number }; minSizeIncrement?: { value?: number } };
      snapshot?: { bid?: number; offer?: number; marketStatus?: string };
    }>("GET", `/api/v1/markets/${encodeURIComponent(epic)}`);
    const minSize = body.dealingRules?.minDealSize?.value ?? 1;
    const info: MarketInfo = {
      epic,
      name: body.instrument?.name ?? epic,
      currency: body.instrument?.currency ?? "USD",
      minSize,
      sizeStep: body.dealingRules?.minSizeIncrement?.value ?? minSize,
      bid: body.snapshot?.bid ?? 0,
      offer: body.snapshot?.offer ?? 0,
      tradeable: body.snapshot?.marketStatus === "TRADEABLE",
    };
    this.marketCache.set(epic, { at: Date.now(), info });
    return info;
  }

  async account(): Promise<AccountInfo> {
    const body = await this.req<{
      accounts?: { preferred?: boolean; currency?: string; balance?: { balance?: number; available?: number; profitLoss?: number } }[];
    }>("GET", "/api/v1/accounts");
    const acc = body.accounts?.find((a) => a.preferred) ?? body.accounts?.[0];
    if (!acc) throw new Error("Fant ingen konto hos Capital.com");
    return {
      balance: acc.balance?.balance ?? 0,
      available: acc.balance?.available ?? 0,
      profitLoss: acc.balance?.profitLoss ?? 0,
      currency: acc.currency ?? "USD",
    };
  }

  async positions(): Promise<OpenPosition[]> {
    const body = await this.req<{
      positions?: {
        position: { dealId: string; direction: "BUY" | "SELL"; size: number; level: number; stopLevel?: number; profitLevel?: number; upl?: number; createdDateUTC?: string };
        market: { epic: string };
      }[];
    }>("GET", "/api/v1/positions");
    return (body.positions ?? []).map(({ position: p, market: m }) => ({
      dealId: p.dealId,
      epic: m.epic,
      direction: p.direction,
      size: p.size,
      level: p.level,
      ...(p.stopLevel !== undefined ? { stopLevel: p.stopLevel } : {}),
      ...(p.profitLevel !== undefined ? { profitLevel: p.profitLevel } : {}),
      upl: p.upl ?? 0,
      createdAt: p.createdDateUTC ? (p.createdDateUTC.endsWith("Z") ? p.createdDateUTC : p.createdDateUTC + "Z") : new Date().toISOString(),
    }));
  }

  private async confirm(dealReference: string): Promise<{ dealId: string; level: number }> {
    for (let i = 0; i < 6; i++) {
      await sleep(400 + i * 300);
      try {
        const c = await this.req<{ dealStatus?: string; reason?: string; dealId?: string; level?: number; affectedDeals?: { dealId: string }[] }>(
          "GET",
          `/api/v1/confirms/${encodeURIComponent(dealReference)}`,
        );
        if (c.dealStatus === "REJECTED") throw new Error(`Ordren ble avvist av Capital.com: ${c.reason ?? "ukjent grunn"}`);
        if (c.dealStatus === "ACCEPTED") return { dealId: c.affectedDeals?.[0]?.dealId ?? c.dealId ?? dealReference, level: c.level ?? 0 };
      } catch (e) {
        if ((e as Error).message.startsWith("Ordren ble avvist")) throw e;
      }
    }
    throw new Error(`Fikk ikke bekreftelse på ordren (${dealReference}). Sjekk posisjonene i Capital.com-appen.`);
  }

  async open(r: OpenRequest): Promise<{ dealId: string; level: number }> {
    const res = await this.req<{ dealReference: string }>("POST", "/api/v1/positions", {
      body: {
        epic: r.epic,
        direction: r.direction,
        size: r.size,
        guaranteedStop: false,
        stopLevel: r.stopLevel,
        profitLevel: r.profitLevel,
      },
    });
    return this.confirm(res.dealReference);
  }

  async close(dealId: string): Promise<{ level?: number }> {
    const res = await this.req<{ dealReference: string }>("DELETE", `/api/v1/positions/${encodeURIComponent(dealId)}`);
    const c = await this.confirm(res.dealReference);
    return { level: c.level };
  }

  async fx(from: string, to: string): Promise<number> {
    if (from === to) return 1;
    try {
      const m = await this.market(`${from}${to}`);
      if (m.bid > 0) return (m.bid + m.offer) / 2;
    } catch {
      // prøv omvendt
    }
    const m = await this.market(`${to}${from}`);
    if (m.bid > 0) return 2 / (m.bid + m.offer);
    throw new Error(`Fant ikke valutakurs ${from}/${to}`);
  }
}
