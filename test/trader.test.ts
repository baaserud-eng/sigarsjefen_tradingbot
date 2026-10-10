import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.SIGARSJEFEN_DATA_DIR = mkdtempSync(join(tmpdir(), "sigar-"));

const { Trader } = await import("../src/trader.js");
const { RiskManager } = await import("../src/risk/riskManager.js");
const { SOL_MINT } = await import("../src/exec/types.js");
import type { Swapper, Quote } from "../src/exec/types.js";
import type { Config } from "../src/config.js";
import type { SafetyResult } from "../src/safety/score.js";

const cfg = {
  DRY_RUN: true,
  PAPER_START_SOL: 1,
  MAX_SOL_PER_TRADE: 0.1,
  MIN_SOL_RESERVE: 0.02,
  STOP_LOSS_PCT: 20,
  TAKE_PROFIT_PCT: 50,
  MAX_HOLD_MINUTES: 60,
  DAILY_LOSS_LIMIT_PCT: 5,
} as unknown as Config;

/** Falsk markedsplass: 1 SOL = 1 000 000 tokens, prisen kan endres i testen. */
class FakeSwapper implements Swapper {
  tokensPerSol = 1_000_000;
  fail = false;
  swaps: string[] = [];
  private calc(input: string, amount: bigint): bigint {
    return input === SOL_MINT
      ? (amount * BigInt(this.tokensPerSol)) / 1_000_000_000n
      : (amount * 1_000_000_000n) / BigInt(this.tokensPerSol);
  }
  async quote(i: string, o: string, a: bigint): Promise<Quote> {
    if (this.fail) throw new Error("ingen rute");
    return { inputMint: i, outputMint: o, inAmount: a.toString(), outAmount: this.calc(i, a).toString(), priceImpactPct: "0" };
  }
  async swap(i: string, o: string, a: bigint) {
    this.swaps.push(i === SOL_MINT ? "buy" : "sell");
    return { signature: null, inAmount: a, outAmount: this.calc(i, a) };
  }
  async tokenBalanceRaw() {
    return 0n;
  }
}

const safe = (mint: string): SafetyResult => ({ mint, symbol: "TEST", score: 90, passed: true, findings: [] });
const unsafe = (mint: string): SafetyResult => ({
  mint,
  score: 20,
  passed: false,
  findings: [{ severity: "critical", points: 40, reason: "Mint authority er på" }],
});

function setup(now = () => new Date("2026-10-09T12:00:00Z"), check = safe) {
  const swapper = new FakeSwapper();
  const risk = new RiskManager({ maxSolPerTrade: 0.1, dailyLossLimitPct: 5, maxOpenPositions: 3 }, 1, null, now);
  const trader = new Trader({ cfg, risk, swapper, checkSafety: async (m) => check(m), walletBalanceSol: async () => 0, now });
  return { swapper, risk, trader };
}

test("kjøper en trygg token, men aldri for mer enn dagens tapsgrense", async () => {
  const { trader, risk, swapper } = setup();
  assert.equal(await trader.consider("MINT1", "test"), "bought");
  assert.equal(risk.state.openPositions.length, 1);
  assert.equal(risk.state.openPositions[0]!.tokenAmountRaw, "50000");
  assert.deepEqual(swapper.swaps, ["buy"]);
});

test("kjøper ikke en token som feiler sikkerhetssjekken", async () => {
  const { trader, swapper } = setup(undefined, unsafe);
  assert.equal(await trader.consider("RUG", "test"), "rejected");
  assert.equal(swapper.swaps.length, 0);
});

test("selger ved take-profit", async () => {
  const { trader, risk, swapper } = setup();
  await trader.consider("MINT1", "test");
  swapper.tokensPerSol = 500_000; // tokenen er doblet i verdi
  await trader.checkPositions();
  assert.equal(risk.state.openPositions.length, 0);
  assert.ok(risk.state.realizedPnlSol > 0.045);
});

test("selger ved stop-loss", async () => {
  const { trader, risk, swapper } = setup();
  await trader.consider("MINT1", "test");
  swapper.tokensPerSol = 1_400_000; // ca. -29 %
  await trader.checkPositions();
  assert.equal(risk.state.openPositions.length, 0);
  assert.ok(risk.state.realizedPnlSol < -0.01);
});

test("holder posisjonen når prisen er innenfor grensene", async () => {
  const { trader, risk, swapper } = setup();
  await trader.consider("MINT1", "test");
  swapper.tokensPerSol = 900_000; // ca. +11 %
  await trader.checkPositions();
  assert.equal(risk.state.openPositions.length, 1);
});

test("selger etter tidsgrensen", async () => {
  let now = new Date("2026-10-09T12:00:00Z");
  const { trader, risk } = setup(() => now);
  await trader.consider("MINT1", "test");
  now = new Date("2026-10-09T13:01:00Z");
  await trader.checkPositions();
  assert.equal(risk.state.openPositions.length, 0);
});

test("token uten pris regnes som tapt etter flere forsøk", async () => {
  const { trader, risk, swapper } = setup();
  await trader.consider("MINT1", "test");
  swapper.fail = true;
  for (let i = 0; i < 6; i++) await trader.checkPositions();
  assert.equal(risk.state.openPositions.length, 0);
  assert.ok(risk.state.realizedPnlSol <= -0.05);
});

test("simulert saldo går ned ved kjøp og følger gevinst/tap", async () => {
  const { trader, swapper } = setup();
  await trader.consider("MINT1", "test");
  assert.ok(Math.abs((await trader.balanceSol()) - (1 - 0.0503)) < 1e-9);
  swapper.tokensPerSol = 500_000;
  await trader.checkPositions();
  assert.ok((await trader.balanceSol()) > 1.045);
});

test("dagstap-grensen stopper nye kjøp", async () => {
  const { trader, risk, swapper } = setup();
  await trader.consider("A", "test");
  swapper.tokensPerSol = 100_000_000; // -99 %
  await trader.checkPositions();
  assert.equal(risk.state.halted, true);
  swapper.tokensPerSol = 1_000_000;
  assert.equal(await trader.consider("B", "test"), "blocked");
});
