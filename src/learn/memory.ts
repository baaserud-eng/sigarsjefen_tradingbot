/**
 * Læring, del 2: hukommelsen til boten.
 *
 * - Hvilke innstillinger hvert marked bruker nå (fra optimizer.ts), og om det er på pause.
 * - En dagbok over hver avsluttet handel, målt i R (gevinst/tap delt på risikoen).
 * - Etter en tapsrekke halveres risikoen for det markedet til det går bedre igjen.
 *
 * Alt lagres i data/learning-<demo|live>.json, så boten husker det etter omstart.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { Direction } from "../strategy/orb.js";
import type { Decision, Tunable } from "./optimizer.js";

export interface MarketMemory {
  tunable: Tunable;
  paused: boolean;
  updatedAt: string | null;
  reason: string;
}

export interface JournalEntry {
  at: string;
  epic: string;
  direction: Direction;
  pnl: number;
  r: number;
  tunable: Tunable;
}

export interface OpenTrade {
  epic: string;
  direction: Direction;
  riskAccount: number;
  tunable: Tunable;
  openedAt: string;
}

export interface Lesson {
  at: string;
  epic: string;
  decision: Decision | "risk-down" | "risk-up";
  text: string;
}

export interface LearningState {
  lastRun: string | null;
  markets: Record<string, MarketMemory>;
  journal: JournalEntry[];
  open: Record<string, OpenTrade>;
  lessons: Lesson[];
}

/** Risiko-justering ut fra bottens egne siste handler i et marked. */
export function riskMultiplier(rs: number[]): { mult: number; reason: string } {
  const last8 = rs.slice(-8);
  const sum8 = last8.reduce((a, b) => a + b, 0);
  if (last8.length >= 5 && sum8 <= -3) return { mult: 0.5, reason: `${sum8.toFixed(1)}R på de siste ${last8.length} handlene` };
  const last3 = rs.slice(-3);
  if (last3.length === 3 && last3.every((r) => r < 0)) return { mult: 0.5, reason: "tre tap på rad" };
  return { mult: 1, reason: "" };
}

export class LearningMemory {
  state: LearningState;

  constructor(
    private file: string | null,
    private defaults: Tunable,
  ) {
    this.state = this.load() ?? { lastRun: null, markets: {}, journal: [], open: {}, lessons: [] };
  }

  market(epic: string): MarketMemory {
    return this.state.markets[epic] ?? { tunable: { ...this.defaults }, paused: false, updatedAt: null, reason: "Standardinnstillinger (ikke lært ennå)" };
  }

  setMarket(epic: string, m: MarketMemory) {
    this.state.markets[epic] = m;
    this.save();
  }

  lesson(epic: string, decision: Lesson["decision"], text: string) {
    this.state.lessons.push({ at: new Date().toISOString(), epic, decision, text });
    if (this.state.lessons.length > 100) this.state.lessons.splice(0, this.state.lessons.length - 100);
    this.save();
  }

  rsFor(epic: string): number[] {
    return this.state.journal.filter((j) => j.epic === epic).map((j) => j.r);
  }

  risk(epic: string) {
    return riskMultiplier(this.rsFor(epic));
  }

  recordOpen(dealId: string, t: OpenTrade) {
    this.state.open[dealId] = t;
    this.save();
  }

  /** Registrer en lukket handel. Returnerer R, eller null hvis handelen ikke var åpnet av boten. */
  recordClose(dealId: string, pnl: number): number | null {
    const o = this.state.open[dealId];
    if (!o) return null;
    delete this.state.open[dealId];
    const before = this.risk(o.epic).mult;
    const r = o.riskAccount > 0 ? Number((pnl / o.riskAccount).toFixed(2)) : 0;
    this.state.journal.push({ at: new Date().toISOString(), epic: o.epic, direction: o.direction, pnl, r, tunable: o.tunable });
    if (this.state.journal.length > 2000) this.state.journal.splice(0, this.state.journal.length - 2000);
    const after = this.risk(o.epic);
    if (after.mult < before) this.lesson(o.epic, "risk-down", `Halverer risikoen etter ${after.reason}.`);
    if (after.mult > before) this.lesson(o.epic, "risk-up", "Tapsrekken er brutt. Tilbake til full risiko.");
    this.save();
    return r;
  }

  private load(): LearningState | null {
    if (!this.file) return null;
    try {
      const s = JSON.parse(readFileSync(this.file, "utf8")) as LearningState;
      return { lastRun: s.lastRun ?? null, markets: s.markets ?? {}, journal: s.journal ?? [], open: s.open ?? {}, lessons: s.lessons ?? [] };
    } catch {
      return null;
    }
  }

  save() {
    if (!this.file) return;
    try {
      mkdirSync(dirname(this.file), { recursive: true });
      writeFileSync(this.file, JSON.stringify(this.state, null, 2));
    } catch {
      // ikke kritisk
    }
  }
}
