import type { Config } from "./config.js";
import { log } from "./core/logger.js";
import { SOL_MINT, type Swapper } from "./exec/types.js";
import type { RiskManager } from "./risk/riskManager.js";
import type { SafetyResult } from "./safety/score.js";

const LAMPORTS = 1_000_000_000;
/** Anslått kostnad per swap i DRY_RUN (nettverksgebyr + priority fee), så simuleringen ikke blir for optimistisk */
const PAPER_FEE_SOL = 0.0003;
/** Antall feilede prisforsøk på rad før en posisjon regnes som tapt (typisk rug: ingen pool igjen) */
const MAX_PRICE_FAILURES = 6;

export type SellReason = "stop-loss" | "take-profit" | "tidsgrense" | "ingen pris" | "manuelt";

export interface Valuation {
  valueSol: number;
  pnlPct: number;
  at: string;
}

export interface TraderDeps {
  cfg: Config;
  risk: RiskManager;
  swapper: Swapper;
  checkSafety: (mint: string) => Promise<SafetyResult>;
  /** Faktisk SOL i walleten (LIVE). Brukes ikke i DRY_RUN. */
  walletBalanceSol: () => Promise<number>;
  now?: () => Date;
}

export class Trader {
  private priceFailures = new Map<string, number>();
  private busy = new Set<string>();
  private now: () => Date;
  /** Siste verdi for hver åpen posisjon, vises på dashboardet */
  readonly valuations = new Map<string, Valuation>();
  /** Når true kjøper ikke boten nye tokens, men passer fortsatt på åpne posisjoner */
  paused = false;

  constructor(private d: TraderDeps) {
    this.now = d.now ?? (() => new Date());
  }

  /** Saldo i SOL. I DRY_RUN regnes den ut fra startsaldo, gevinst/tap og åpne posisjoner. */
  async balanceSol(): Promise<number> {
    const { cfg, risk } = this.d;
    if (!cfg.DRY_RUN) return this.d.walletBalanceSol();
    const open = risk.state.openPositions.reduce((s, p) => s + p.sizeSol, 0);
    return cfg.PAPER_START_SOL + risk.state.totalRealizedPnlSol - open;
  }

  /** Vurder en ny token: sikkerhetssjekk, risikosjekk, og kjøp hvis alt er ok. */
  async consider(mint: string, source: string): Promise<"bought" | "rejected" | "blocked" | "error"> {
    const { cfg, risk, swapper } = this.d;
    if (this.busy.has(mint) || risk.state.openPositions.some((p) => p.mint === mint)) return "blocked";
    if (risk.state.halted || this.paused) return "blocked";
    this.busy.add(mint);
    try {
      const safety = await this.d.checkSafety(mint);
      const name = safety.symbol ? `$${safety.symbol}` : short(mint);
      if (!safety.passed) {
        const worst = safety.findings.find((f) => f.severity === "critical") ?? safety.findings[0];
        log(worst?.severity === "critical" ? "rug" : "safety", `${name} avvist · score ${safety.score} · ${worst?.reason ?? ""}`, { mint, source, score: safety.score, symbol: safety.symbol });
        return "rejected";
      }

      const available = (await this.balanceSol()) - cfg.MIN_SOL_RESERVE;
      const decision = risk.canOpen(mint, cfg.MAX_SOL_PER_TRADE, available);
      if (!decision.ok) {
        log("risk_block", `${name} godkjent (score ${safety.score}), men ikke kjøpt: ${decision.reason}`, { mint, source, score: safety.score, symbol: safety.symbol });
        return "blocked";
      }

      const lamports = BigInt(Math.floor(decision.sizeSol * LAMPORTS));
      const res = await swapper.swap(SOL_MINT, mint, lamports);
      if (res.outAmount <= 0n) throw new Error("Fikk 0 tokens tilbake fra kjøpet");
      const sizeSol = Number(res.inAmount) / LAMPORTS + (cfg.DRY_RUN ? PAPER_FEE_SOL : 0);

      risk.recordOpen({
        mint,
        ...(safety.symbol ? { symbol: safety.symbol } : {}),
        sizeSol,
        entryPrice: sizeSol / Number(res.outAmount),
        tokenAmountRaw: res.outAmount.toString(),
        openedAt: this.now().toISOString(),
      });
      log("buy", `${name} kjøpt for ${sizeSol.toFixed(4)} SOL · score ${safety.score} · kilde ${source}${res.signature ? ` · tx ${res.signature}` : " · (simulert)"}`, {
        mint,
        symbol: safety.symbol,
        source,
        score: safety.score,
        sizeSol,
        tokens: res.outAmount.toString(),
        signature: res.signature,
        dryRun: cfg.DRY_RUN,
      });
      return "bought";
    } catch (e) {
      log("error", `Kjøp av ${short(mint)} feilet: ${(e as Error).message}`, { mint });
      return "error";
    } finally {
      this.busy.delete(mint);
    }
  }

  /** Sjekk alle åpne posisjoner og selg ved stop-loss, take-profit eller tidsgrense. */
  async checkPositions(): Promise<void> {
    const { cfg } = this.d;
    for (const p of [...this.d.risk.state.openPositions]) {
      if (this.busy.has(p.mint) || !p.tokenAmountRaw) continue;
      const name = p.symbol ? `$${p.symbol}` : short(p.mint);
      const amount = BigInt(p.tokenAmountRaw);

      let valueSol: number;
      try {
        const q = await this.d.swapper.quote(p.mint, SOL_MINT, amount);
        valueSol = Number(q.outAmount) / LAMPORTS;
        this.priceFailures.delete(p.mint);
      } catch (e) {
        const n = (this.priceFailures.get(p.mint) ?? 0) + 1;
        this.priceFailures.set(p.mint, n);
        if (n < MAX_PRICE_FAILURES) {
          log("error", `Fant ikke pris for ${name} (${n}/${MAX_PRICE_FAILURES}): ${(e as Error).message}`);
          continue;
        }
        this.priceFailures.delete(p.mint);
        this.closeAsLoss(p.mint, name, p.sizeSol);
        continue;
      }

      const pnlPct = (valueSol / p.sizeSol - 1) * 100;
      this.valuations.set(p.mint, { valueSol, pnlPct, at: this.now().toISOString() });
      const ageMin = (this.now().getTime() - new Date(p.openedAt).getTime()) / 60000;
      let reason: SellReason | null = null;
      if (pnlPct <= -cfg.STOP_LOSS_PCT) reason = "stop-loss";
      else if (pnlPct >= cfg.TAKE_PROFIT_PCT) reason = "take-profit";
      else if (ageMin >= cfg.MAX_HOLD_MINUTES) reason = "tidsgrense";
      if (reason) await this.sell(p.mint, name, p.sizeSol, amount, reason);
    }
  }

  /** Selg en posisjon med en gang (knappen på dashboardet). */
  async sellNow(mint: string): Promise<boolean> {
    const p = this.d.risk.state.openPositions.find((x) => x.mint === mint);
    if (!p || !p.tokenAmountRaw || this.busy.has(mint)) return false;
    await this.sell(mint, p.symbol ? `$${p.symbol}` : short(mint), p.sizeSol, BigInt(p.tokenAmountRaw), "manuelt");
    return !this.d.risk.state.openPositions.some((x) => x.mint === mint);
  }

  private async sell(mint: string, name: string, sizeSol: number, amountRaw: bigint, reason: SellReason) {
    const { cfg, risk, swapper } = this.d;
    this.busy.add(mint);
    try {
      // I LIVE selges det vi faktisk har i walleten.
      const held = cfg.DRY_RUN ? amountRaw : await swapper.tokenBalanceRaw(mint);
      if (held <= 0n) {
        this.closeAsLoss(mint, name, sizeSol);
        return;
      }
      const res = await swapper.swap(mint, SOL_MINT, held);
      const outSol = Number(res.outAmount) / LAMPORTS - (cfg.DRY_RUN ? PAPER_FEE_SOL : 0);
      const pnl = outSol - sizeSol;
      const halted = risk.recordClose(mint, pnl);
      this.valuations.delete(mint);
      log(pnl >= 0 ? "sell" : "stop", `${name} solgt (${reason}) · ${pnl >= 0 ? "+" : ""}${pnl.toFixed(4)} SOL (${((pnl / sizeSol) * 100).toFixed(1)}%)${res.signature ? ` · tx ${res.signature}` : " · (simulert)"}`, {
        mint,
        reason,
        pnlSol: pnl,
        signature: res.signature,
      });
      if (halted) log("halt", `Dagstap-grensen på ${cfg.DAILY_LOSS_LIMIT_PCT}% er nådd. Ingen nye kjøp før i morgen (UTC).`);
    } catch (e) {
      log("error", `Salg av ${name} feilet, prøver igjen ved neste sjekk: ${(e as Error).message}`, { mint });
    } finally {
      this.busy.delete(mint);
    }
  }

  private closeAsLoss(mint: string, name: string, sizeSol: number) {
    const halted = this.d.risk.recordClose(mint, -sizeSol);
    this.valuations.delete(mint);
    log("rug", `${name} regnes som tapt (ingen pris eller ingen tokens igjen) · -${sizeSol.toFixed(4)} SOL`, { mint, pnlSol: -sizeSol });
    if (halted) log("halt", `Dagstap-grensen er nådd. Ingen nye kjøp før i morgen (UTC).`);
  }
}

function short(mint: string) {
  return `${mint.slice(0, 4)}…${mint.slice(-4)}`;
}
