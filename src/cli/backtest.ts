/**
 * Backtest: hvordan ville strategien gått de siste BACKTEST_DAYS dagene?
 *   npm run backtest
 *
 * Henter historiske 5-minutters lys fra Capital.com (demokonto holder) og kjører
 * nøyaktig samme strategi som boten bruker live.
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { CapitalBroker } from "../broker/capital.js";
import { loadConfig, orbParams } from "../config.js";
import { marketDef } from "../markets.js";
import { backtest } from "../strategy/backtest.js";
import type { Candle } from "../strategy/orb.js";

const cfg = loadConfig();
const broker = new CapitalBroker({ env: cfg.CAPITAL_ENV, apiKey: cfg.CAPITAL_API_KEY, identifier: cfg.CAPITAL_IDENTIFIER, password: cfg.CAPITAL_API_PASSWORD });
const p = orbParams(cfg);

async function history(epic: string, days: number): Promise<Candle[]> {
  const out = new Map<number, Candle>();
  const end = Date.now();
  const start = end - days * 86_400_000;
  // 1000 lys à 5 min = ca. 3,4 døgn per kall
  const chunk = 3 * 86_400_000;
  for (let from = start; from < end; from += chunk) {
    const to = Math.min(end, from + chunk);
    try {
      for (const c of await broker.candles(epic, new Date(from), new Date(to))) out.set(c.t, c);
    } catch (e) {
      const msg = (e as Error).message;
      if (!msg.includes("(404)") && !msg.includes("(400)")) throw e;
    }
    process.stdout.write(".");
  }
  return [...out.values()].sort((a, b) => a.t - b.t);
}

await broker.login();
console.log(`\nBacktest av opening range breakout · siste ${cfg.BACKTEST_DAYS} dager · range ${p.orbMinutes} min · mål ${p.rewardRisk}R\n`);

const results: Record<string, unknown> = {};
const rows: string[][] = [];
for (const epic of cfg.MARKETS) {
  const m = marketDef(epic);
  process.stdout.write(`Henter ${epic} `);
  const candles = await history(epic, cfg.BACKTEST_DAYS);
  console.log(` ${candles.length} lys`);
  if (!candles.length) {
    rows.push([epic, "ingen data", "", "", "", "", ""]);
    continue;
  }
  const { trades, summary: s } = backtest(candles, m, p);
  results[epic] = { summary: s, trades };
  rows.push([
    epic,
    String(s.trades),
    s.trades ? `${Math.round(s.winRate * 100)}%` : "–",
    `${s.totalR >= 0 ? "+" : ""}${s.totalR}R`,
    `${s.avgR >= 0 ? "+" : ""}${s.avgR}R`,
    `-${s.maxDrawdownR}R`,
    Number.isFinite(s.profitFactor) ? String(s.profitFactor) : "∞",
  ]);
}

const head = ["Marked", "Handler", "Treff", "Totalt", "Snitt", "Verste fall", "Profit factor"];
const widths = head.map((h, i) => Math.max(h.length, ...rows.map((r) => (r[i] ?? "").length)));
const line = (r: string[]) => r.map((c, i) => c.padEnd(widths[i]!)).join("   ");
console.log("\n" + line(head));
console.log(widths.map((w) => "-".repeat(w)).join("   "));
for (const r of rows) console.log(line(r));

const riskNote = `1R = ${cfg.RISK_PER_TRADE_PCT}% av kontoen med dine innstillinger.`;
console.log(`\n${riskNote} +10R betyr altså ca. +${(10 * cfg.RISK_PER_TRADE_PCT).toFixed(1)}% av kontoen.`);
console.log("Profit factor over 1 betyr at gevinstene var større enn tapene. Under 1: strategien tapte penger.");
console.log("Historikk er ingen garanti. Spread og slippage i ekte handel kan bli større enn i testen.\n");

mkdirSync("data", { recursive: true });
writeFileSync("data/backtest.json", JSON.stringify({ at: new Date().toISOString(), params: p, results }, null, 2));
console.log("Alle handlene er lagret i data/backtest.json\n");
