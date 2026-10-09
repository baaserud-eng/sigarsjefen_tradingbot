import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

/**
 * Risikostyring: bestemmer om en ny handel er lov, og stopper boten for resten
 * av dagen hvis dagstap-grensen nås. Tilstanden lagres i data/state.json så den
 * overlever en omstart (ellers kunne en restart "nullstille" dagstapet).
 */

export interface RiskRules {
  maxSolPerTrade: number;
  dailyLossLimitPct: number;
  maxOpenPositions: number;
}

export interface Position {
  mint: string;
  symbol?: string;
  sizeSol: number;
  entryPrice: number;
  /** Antall tokens kjøpt, i minste enhet (som tekst fordi tallet kan bli veldig stort) */
  tokenAmountRaw?: string;
  openedAt: string;
}

export interface RiskState {
  day: string; // YYYY-MM-DD (UTC)
  dayStartBalanceSol: number;
  realizedPnlSol: number;
  /** Total gevinst/tap siden start, brukes til simulert saldo i DRY_RUN */
  totalRealizedPnlSol: number;
  halted: boolean;
  openPositions: Position[];
}

export type Decision = { ok: true; sizeSol: number } | { ok: false; reason: string };

const today = (now: Date) => now.toISOString().slice(0, 10);

export class RiskManager {
  state: RiskState;

  constructor(
    private rules: RiskRules,
    startBalanceSol: number,
    private file: string | null = "data/state.json",
    private now: () => Date = () => new Date(),
  ) {
    const loaded = this.load();
    this.state = loaded ?? {
      day: today(this.now()),
      dayStartBalanceSol: startBalanceSol,
      realizedPnlSol: 0,
      totalRealizedPnlSol: 0,
      halted: false,
      openPositions: [],
    };
    this.state.totalRealizedPnlSol ??= 0;
    this.rollDay(startBalanceSol);
  }

  /** Ny dag: nullstill dagstap og opphev stopp. Åpne posisjoner beholdes. */
  rollDay(currentBalanceSol: number) {
    const d = today(this.now());
    if (this.state.day !== d) {
      this.state.day = d;
      this.state.dayStartBalanceSol = currentBalanceSol;
      this.state.realizedPnlSol = 0;
      this.state.halted = false;
      this.save();
    }
  }

  get lossLimitSol() {
    return (this.state.dayStartBalanceSol * this.rules.dailyLossLimitPct) / 100;
  }

  /** Kan vi åpne en ny handel? Returnerer størrelsen som er lov. */
  canOpen(mint: string, requestedSol: number, availableSol: number): Decision {
    if (this.state.halted) return { ok: false, reason: "Dagstap-grensen er nådd. Handel stoppet til i morgen." };
    if (this.state.openPositions.some((p) => p.mint === mint))
      return { ok: false, reason: "Har allerede en posisjon i denne tokenen" };
    if (this.state.openPositions.length >= this.rules.maxOpenPositions)
      return { ok: false, reason: `Maks ${this.rules.maxOpenPositions} åpne posisjoner` };

    // Ikke risiker mer enn det som er igjen før dagstap-grensen.
    const lossRoom = this.lossLimitSol + this.state.realizedPnlSol;
    const size = Math.min(requestedSol, this.rules.maxSolPerTrade, availableSol, lossRoom);
    if (size <= 0.001) return { ok: false, reason: "Ikke nok saldo eller tapsrom igjen i dag" };
    return { ok: true, sizeSol: Number(size.toFixed(4)) };
  }

  recordOpen(p: Position) {
    this.state.openPositions.push(p);
    this.save();
  }

  /** Registrer en lukket handel. Returnerer true hvis boten nå er stoppet for dagen. */
  recordClose(mint: string, pnlSol: number): boolean {
    this.state.openPositions = this.state.openPositions.filter((p) => p.mint !== mint);
    this.state.realizedPnlSol += pnlSol;
    this.state.totalRealizedPnlSol += pnlSol;
    if (-this.state.realizedPnlSol >= this.lossLimitSol) this.state.halted = true;
    this.save();
    return this.state.halted;
  }

  private load(): RiskState | null {
    if (!this.file) return null;
    try {
      return JSON.parse(readFileSync(this.file, "utf8")) as RiskState;
    } catch {
      return null;
    }
  }

  private save() {
    if (!this.file) return;
    mkdirSync(dirname(this.file), { recursive: true });
    writeFileSync(this.file, JSON.stringify(this.state, null, 2));
  }
}
