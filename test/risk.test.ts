import { test } from "node:test";
import assert from "node:assert/strict";
import { DayGuard, positionSize } from "../src/risk.js";

test("størrelse gir riktig risiko: 10 000 kr, 0,5 %, 50 poeng stop, USD->NOK 10", () => {
  // 50 kr risiko / (50 poeng * 10 kr per poeng) = 0,1
  const r = positionSize({ balance: 10000, riskPct: 0.5, stopDistance: 50, fxToAccount: 10, minSize: 0.01, sizeStep: 0.01 });
  assert.deepEqual(r, { size: 0.1, riskAccount: 50 });
});

test("størrelse rundes ned til steg", () => {
  const r = positionSize({ balance: 10000, riskPct: 0.5, stopDistance: 37, fxToAccount: 10, minSize: 0.01, sizeStep: 0.01 });
  assert.equal(r.size, 0.13);
});

test("for liten konto for minste størrelse gir avslag med forklaring", () => {
  const r = positionSize({ balance: 5000, riskPct: 0.5, stopDistance: 60, fxToAccount: 10, minSize: 1, sizeStep: 1 });
  assert.equal(r.size, 0);
  assert.ok("reason" in r && r.reason.includes("for liten"));
});

test("minste størrelse godtas hvis risikoen bare er litt over", () => {
  // Ønsket risiko 50 kr. Minste størrelse (1) gir 60 kr, som er under 1,5 x 50.
  const r = positionSize({ balance: 10000, riskPct: 0.5, stopDistance: 6, fxToAccount: 10, minSize: 1, sizeStep: 1 });
  assert.deepEqual(r, { size: 1, riskAccount: 60 });
});

test("dagsvakt: stopper ved dagstap og nullstilles neste dag", () => {
  const g = new DayGuard(2, 3, null);
  g.update("2026-10-07", 10000);
  assert.equal(g.update("2026-10-07", 9850), false);
  assert.equal(g.update("2026-10-07", 9800), true);
  assert.equal(g.canTrade("US100").ok, false);
  g.update("2026-10-08", 9800);
  assert.equal(g.canTrade("US100").ok, true);
  assert.equal(g.state.startBalance, 9800);
});

test("dagsvakt: én handel per marked og maks antall per dag", () => {
  const g = new DayGuard(2, 2, null);
  g.update("2026-10-07", 10000);
  g.markTraded("US100");
  assert.equal(g.canTrade("US100").ok, false);
  g.markTraded("GOLD");
  assert.equal(g.canTrade("US500").ok, false);
});
