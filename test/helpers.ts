import { nyToDate } from "../src/core/time.js";
import type { Candle } from "../src/strategy/orb.js";

export const DATE = "2026-10-07"; // onsdag
export const params = {
  orbMinutes: 15,
  entryCutoffMinutes: 120,
  rewardRisk: 2,
  flatBeforeCloseMinutes: 15,
  barMinutes: 5,
  minRangePct: 0.05,
  maxRangePct: 1.5,
};

/** Lys som starter et gitt antall minutter etter 09:30 New York-tid */
export function bar(afterOpen: number, o: number, h: number, l: number, c: number, spread = 1, date = DATE): Candle {
  return { t: nyToDate(date, 570 + afterOpen).getTime(), o, h, l, c, spread };
}

/** Tidspunkt (ms) et gitt antall minutter etter 09:30 New York-tid */
export const at = (afterOpen: number, date = DATE) => nyToDate(date, 570 + afterOpen).getTime();

/** Range 20000–20040 de første 15 minuttene */
export const rangeBars = (date = DATE) => [
  bar(0, 20010, 20040, 20005, 20030, 1, date),
  bar(5, 20030, 20035, 20000, 20010, 1, date),
  bar(10, 20010, 20025, 20008, 20020, 1, date),
];
