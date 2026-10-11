import { test } from "node:test";
import assert from "node:assert/strict";
import { nyParts, nyToDate } from "../src/core/time.js";
import { KNOWN_MARKETS } from "../src/markets.js";
import { evaluateDay } from "../src/strategy/orb.js";
import { at, bar, params, rangeBars } from "./helpers.js";

const NQ = KNOWN_MARKETS.US100!;

test("New York-tid: 09:30 er 15:30 i Norge om høsten og regnes riktig tilbake", () => {
  const d = nyToDate("2026-10-07", 570);
  assert.equal(d.toISOString(), "2026-10-07T13:30:00.000Z");
  assert.deepEqual(nyParts(d), { date: "2026-10-07", minutes: 570, weekday: 3 });
  // Vintertid i USA (etter 1. november): 14:30 UTC
  assert.equal(nyToDate("2026-12-02", 570).toISOString(), "2026-12-02T14:30:00.000Z");
});

test("før åpning venter strategien", () => {
  assert.equal(evaluateDay([], NQ, params, at(-10)).phase, "before");
});

test("range bygges de første 15 minuttene", () => {
  const ev = evaluateDay(rangeBars().slice(0, 2), NQ, params, at(11));
  assert.equal(ev.phase, "building");
  assert.equal(ev.rangeHigh, 20040);
  assert.equal(ev.rangeLow, 20000);
});

test("ingen breakout ennå: venter", () => {
  const candles = [...rangeBars(), bar(15, 20020, 20038, 20015, 20030)];
  const ev = evaluateDay(candles, NQ, params, at(21));
  assert.equal(ev.phase, "watching");
});

test("lukking over range gir long med stop på bunnen og mål 2R", () => {
  const candles = [...rangeBars(), bar(15, 20030, 20055, 20028, 20050)];
  const ev = evaluateDay(candles, NQ, params, at(20));
  assert.equal(ev.phase, "signal");
  assert.equal(ev.signal?.direction, "BUY");
  assert.equal(ev.signal?.stop, 20000);
  assert.equal(ev.signal?.target, 20050 + 2 * 50);
});

test("lukking under range gir short", () => {
  const candles = [...rangeBars(), bar(15, 20010, 20012, 19985, 19990)];
  const ev = evaluateDay(candles, NQ, params, at(20));
  assert.equal(ev.signal?.direction, "SELL");
  assert.equal(ev.signal?.stop, 20040);
  assert.equal(ev.signal?.target, 19990 - 2 * 50);
});

test("et lys som ikke er ferdig ennå teller ikke", () => {
  const candles = [...rangeBars(), bar(15, 20030, 20055, 20028, 20050)];
  assert.equal(evaluateDay(candles, NQ, params, at(18)).phase, "watching");
});

test("veke over range uten lukking over gir ikke signal", () => {
  const candles = [...rangeBars(), bar(15, 20030, 20060, 20020, 20035)];
  assert.equal(evaluateDay(candles, NQ, params, at(20)).phase, "watching");
});

test("breakout etter fristen gir ikke signal", () => {
  const p = { ...params, entryCutoffMinutes: 30 };
  const candles = [...rangeBars(), bar(15, 20020, 20030, 20015, 20020), bar(20, 20020, 20030, 20015, 20020), bar(25, 20020, 20030, 20015, 20020), bar(30, 20030, 20080, 20028, 20070)];
  assert.equal(evaluateDay(candles, NQ, p, at(40)).phase, "done");
});

test("for bred range hoppes over", () => {
  const wide = [bar(0, 20000, 20400, 19900, 20100), bar(5, 20100, 20200, 20000, 20100), bar(10, 20100, 20150, 20050, 20100)];
  assert.equal(evaluateDay(wide, NQ, params, at(20)).phase, "skipped");
});

test("manglende lys i range (helligdag) hoppes over", () => {
  assert.equal(evaluateDay([rangeBars()[0]!], NQ, params, at(20)).phase, "skipped");
});

test("rett før sesjonsslutt er markedet stengt for strategien", () => {
  assert.equal(evaluateDay(rangeBars(), NQ, params, at(390 - 10)).phase, "closed");
});
