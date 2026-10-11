/**
 * Opening range breakout (ORB).
 *
 * 1. De første ORB_MINUTES etter åpning er "range": høyeste og laveste pris.
 * 2. Når et helt 5-minutters lys lukker OVER range -> kjøp (long).
 *    Lukker det UNDER range -> selg (short).
 * 3. Stop-loss på motsatt side av range. Mål = REWARD_RISK ganger risikoen.
 * 4. Maks én handel per marked per dag. Ingen nye handler etter ENTRY_CUTOFF_MINUTES.
 * 5. Alt lukkes FLAT_BEFORE_CLOSE_MINUTES før sesjonen slutter.
 *
 * Denne filen er ren logikk uten nettverk, slik at den kjøres likt i backtest og live.
 */
import { hhmm, nyParts } from "../core/time.js";
import type { MarketDef } from "../markets.js";

export interface Candle {
  /** Starttidspunkt, ms UTC */
  t: number;
  /** Midtpris (snitt av bid og ask) */
  o: number;
  h: number;
  l: number;
  c: number;
  /** Spread (ask - bid) ved lukking */
  spread: number;
}

export interface OrbParams {
  orbMinutes: number;
  entryCutoffMinutes: number;
  rewardRisk: number;
  flatBeforeCloseMinutes: number;
  /** Lysstørrelse i minutter (5) */
  barMinutes: number;
  /** Hopp over dager der range er mindre enn dette i prosent av prisen (for smal = mye støy) */
  minRangePct: number;
  /** Hopp over dager der range er større enn dette i prosent (for bred = stop for langt unna) */
  maxRangePct: number;
}

export type Direction = "BUY" | "SELL";

export type Phase = "closed" | "before" | "building" | "watching" | "signal" | "done" | "skipped";

export interface Signal {
  direction: Direction;
  /** Lukkekursen som utløste signalet */
  ref: number;
  stop: number;
  target: number;
  /** Starttid for lyset som utløste signalet */
  at: number;
}

export interface DayEval {
  phase: Phase;
  rangeHigh?: number;
  rangeLow?: number;
  signal?: Signal;
  note?: string;
}

/** Minutter i New York-tid for et lys */
const minuteOf = (c: Candle) => nyParts(c.t).minutes;

/**
 * Vurder én handelsdag. `candles` er dagens lys (New York-dato), `nowMs` er nå.
 * Bare lys som er ferdige ved `nowMs` brukes.
 */
export function evaluateDay(candles: Candle[], market: MarketDef, p: OrbParams, nowMs: number): DayEval {
  const open = hhmm(market.open);
  const close = hhmm(market.close);
  const orbEnd = open + p.orbMinutes;
  const cutoff = open + p.entryCutoffMinutes;
  const nowMin = nyParts(nowMs).minutes;
  const barMs = p.barMinutes * 60_000;

  if (nowMin < open) return { phase: "before" };
  if (nowMin >= close - p.flatBeforeCloseMinutes) return { phase: "closed" };

  const done = candles.filter((c) => c.t + barMs <= nowMs).sort((a, b) => a.t - b.t);
  const rangeBars = done.filter((c) => {
    const m = minuteOf(c);
    return m >= open && m < orbEnd;
  });

  if (nowMin < orbEnd || rangeBars.length === 0) {
    if (!rangeBars.length) return { phase: "building" };
    return {
      phase: "building",
      rangeHigh: Math.max(...rangeBars.map((c) => c.h)),
      rangeLow: Math.min(...rangeBars.map((c) => c.l)),
    };
  }

  const expectedBars = Math.floor(p.orbMinutes / p.barMinutes);
  const rangeHigh = Math.max(...rangeBars.map((c) => c.h));
  const rangeLow = Math.min(...rangeBars.map((c) => c.l));
  if (rangeBars.length < expectedBars) {
    return { phase: "skipped", rangeHigh, rangeLow, note: "Mangler lys i range (helligdag eller datahull)" };
  }

  const mid = (rangeHigh + rangeLow) / 2;
  const rangePct = ((rangeHigh - rangeLow) / mid) * 100;
  if (rangePct < p.minRangePct) return { phase: "skipped", rangeHigh, rangeLow, note: `Range for smal (${rangePct.toFixed(2)}%)` };
  if (rangePct > p.maxRangePct) return { phase: "skipped", rangeHigh, rangeLow, note: `Range for bred (${rangePct.toFixed(2)}%)` };

  for (const c of done) {
    const m = minuteOf(c);
    if (m < orbEnd) continue;
    if (m >= cutoff) break;
    if (c.c > rangeHigh) {
      const risk = c.c - rangeLow;
      return { phase: "signal", rangeHigh, rangeLow, signal: { direction: "BUY", ref: c.c, stop: rangeLow, target: c.c + p.rewardRisk * risk, at: c.t } };
    }
    if (c.c < rangeLow) {
      const risk = rangeHigh - c.c;
      return { phase: "signal", rangeHigh, rangeLow, signal: { direction: "SELL", ref: c.c, stop: rangeHigh, target: c.c - p.rewardRisk * risk, at: c.t } };
    }
  }

  if (nowMin >= cutoff) return { phase: "done", rangeHigh, rangeLow, note: "Ingen breakout før fristen" };
  return { phase: "watching", rangeHigh, rangeLow };
}

/** Del opp lys etter New York-dato. */
export function groupByNyDate(candles: Candle[]): Map<string, Candle[]> {
  const out = new Map<string, Candle[]>();
  for (const c of candles) {
    const d = nyParts(c.t).date;
    const list = out.get(d);
    if (list) list.push(c);
    else out.set(d, [c]);
  }
  return out;
}
