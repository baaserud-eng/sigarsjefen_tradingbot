/**
 * Selve boten: én runde (tick) hvert LOOP_SECONDS.
 *
 *   konto og posisjoner -> dagsvakt -> for hvert marked:
 *     hent dagens 5-min lys -> evaluateDay() -> ved signal: størrelse -> ordre med stop og mål
 *     ved sesjonsslutt: lukk det som er åpent
 *
 * Stop-loss og mål sendes med ordren og ligger hos megleren, så posisjonen er
 * beskyttet selv om PC-en eller boten stopper.
 */
import { log } from "./core/logger.js";
import { hhmm, nyParts, nyToDate, osloClock } from "./core/time.js";
import type { MarketDef } from "./markets.js";
import type { AccountInfo, Broker, OpenPosition } from "./broker/types.js";
import type { LearningMemory } from "./learn/memory.js";
import { describe } from "./learn/optimizer.js";
import { DayGuard, positionSize } from "./risk.js";
import { evaluateDay, type OrbParams, type Phase, type Signal } from "./strategy/orb.js";

export interface BotSettings {
  riskPerTradePct: number;
  orb: OrbParams;
}

export interface MarketView {
  epic: string;
  name: string;
  futures: string;
  session: string; // i norsk tid
  phase: Phase;
  rangeHigh?: number;
  rangeLow?: number;
  last?: number;
  signal?: Signal;
  note?: string;
  /** Innstillingene læringen har valgt for markedet */
  learned?: string;
  learnedPaused?: boolean;
  riskMult?: number;
}

const PHASE_TEXT: Record<Phase, string> = {
  closed: "Stengt",
  before: "Venter på åpning",
  building: "Bygger range",
  watching: "Venter på breakout",
  signal: "Signal",
  done: "Ferdig for i dag",
  skipped: "Hoppet over i dag",
};
export const phaseText = (p: Phase) => PHASE_TEXT[p];

export class Bot {
  paused = false;
  account: AccountInfo | null = null;
  positions: OpenPosition[] = [];
  views = new Map<string, MarketView>();
  private known = new Map<string, OpenPosition>();
  private noted = new Set<string>();
  private prevBalance: number | null = null;

  constructor(
    private broker: Broker,
    private guard: DayGuard,
    private markets: MarketDef[],
    private s: BotSettings,
    private now: () => number = () => Date.now(),
    private memory?: LearningMemory,
  ) {}

  /** Strategi-innstillingene for et marked: standard, eller det læringen har valgt. */
  paramsFor(epic: string): OrbParams {
    return this.memory ? { ...this.s.orb, ...this.memory.market(epic).tunable } : this.s.orb;
  }

  equity(): number {
    if (!this.account) return 0;
    return this.account.balance + this.positions.reduce((sum, p) => sum + p.upl, 0);
  }

  /** Logg en melding bare én gang per dag og nøkkel, så loggen ikke fylles opp. */
  private once(key: string, fn: () => void) {
    const k = `${this.guard.state.date}:${key}`;
    if (this.noted.has(k)) return;
    this.noted.add(k);
    fn();
  }

  async tick(): Promise<void> {
    const now = this.now();
    const ny = nyParts(now);

    this.account = await this.broker.account();
    this.positions = await this.broker.positions();
    this.detectClosed();

    if (this.guard.update(ny.date, this.equity())) {
      log("halt", `Dagstap-grensen er nådd (${this.guard.dayPnl(this.equity()).toFixed(2)} ${this.account.currency}). Ingen nye handler før neste handelsdag.`);
    }

    for (const m of this.markets) {
      try {
        await this.handleMarket(m, now, ny);
      } catch (e) {
        log("error", `${m.epic}: ${(e as Error).message}`, { epic: m.epic });
      }
    }
  }

  /** Posisjoner som har forsvunnet siden sist er stengt (stop, mål eller manuelt). */
  private detectClosed() {
    const current = new Set(this.positions.map((p) => p.dealId));
    const closed = [...this.known.entries()].filter(([id]) => !current.has(id));
    const balance = this.account?.balance ?? 0;
    // Lukkes én posisjon, er endringen i saldo det faktiske resultatet. Ellers bruker vi siste kjente verdi.
    const balanceDelta = this.prevBalance !== null && closed.length === 1 ? balance - this.prevBalance : null;
    for (const [id, p] of closed) {
      this.known.delete(id);
      const cur = this.account?.currency ?? "";
      const pnl = balanceDelta ?? p.upl;
      const win = pnl >= 0;
      const how = p.profitLevel !== undefined && win ? "mål nådd" : p.stopLevel !== undefined && !win ? "stop-loss" : "stengt";
      const r = this.memory?.recordClose(id, pnl) ?? null;
      log(win ? "sell" : "stop", `${p.epic} ${p.direction === "BUY" ? "long" : "short"} lukket (${how}) · ${balanceDelta === null ? "ca. " : ""}${win ? "+" : ""}${pnl.toFixed(2)} ${cur}${r !== null ? ` (${r >= 0 ? "+" : ""}${r}R)` : ""}`, {
        epic: p.epic,
        dealId: id,
        pnl,
        ...(r !== null ? { r } : {}),
      });
    }
    for (const p of this.positions) this.known.set(p.dealId, p);
    this.prevBalance = balance;
  }

  private async handleMarket(m: MarketDef, now: number, ny: ReturnType<typeof nyParts>) {
    const open = hhmm(m.open);
    const close = hhmm(m.close);
    const flatAt = close - this.s.orb.flatBeforeCloseMinutes;
    const view: MarketView = this.views.get(m.epic) ?? {
      epic: m.epic,
      name: m.name,
      futures: m.futures,
      session: "",
      phase: "closed",
    };
    view.session = `${osloClock(nyToDate(ny.date, open))}–${osloClock(nyToDate(ny.date, close))}`;
    if (this.memory) {
      const mem = this.memory.market(m.epic);
      view.learned = describe(mem.tunable);
      view.learnedPaused = mem.paused;
      view.riskMult = this.memory.risk(m.epic).mult;
    }
    this.views.set(m.epic, view);

    const mine = this.positions.filter((p) => p.epic === m.epic);

    // Lukk alt før sesjonsslutt, også om boten startet sent.
    if (mine.length && ny.minutes >= flatAt) {
      for (const p of mine) {
        log("info", `${m.epic}: sesjonen er snart slutt, lukker posisjonen`, { epic: m.epic });
        await this.broker.close(p.dealId);
      }
    }

    const weekend = ny.weekday === 0 || ny.weekday === 6;
    if (weekend || ny.minutes >= flatAt) {
      Object.assign(view, { phase: weekend ? "closed" : "done", note: undefined, signal: undefined });
      if (weekend) {
        delete view.rangeHigh;
        delete view.rangeLow;
      }
      return;
    }
    if (ny.minutes < open) {
      Object.assign(view, { phase: "before", note: undefined, signal: undefined });
      delete view.rangeHigh;
      delete view.rangeLow;
      return;
    }

    const candles = await this.broker.candles(m.epic, nyToDate(ny.date, open), new Date(now));
    const params = this.paramsFor(m.epic);
    const ev = evaluateDay(candles, m, params, now);
    view.phase = ev.phase;
    view.rangeHigh = ev.rangeHigh;
    view.rangeLow = ev.rangeLow;
    view.signal = ev.signal;
    view.note = ev.note;
    const last = candles[candles.length - 1];
    if (last) view.last = last.c;

    if (ev.phase === "skipped" && ev.note) this.once(`skip:${m.epic}`, () => log("info", `${m.epic}: hopper over i dag. ${ev.note}.`, { epic: m.epic }));
    if (ev.phase === "building" && ev.rangeHigh === undefined) return;
    if (!ev.signal) return;

    const sig = ev.signal;
    this.once(`signal:${m.epic}`, () =>
      log("signal", `${m.epic}: breakout ${sig.direction === "BUY" ? "opp" : "ned"} · range ${fmt(ev.rangeLow!)}–${fmt(ev.rangeHigh!)} · lukket ${fmt(sig.ref)}`, {
        epic: m.epic,
        direction: sig.direction,
      }),
    );

    if (mine.length) return;
    const mem = this.memory?.market(m.epic);
    if (mem?.paused) return this.once(`learnpause:${m.epic}`, () => log("risk_block", `${m.epic}: signal ignorert. Læringen har satt markedet på pause: ${mem.reason}`, { epic: m.epic }));
    if (this.paused) return this.once(`paused:${m.epic}`, () => log("risk_block", `${m.epic}: signal ignorert fordi kjøp er pauset`, { epic: m.epic }));

    const can = this.guard.canTrade(m.epic);
    if (!can.ok) {
      if (can.reason !== "Allerede handlet i dag") this.once(`block:${m.epic}`, () => log("risk_block", `${m.epic}: ikke handlet. ${can.reason}.`, { epic: m.epic }));
      return;
    }

    // Var boten av da signalet kom? Da er det for sent å hoppe på.
    const barMs = this.s.orb.barMinutes * 60_000;
    if (now - (sig.at + barMs) > 2 * barMs) {
      this.guard.markTraded(m.epic);
      log("risk_block", `${m.epic}: signalet kom for over ${2 * this.s.orb.barMinutes} minutter siden. For sent å gå inn nå.`, { epic: m.epic });
      return;
    }

    await this.enter(m, sig, params);
  }

  private async enter(m: MarketDef, sig: Signal, params: OrbParams) {
    const acc = this.account!;
    const info = await this.broker.market(m.epic);
    if (!info.tradeable) {
      this.once(`closed:${m.epic}`, () => log("risk_block", `${m.epic}: markedet er stengt hos Capital.com akkurat nå`, { epic: m.epic }));
      return;
    }
    const long = sig.direction === "BUY";
    const entry = long ? info.offer : info.bid;
    const dist = long ? entry - sig.stop : sig.stop - entry;
    if (dist <= 0) {
      this.guard.markTraded(m.epic);
      log("risk_block", `${m.epic}: prisen er allerede tilbake forbi stop-nivået. Hopper over.`, { epic: m.epic });
      return;
    }
    const target = long ? entry + params.rewardRisk * dist : entry - params.rewardRisk * dist;
    const dp = decimalsOf(info.bid, info.offer);

    const fx = await this.broker.fx(info.currency, acc.currency);
    const riskAdj = this.memory?.risk(m.epic) ?? { mult: 1, reason: "" };
    const sized = positionSize({
      balance: acc.balance,
      riskPct: this.s.riskPerTradePct * riskAdj.mult,
      stopDistance: dist,
      fxToAccount: fx,
      minSize: info.minSize,
      sizeStep: info.sizeStep,
    });
    if (sized.size === 0) {
      this.guard.markTraded(m.epic);
      log("risk_block", `${m.epic}: ${"reason" in sized ? sized.reason : "for liten størrelse"}`, { epic: m.epic });
      return;
    }

    // Marker før ordren sendes: feiler bekreftelsen, skal vi aldri risikere dobbel ordre.
    this.guard.markTraded(m.epic);
    try {
      const res = await this.broker.open({
        epic: m.epic,
        direction: sig.direction,
        size: sized.size,
        stopLevel: round(sig.stop, dp),
        profitLevel: round(target, dp),
      });
      // Følg posisjonen fra første stund, så den fanges opp selv om den stenges før neste runde.
      this.known.set(res.dealId, {
        dealId: res.dealId,
        epic: m.epic,
        direction: sig.direction,
        size: sized.size,
        level: res.level || entry,
        stopLevel: round(sig.stop, dp),
        profitLevel: round(target, dp),
        upl: 0,
        createdAt: new Date(this.now()).toISOString(),
      });
      if ("riskAccount" in sized && this.memory) {
        this.memory.recordOpen(res.dealId, {
          epic: m.epic,
          direction: sig.direction,
          riskAccount: sized.riskAccount,
          tunable: this.memory.market(m.epic).tunable,
          openedAt: new Date(this.now()).toISOString(),
        });
      }
      log("buy", `${m.epic} ${long ? "LONG" : "SHORT"} ${sized.size} @ ${fmt(res.level || entry)} · stop ${fmt(sig.stop)} · mål ${fmt(target)} · risiko ca. ${"riskAccount" in sized ? sized.riskAccount.toFixed(2) : "?"} ${acc.currency}${riskAdj.mult < 1 ? ` (halv risiko etter ${riskAdj.reason})` : ""}`, {
        epic: m.epic,
        direction: sig.direction,
        size: sized.size,
        entry: res.level || entry,
        stop: sig.stop,
        target,
        dealId: res.dealId,
      });
    } catch (e) {
      log("error", `${m.epic}: ordren feilet: ${(e as Error).message}`, { epic: m.epic });
    }
  }

  /** Lukk en posisjon med en gang (knappen på dashboardet). */
  async closeNow(dealId: string): Promise<boolean> {
    const p = this.positions.find((x) => x.dealId === dealId);
    if (!p) return false;
    await this.broker.close(dealId);
    return true;
  }
}

const round = (n: number, dp: number) => Number(n.toFixed(dp));
/** Antall desimaler megleren bruker for prisen (maks 5) */
const decimalsOf = (...xs: number[]) => Math.min(5, Math.max(1, ...xs.map((x) => (String(x).split(".")[1] ?? "").length)));
const fmt = (n: number) => (Math.abs(n) >= 1000 ? n.toFixed(1) : n.toFixed(2));
