import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.SIGARSJEFEN_DATA_DIR = mkdtempSync(join(tmpdir(), "sigar-"));

const { learnMarket, combos } = await import("../src/learn/optimizer.js");
const { LearningMemory, riskMultiplier } = await import("../src/learn/memory.js");
const { apply } = await import("../src/learn/learner.js");
const { KNOWN_MARKETS } = await import("../src/markets.js");
import type { Candle } from "../src/strategy/orb.js";
import { bar, params, rangeBars } from "./helpers.js";

const NQ = KNOWN_MARKETS.US100!;
const current = { orbMinutes: 15, rewardRisk: 2, entryCutoffMinutes: 120, directions: "both" as const };

/** Hverdager fra en startdato */
function weekdays(start: string, n: number): string[] {
  const out: string[] = [];
  const d = new Date(start + "T12:00:00Z");
  while (out.length < n) {
    const wd = d.getUTCDay();
    if (wd !== 0 && wd !== 6) out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

/** Breakout opp fortsetter til målet. Breakout ned snur og tar stop. Da lønner "kun long" seg. */
function upTrendMarket(days: string[]): Candle[] {
  const out: Candle[] = [];
  days.forEach((date, i) => {
    out.push(...rangeBars(date));
    if (i % 2 === 0) {
      out.push(bar(15, 20030, 20055, 20028, 20050, 1, date), bar(20, 20050, 20160, 20048, 20155, 1, date), bar(25, 20155, 20158, 20150, 20155, 1, date));
    } else {
      out.push(bar(15, 20010, 20012, 19985, 19990, 1, date), bar(20, 19990, 20030, 19988, 20025, 1, date), bar(25, 20025, 20039, 20020, 20030, 1, date), bar(30, 20030, 20039, 20020, 20030, 1, date));
    }
  });
  return out;
}

/** Hver breakout, både opp og ned, snur og tar stop. Ingenting virker. */
function choppyMarket(days: string[]): Candle[] {
  const out: Candle[] = [];
  days.forEach((date, i) => {
    out.push(...rangeBars(date));
    if (i % 2 === 0) out.push(bar(15, 20030, 20055, 20028, 20050, 1, date), bar(20, 20050, 20052, 19990, 19995, 1, date));
    else out.push(bar(15, 20010, 20012, 19985, 19990, 1, date), bar(20, 19990, 20050, 19988, 20045, 1, date));
  });
  return out;
}

test("rutenettet har bare gyldige kombinasjoner", () => {
  const all = combos();
  assert.ok(all.length > 20);
  assert.ok(all.every((c) => c.entryCutoffMinutes > c.orbMinutes));
});

test("lærer å bare gå long når short-handlene taper", () => {
  const r = learnMarket(upTrendMarket(weekdays("2026-05-04", 60)), NQ, params, current, false);
  assert.equal(r.decision, "adopt");
  assert.equal(r.best.directions, "long");
  assert.ok(r.bestTest.totalR > r.currentTest.totalR);
});

test("setter markedet på pause når ingenting tjener penger", () => {
  const r = learnMarket(choppyMarket(weekdays("2026-05-04", 60)), NQ, params, current, false);
  assert.equal(r.decision, "pause");
});

test("for lite data: endrer ingenting", () => {
  const r = learnMarket(upTrendMarket(weekdays("2026-05-04", 20)), NQ, params, current, false);
  assert.equal(r.decision, "too-little-data");
});

test("beholder innstillingene når de allerede er best", () => {
  const longOnly = { ...current, directions: "long" as const };
  const first = learnMarket(upTrendMarket(weekdays("2026-05-04", 60)), NQ, params, longOnly, false);
  // Kan finne en litt annen variant, men skal ikke bytte uten tydelig forbedring på eksamen
  if (first.decision === "adopt") assert.ok(first.bestTest.totalR >= first.currentTest.totalR + 1.5);
  else assert.equal(first.decision, "keep");
});

test("risiko halveres etter tre tap på rad og etter en dårlig periode", () => {
  assert.equal(riskMultiplier([2, -1, -1, -1]).mult, 0.5);
  assert.equal(riskMultiplier([-1, 2, -1, -1, -1, -0.5, -1]).mult, 0.5);
  assert.equal(riskMultiplier([-1, -1, 2]).mult, 1);
  assert.equal(riskMultiplier([]).mult, 1);
});

test("dagboken regner R og lager en lekse ved tapsrekke", () => {
  const mem = new LearningMemory(null, current);
  for (let i = 0; i < 3; i++) {
    mem.recordOpen("D" + i, { epic: "US100", direction: "BUY", riskAccount: 50, tunable: current, openedAt: "" });
    assert.equal(mem.recordClose("D" + i, -50), -1);
  }
  assert.equal(mem.risk("US100").mult, 0.5);
  assert.equal(mem.state.lessons.at(-1)?.decision, "risk-down");
  mem.recordOpen("W", { epic: "US100", direction: "BUY", riskAccount: 50, tunable: current, openedAt: "" });
  assert.equal(mem.recordClose("W", 100), 2);
  assert.equal(mem.risk("US100").mult, 1);
  assert.equal(mem.state.lessons.at(-1)?.decision, "risk-up");
});

test("handler boten ikke åpnet selv, telles ikke i dagboken", () => {
  const mem = new LearningMemory(null, current);
  assert.equal(mem.recordClose("ukjent", 10), null);
  assert.equal(mem.state.journal.length, 0);
});

test("læringsresultat tas i bruk og huskes", () => {
  const mem = new LearningMemory(null, current);
  const r = learnMarket(upTrendMarket(weekdays("2026-05-04", 60)), NQ, params, current, false);
  apply(mem, r);
  assert.equal(mem.market("US100").tunable.directions, "long");
  const p = learnMarket(choppyMarket(weekdays("2026-05-04", 60)), NQ, params, mem.market("US100").tunable, false);
  apply(mem, p);
  assert.equal(mem.market("US100").paused, true);
});
