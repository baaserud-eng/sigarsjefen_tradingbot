/**
 * Backtest av opening range breakout på historiske lys.
 * Bruker samme evaluateDay() som boten bruker live.
 *
 * Forutsetninger (bevisst litt pessimistiske):
 * - Inngang på åpningen av lyset ETTER signal-lyset, pluss halv spread.
 * - Treffer både stop og mål i samme lys, regnes det som stop.
 * - Utgang ved stop/mål/sesjonsslutt betaler halv spread.
 * Resultatet måles i R: 1R = det du risikerte på handelen.
 */
import { hhmm, nyToDate } from "../core/time.js";
import type { MarketDef } from "../markets.js";
import { evaluateDay, groupByNyDate, type Candle, type Direction, type OrbParams } from "./orb.js";

export interface BtTrade {
  date: string;
  direction: Direction;
  entry: number;
  stop: number;
  target: number;
  exit: number;
  exitReason: "mål" | "stop" | "sesjonsslutt";
  r: number;
}

export interface BtSummary {
  days: number;
  trades: number;
  wins: number;
  winRate: number;
  totalR: number;
  avgR: number;
  maxDrawdownR: number;
  profitFactor: number;
}

export function backtestDay(date: string, candles: Candle[], market: MarketDef, p: OrbParams): BtTrade | null {
  const cutoffMin = Math.min(hhmm(market.open) + p.entryCutoffMinutes, hhmm(market.close) - p.flatBeforeCloseMinutes - 1);
  const ev = evaluateDay(candles, market, p, nyToDate(date, cutoffMin).getTime());
  if (!ev.signal) return null;
  const s = ev.signal;
  const barMs = p.barMinutes * 60_000;
  const flatAt = nyToDate(date, hhmm(market.close) - p.flatBeforeCloseMinutes).getTime();

  const after = candles.filter((c) => c.t > s.at).sort((a, b) => a.t - b.t);
  const first = after[0];
  if (!first || first.t >= flatAt) return null;

  const long = s.direction === "BUY";
  const entry = long ? first.o + first.spread / 2 : first.o - first.spread / 2;
  const risk = Math.abs(entry - s.stop);
  if (risk <= 0 || (long ? entry <= s.stop : entry >= s.stop)) return null; // gapet forbi stop
  const target = long ? entry + p.rewardRisk * risk : entry - p.rewardRisk * risk;

  let exit = 0;
  let reason: BtTrade["exitReason"] = "sesjonsslutt";
  for (const c of after) {
    if (c.t + barMs > flatAt) {
      exit = long ? c.o - c.spread / 2 : c.o + c.spread / 2;
      break;
    }
    const half = c.spread / 2;
    const hitStop = long ? c.l - half <= s.stop : c.h + half >= s.stop;
    const hitTarget = long ? c.h - half >= target : c.l + half <= target;
    if (hitStop) {
      exit = s.stop;
      reason = "stop";
      break;
    }
    if (hitTarget) {
      exit = target;
      reason = "mål";
      break;
    }
    exit = long ? c.c - half : c.c + half;
  }

  const r = ((long ? exit - entry : entry - exit) / risk);
  return { date, direction: s.direction, entry, stop: s.stop, target, exit, exitReason: reason, r: Number(r.toFixed(3)) };
}

export function backtest(candles: Candle[], market: MarketDef, p: OrbParams): { trades: BtTrade[]; summary: BtSummary } {
  const days = groupByNyDate(candles);
  const trades: BtTrade[] = [];
  for (const [date, list] of [...days.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const t = backtestDay(date, list, market, p);
    if (t) trades.push(t);
  }
  return { trades, summary: summarize(trades, days.size) };
}

export function summarize(trades: BtTrade[], days: number): BtSummary {
  let eq = 0;
  let peak = 0;
  let dd = 0;
  let gains = 0;
  let losses = 0;
  for (const t of trades) {
    eq += t.r;
    peak = Math.max(peak, eq);
    dd = Math.max(dd, peak - eq);
    if (t.r > 0) gains += t.r;
    else losses -= t.r;
  }
  const wins = trades.filter((t) => t.r > 0).length;
  return {
    days,
    trades: trades.length,
    wins,
    winRate: trades.length ? wins / trades.length : 0,
    totalR: Number(eq.toFixed(2)),
    avgR: trades.length ? Number((eq / trades.length).toFixed(3)) : 0,
    maxDrawdownR: Number(dd.toFixed(2)),
    profitFactor: losses > 0 ? Number((gains / losses).toFixed(2)) : gains > 0 ? Infinity : 0,
  };
}
