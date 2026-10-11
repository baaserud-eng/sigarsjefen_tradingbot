/**
 * Læring, del 1: finn bedre innstillinger per marked fra historikken.
 *
 * Den store fella er "overfitting": å finne innstillinger som tilfeldigvis passet
 * perfekt på fortiden, men som ikke virker fremover. Derfor:
 *
 *  - Historikken deles i to. De eldste 2/3 brukes til å LETE etter innstillinger.
 *  - De nyeste 1/3 er en "eksamen" innstillingene aldri har sett.
 *  - Nye innstillinger tas bare i bruk hvis de også slår de gamle på eksamen,
 *    med margin, og med nok handler til at det ikke bare er flaks.
 *  - Taper alle innstillinger på eksamen, settes markedet på pause til det snur.
 */
import type { MarketDef } from "../markets.js";
import { backtest, type BtSummary } from "../strategy/backtest.js";
import { nyParts } from "../core/time.js";
import { groupByNyDate, type Candle, type OrbParams } from "../strategy/orb.js";

export type Tunable = Pick<OrbParams, "orbMinutes" | "rewardRisk" | "entryCutoffMinutes" | "directions">;

export const GRID = {
  orbMinutes: [5, 15, 30],
  rewardRisk: [1.5, 2, 3],
  entryCutoffMinutes: [60, 120],
  directions: ["both", "long", "short"] as const,
};

export interface LearnRules {
  /** Minste antall handler i lete-perioden for at en kombinasjon vurderes */
  minTrainTrades: number;
  /** Minste antall handler på eksamen for at resultatet skal telle */
  minTestTrades: number;
  /** Hvor mye bedre (i R) nye innstillinger må gjøre det på eksamen */
  adoptMarginR: number;
}

export const DEFAULT_LEARN_RULES: LearnRules = { minTrainTrades: 10, minTestTrades: 8, adoptMarginR: 1.5 };

export type Decision = "adopt" | "keep" | "pause" | "resume" | "too-little-data";

export interface LearnResult {
  epic: string;
  decision: Decision;
  reason: string;
  current: Tunable;
  best: Tunable;
  currentTest: BtSummary;
  bestTrain: BtSummary;
  bestTest: BtSummary;
  days: { train: number; test: number };
}

/** Score for lete-perioden: belønner jevn fortjeneste over mange handler, ikke én heldig storgevinst. */
export function score(s: BtSummary): number {
  if (s.trades === 0) return -Infinity;
  return s.avgR * Math.sqrt(s.trades) - 0.1 * s.maxDrawdownR;
}

export function combos(): Tunable[] {
  const out: Tunable[] = [];
  for (const orbMinutes of GRID.orbMinutes)
    for (const rewardRisk of GRID.rewardRisk)
      for (const entryCutoffMinutes of GRID.entryCutoffMinutes)
        for (const directions of GRID.directions) {
          if (entryCutoffMinutes <= orbMinutes) continue;
          out.push({ orbMinutes, rewardRisk, entryCutoffMinutes, directions });
        }
  return out;
}

export const describe = (t: Tunable) =>
  `range ${t.orbMinutes} min · mål ${t.rewardRisk}R · frist ${t.entryCutoffMinutes} min · ${t.directions === "long" ? "kun long" : t.directions === "short" ? "kun short" : "long og short"}`;

export const sameTunable = (a: Tunable, b: Tunable) =>
  a.orbMinutes === b.orbMinutes && a.rewardRisk === b.rewardRisk && a.entryCutoffMinutes === b.entryCutoffMinutes && (a.directions ?? "both") === (b.directions ?? "both");

export function learnMarket(
  candles: Candle[],
  market: MarketDef,
  base: OrbParams,
  current: Tunable,
  wasPaused: boolean,
  rules: LearnRules = DEFAULT_LEARN_RULES,
): LearnResult {
  const days = [...groupByNyDate(candles).keys()].sort();
  const split = Math.floor((days.length * 2) / 3);
  const trainDays = new Set(days.slice(0, split));
  const train = candles.filter((c) => trainDays.has(dateOf(c)));
  const test = candles.filter((c) => !trainDays.has(dateOf(c)));
  const run = (cs: Candle[], t: Tunable) => backtest(cs, market, { ...base, ...t }).summary;

  const currentTest = run(test, current);
  const empty = { days: 0, trades: 0, wins: 0, winRate: 0, totalR: 0, avgR: 0, maxDrawdownR: 0, profitFactor: 0 };
  const base_: Omit<LearnResult, "decision" | "reason"> = {
    epic: market.epic,
    current,
    best: current,
    currentTest,
    bestTrain: empty,
    bestTest: currentTest,
    days: { train: split, test: days.length - split },
  };

  if (days.length < 30) {
    return { ...base_, decision: "too-little-data", reason: `Bare ${days.length} handelsdager med data. Trenger minst 30 for å lære noe.` };
  }

  let best: { t: Tunable; s: BtSummary; score: number } | null = null;
  for (const t of combos()) {
    const s = run(train, t);
    if (s.trades < rules.minTrainTrades) continue;
    const sc = score(s);
    if (!best || sc > best.score) best = { t, s, score: sc };
  }
  if (!best) {
    return { ...base_, decision: "too-little-data", reason: "Ingen innstillinger ga nok handler i lete-perioden." };
  }

  const bestTest = run(test, best.t);
  const out = { ...base_, best: best.t, bestTrain: best.s, bestTest };
  const enough = (x: BtSummary) => x.trades >= rules.minTestTrades;

  // 1) Tydelig bedre innstillinger: lønnsomme både i lete-perioden og på eksamen, og klart bedre enn dagens.
  const qualifies =
    !sameTunable(best.t, current) &&
    enough(bestTest) &&
    bestTest.avgR > 0 &&
    bestTest.profitFactor >= 1.2 &&
    best.s.profitFactor >= 1.2 &&
    bestTest.totalR >= currentTest.totalR + rules.adoptMarginR;
  if (qualifies) {
    return {
      ...out,
      decision: wasPaused ? "resume" : "adopt",
      reason: `Nye innstillinger ga ${fmtR(bestTest.totalR)} på de ${out.days.test} nyeste dagene, mot ${fmtR(currentTest.totalR)} med de gamle.`,
    };
  }

  // 2) Dagens innstillinger taper, og ingenting er tydelig bedre: pause.
  if (enough(currentTest) && currentTest.avgR <= 0) {
    return {
      ...out,
      best: current,
      decision: "pause",
      reason: `Strategien ga ${fmtR(currentTest.totalR)} de siste ${out.days.test} dagene, og ingen andre innstillinger var tydelig bedre. Markedet settes på pause til det snur.`,
    };
  }

  // 3) Var på pause, men tjener igjen.
  if (wasPaused && enough(currentTest) && currentTest.avgR > 0) {
    return { ...out, best: current, decision: "resume", reason: `Strategien tjener igjen (${fmtR(currentTest.totalR)} siste ${out.days.test} dager). Pausen oppheves.` };
  }

  return {
    ...out,
    best: current,
    decision: wasPaused ? "pause" : "keep",
    reason: !enough(currentTest)
      ? `For få handler de siste ${out.days.test} dagene (${currentTest.trades}) til å stole på en endring.`
      : `Nåværende innstillinger fungerer (${fmtR(currentTest.totalR)} siste ${out.days.test} dager), og ingenting var tydelig bedre.`,
  };
}

const dateOf = (c: Candle) => nyParts(c.t).date;

const fmtR = (r: number) => `${r >= 0 ? "+" : ""}${r.toFixed(1)}R`;
