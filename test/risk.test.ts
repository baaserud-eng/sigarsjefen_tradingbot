import { test } from "node:test";
import assert from "node:assert/strict";
import { RiskManager } from "../src/risk/riskManager.js";

const rules = { maxSolPerTrade: 0.1, dailyLossLimitPct: 5, maxOpenPositions: 2 };
const fixed = (iso: string) => () => new Date(iso);

test("handel begrenses til maks per handel", () => {
  const rm = new RiskManager(rules, 10, null, fixed("2026-10-09T12:00:00Z"));
  const d = rm.canOpen("A", 1, 10);
  assert.deepEqual(d, { ok: true, sizeSol: 0.1 });
});

test("maks åpne posisjoner og ingen dobbel posisjon", () => {
  const rm = new RiskManager(rules, 10, null, fixed("2026-10-09T12:00:00Z"));
  rm.recordOpen({ mint: "A", sizeSol: 0.1, entryPrice: 1, openedAt: "" });
  assert.equal(rm.canOpen("A", 0.1, 10).ok, false);
  rm.recordOpen({ mint: "B", sizeSol: 0.1, entryPrice: 1, openedAt: "" });
  assert.equal(rm.canOpen("C", 0.1, 10).ok, false);
});

test("dagstap-grensen stopper boten", () => {
  const rm = new RiskManager(rules, 10, null, fixed("2026-10-09T12:00:00Z")); // grense 0.5 SOL
  rm.recordOpen({ mint: "A", sizeSol: 0.1, entryPrice: 1, openedAt: "" });
  assert.equal(rm.recordClose("A", -0.3), false);
  rm.recordOpen({ mint: "B", sizeSol: 0.1, entryPrice: 1, openedAt: "" });
  assert.equal(rm.recordClose("B", -0.25), true);
  assert.equal(rm.canOpen("C", 0.1, 10).ok, false);
});

test("størrelse krympes til gjenværende tapsrom", () => {
  const rm = new RiskManager(rules, 10, null, fixed("2026-10-09T12:00:00Z"));
  rm.recordOpen({ mint: "A", sizeSol: 0.1, entryPrice: 1, openedAt: "" });
  rm.recordClose("A", -0.45); // 0.05 igjen
  assert.deepEqual(rm.canOpen("B", 0.1, 10), { ok: true, sizeSol: 0.05 });
});

test("ny dag opphever stopp", () => {
  let now = new Date("2026-10-09T23:00:00Z");
  const rm = new RiskManager(rules, 10, null, () => now);
  rm.recordOpen({ mint: "A", sizeSol: 0.1, entryPrice: 1, openedAt: "" });
  rm.recordClose("A", -0.6);
  assert.equal(rm.state.halted, true);
  now = new Date("2026-10-10T01:00:00Z");
  rm.rollDay(9.4);
  assert.equal(rm.state.halted, false);
  assert.equal(rm.canOpen("B", 0.1, 9.4).ok, true);
});
