import { test } from "node:test";
import assert from "node:assert/strict";
import { KNOWN_MARKETS } from "../src/markets.js";
import { backtest, backtestDay } from "../src/strategy/backtest.js";
import { bar, DATE, params, rangeBars } from "./helpers.js";

const NQ = KNOWN_MARKETS.US100!;

test("long som når målet gir nesten +2R (minus spread)", () => {
  const candles = [
    ...rangeBars(),
    bar(15, 20030, 20055, 20028, 20050), // signal
    bar(20, 20050, 20070, 20045, 20065), // inngang 20050.5
    bar(25, 20065, 20200, 20060, 20190), // mål
  ];
  const t = backtestDay(DATE, candles, NQ, params)!;
  assert.equal(t.direction, "BUY");
  assert.equal(t.exitReason, "mål");
  assert.equal(t.r, 2);
});

test("long som treffer stop gir -1R", () => {
  const candles = [...rangeBars(), bar(15, 20030, 20055, 20028, 20050), bar(20, 20050, 20052, 20020, 20025), bar(25, 20025, 20026, 19990, 19995)];
  const t = backtestDay(DATE, candles, NQ, params)!;
  assert.equal(t.exitReason, "stop");
  assert.equal(t.r, -1);
});

test("treffer både stop og mål i samme lys: regnes som stop", () => {
  const candles = [...rangeBars(), bar(15, 20030, 20055, 20028, 20050), bar(20, 20050, 20300, 19900, 20100)];
  assert.equal(backtestDay(DATE, candles, NQ, params)!.exitReason, "stop");
});

test("ingen signal gir ingen handel", () => {
  assert.equal(backtestDay(DATE, [...rangeBars(), bar(15, 20020, 20030, 20010, 20020)], NQ, params), null);
});

test("oppsummering over flere dager", () => {
  const win = [...rangeBars(), bar(15, 20030, 20055, 20028, 20050), bar(20, 20050, 20070, 20045, 20065), bar(25, 20065, 20200, 20060, 20190)];
  const d2 = "2026-10-08";
  const loss = [...rangeBars(d2), bar(15, 20030, 20055, 20028, 20050, 1, d2), bar(20, 20050, 20052, 19990, 19995, 1, d2)];
  const { trades, summary } = backtest([...win, ...loss], NQ, params);
  assert.equal(trades.length, 2);
  assert.equal(summary.wins, 1);
  assert.equal(summary.totalR, 1);
  assert.equal(summary.maxDrawdownR, 1);
  assert.equal(summary.profitFactor, 2);
});
