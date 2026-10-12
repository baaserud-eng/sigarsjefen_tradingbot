import { test } from "node:test";
import assert from "node:assert/strict";
import { scoreToken, type TokenFacts } from "../src/safety/score.js";

const rules = { minScore: 70, minLiquidityUsd: 15000, maxTop10HolderPct: 30 };
const safe: TokenFacts = {
  mint: "SAFE",
  mintAuthority: null,
  freezeAuthority: null,
  riskyExtensions: [],
  top10HolderPct: 18,
  liquidityUsd: 60000,
  poolAgeMinutes: 120,
};

test("trygg token blir godkjent med full score", () => {
  const r = scoreToken(safe, rules);
  assert.equal(r.score, 100);
  assert.equal(r.passed, true);
});

test("mint authority gir alltid avslag", () => {
  const r = scoreToken({ ...safe, mintAuthority: "Dev111" }, rules);
  assert.equal(r.passed, false);
  assert.ok(r.findings.some((f) => f.severity === "critical"));
});

test("freeze authority gir alltid avslag", () => {
  assert.equal(scoreToken({ ...safe, freezeAuthority: "Dev111" }, rules).passed, false);
});

test("ingen pool gir avslag", () => {
  assert.equal(scoreToken({ ...safe, liquidityUsd: null }, rules).passed, false);
});

test("likviditet under minimum gir alltid avslag", () => {
  const r = scoreToken({ ...safe, liquidityUsd: 12000 }, rules);
  assert.equal(r.passed, false);
  assert.ok(r.findings.some((f) => f.severity === "critical"));
});

test("topp-10 over grensen gir alltid avslag, også bare litt over", () => {
  assert.equal(scoreToken({ ...safe, top10HolderPct: 31 }, rules).passed, false);
});

test("ukjente topp-holdere gir avslag (kan ikke verifiseres)", () => {
  assert.equal(scoreToken({ ...safe, top10HolderPct: null }, rules).passed, false);
});

test("nær grensene gir trekk, men godkjennes", () => {
  const r = scoreToken({ ...safe, top10HolderPct: 25, liquidityUsd: 20000 }, rules);
  assert.equal(r.score, 80);
  assert.equal(r.passed, true);
});
