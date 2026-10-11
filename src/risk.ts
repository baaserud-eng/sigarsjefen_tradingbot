import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

/**
 * Posisjonsstørrelse: hvor mye kan vi kjøpe slik at vi taper nøyaktig
 * RISK_PER_TRADE_PCT av kontoen hvis stop-loss treffes?
 */
export interface SizeInput {
  balance: number; // i kontovaluta
  riskPct: number;
  stopDistance: number; // i pris-poeng
  /** Hvor mye kontovaluta 1 enhet av instrumentets valuta er verdt */
  fxToAccount: number;
  minSize: number;
  sizeStep: number;
  /** Hvor mye 1 størrelse tjener/taper per 1 poeng, i instrumentets valuta (vanligvis 1) */
  valuePerPoint?: number;
  /** Godta minstestørrelse selv om den gir litt mer risiko enn ønsket (maks denne faktoren) */
  maxOverRisk?: number;
}

export type SizeResult = { size: number; riskAccount: number } | { size: 0; reason: string };

export function positionSize(i: SizeInput): SizeResult {
  if (i.stopDistance <= 0) return { size: 0, reason: "Stop-avstand er 0" };
  const vpp = i.valuePerPoint ?? 1;
  const riskAcc = (i.balance * i.riskPct) / 100;
  const lossPerUnitAcc = i.stopDistance * vpp * i.fxToAccount;
  const raw = riskAcc / lossPerUnitAcc;
  const step = i.sizeStep > 0 ? i.sizeStep : i.minSize;
  const decimals = Math.max(0, (String(step).split(".")[1] ?? "").length);
  let size = Number((Math.floor(raw / step + 1e-9) * step).toFixed(decimals));

  if (size < i.minSize) {
    const minRisk = i.minSize * lossPerUnitAcc;
    if (minRisk <= riskAcc * (i.maxOverRisk ?? 1.5)) size = i.minSize;
    else
      return {
        size: 0,
        reason: `Minste handelsstørrelse (${i.minSize}) ville risikert ${minRisk.toFixed(2)}, men grensen er ${riskAcc.toFixed(2)}. Kontoen er for liten for denne stop-avstanden.`,
      };
  }
  return { size, riskAccount: Number((size * lossPerUnitAcc).toFixed(2)) };
}

/**
 * Dagsvakt: holder styr på dagens resultat (New York-dato), stopper nye handler når
 * dagstap-grensen er nådd, og sørger for maks én handel per marked per dag.
 * Lagres på disk så en omstart ikke nullstiller noe.
 */
export interface DayState {
  date: string;
  startBalance: number;
  halted: boolean;
  traded: string[]; // markeder som er handlet i dag
}

export class DayGuard {
  state: DayState;

  constructor(
    private lossLimitPct: number,
    private maxTradesPerDay: number,
    private file: string | null,
  ) {
    this.state = this.load() ?? { date: "", startBalance: 0, halted: false, traded: [] };
  }

  /** Kalles jevnlig med dagens dato og kontoverdi (saldo + urealisert). Returnerer true hvis grensen nettopp ble nådd. */
  update(date: string, equity: number): boolean {
    if (this.state.date !== date) {
      this.state = { date, startBalance: equity, halted: false, traded: [] };
      this.save();
    }
    if (!this.state.halted && this.dayPnl(equity) <= -this.lossLimit) {
      this.state.halted = true;
      this.save();
      return true;
    }
    return false;
  }

  get lossLimit() {
    return (this.state.startBalance * this.lossLimitPct) / 100;
  }

  dayPnl(equity: number) {
    return equity - this.state.startBalance;
  }

  canTrade(epic: string): { ok: true } | { ok: false; reason: string } {
    if (this.state.halted) return { ok: false, reason: "Dagstap-grensen er nådd" };
    if (this.state.traded.includes(epic)) return { ok: false, reason: "Allerede handlet i dag" };
    if (this.state.traded.length >= this.maxTradesPerDay) return { ok: false, reason: `Maks ${this.maxTradesPerDay} handler per dag` };
    return { ok: true };
  }

  markTraded(epic: string) {
    if (!this.state.traded.includes(epic)) this.state.traded.push(epic);
    this.save();
  }

  private load(): DayState | null {
    if (!this.file) return null;
    try {
      return JSON.parse(readFileSync(this.file, "utf8")) as DayState;
    } catch {
      return null;
    }
  }

  private save() {
    if (!this.file) return;
    try {
      mkdirSync(dirname(this.file), { recursive: true });
      writeFileSync(this.file, JSON.stringify(this.state, null, 2));
    } catch {
      // ikke kritisk
    }
  }
}
