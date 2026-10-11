import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.SIGARSJEFEN_DATA_DIR = mkdtempSync(join(tmpdir(), "sigar-"));

const { Bot } = await import("../src/bot.js");
const { DayGuard } = await import("../src/risk.js");
const { KNOWN_MARKETS } = await import("../src/markets.js");
import type { Broker, OpenPosition, OpenRequest } from "../src/broker/types.js";
import type { Candle } from "../src/strategy/orb.js";
import { at, bar, params, rangeBars } from "./helpers.js";

class FakeBroker implements Broker {
  candleData: Candle[] = [];
  pos: OpenPosition[] = [];
  opened: OpenRequest[] = [];
  closed: string[] = [];
  balance = 10000;
  bid = 20049;
  offer = 20050;
  minSize = 0.01;
  async candles() {
    return this.candleData;
  }
  async market(epic: string) {
    return { epic, name: epic, currency: "USD", minSize: this.minSize, sizeStep: 0.01, bid: this.bid, offer: this.offer, tradeable: true };
  }
  async account() {
    return { balance: this.balance, available: this.balance, profitLoss: 0, currency: "NOK" };
  }
  async positions() {
    return this.pos;
  }
  async open(r: OpenRequest) {
    this.opened.push(r);
    this.pos.push({ dealId: "D" + this.opened.length, epic: r.epic, direction: r.direction, size: r.size, level: this.offer, stopLevel: r.stopLevel, profitLevel: r.profitLevel, upl: 0, createdAt: "" });
    return { dealId: "D" + this.opened.length, level: this.offer };
  }
  async close(id: string) {
    this.closed.push(id);
    this.pos = this.pos.filter((p) => p.dealId !== id);
    return {};
  }
  async fx() {
    return 10;
  }
}

function setup(nowMs: number) {
  const broker = new FakeBroker();
  let now = nowMs;
  const bot = new Bot(broker, new DayGuard(2, 3, null), [KNOWN_MARKETS.US100!], { riskPerTradePct: 0.5, orb: params }, () => now);
  return { broker, bot, setNow: (t: number) => (now = t) };
}

const breakout = () => [...rangeBars(), bar(15, 20030, 20055, 20028, 20050)];

test("breakout gir ordre med stop på range-bunnen, mål 2R og riktig størrelse", async () => {
  const { broker, bot } = setup(at(20.5));
  broker.candleData = breakout();
  await bot.tick();
  assert.equal(broker.opened.length, 1);
  const o = broker.opened[0]!;
  assert.equal(o.direction, "BUY");
  assert.equal(o.stopLevel, 20000);
  assert.equal(o.profitLevel, 20150); // 20050 + 2 * 50
  assert.equal(o.size, 0.1); // 50 kr / (50 poeng * 10)
});

test("kjøper bare én gang per marked per dag", async () => {
  const { broker, bot } = setup(at(20.5));
  broker.candleData = breakout();
  await bot.tick();
  broker.pos = []; // posisjonen stengt (stop/mål)
  await bot.tick();
  assert.equal(broker.opened.length, 1);
});

test("pauset bot kjøper ikke", async () => {
  const { broker, bot } = setup(at(20.5));
  broker.candleData = breakout();
  bot.paused = true;
  await bot.tick();
  assert.equal(broker.opened.length, 0);
});

test("gammelt signal (boten var av) gir ingen ordre", async () => {
  const { broker, bot } = setup(at(60));
  broker.candleData = breakout();
  await bot.tick();
  assert.equal(broker.opened.length, 0);
});

test("pris tilbake forbi stop gir ingen ordre", async () => {
  const { broker, bot } = setup(at(20.5));
  broker.candleData = breakout();
  broker.offer = 19995;
  broker.bid = 19994;
  await bot.tick();
  assert.equal(broker.opened.length, 0);
});

test("for liten konto for minste størrelse gir ingen ordre", async () => {
  const { broker, bot } = setup(at(20.5));
  broker.candleData = breakout();
  broker.minSize = 1;
  await bot.tick();
  assert.equal(broker.opened.length, 0);
});

test("lukker åpne posisjoner før sesjonsslutt", async () => {
  const { broker, bot } = setup(at(390 - 10));
  broker.pos = [{ dealId: "X", epic: "US100", direction: "BUY", size: 0.1, level: 20000, upl: 12, createdAt: "" }];
  await bot.tick();
  assert.deepEqual(broker.closed, ["X"]);
});

test("helg: ingenting skjer", async () => {
  const { broker, bot } = setup(at(20.5, "2026-10-10"));
  broker.candleData = breakout();
  await bot.tick();
  assert.equal(broker.opened.length, 0);
  assert.equal(bot.views.get("US100")?.phase, "closed");
});
