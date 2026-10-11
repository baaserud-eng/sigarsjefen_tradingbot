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
import { fetchHistory } from "../learn/history.js";
import { backtest } from "../strategy/backtest.js";

const cfg = loadConfig();
const broker = new CapitalBroker({ env: cfg.CAPITAL_ENV, apiKey: cfg.CAPITAL_API_KEY, identifier: cfg.CAPITAL_IDENTIFIER, password: cfg.CAPITAL_API_PASSWORD });
const p = orbParams(cfg);

await broker.login();
console.log(`\nBacktest av opening range breakout · siste ${cfg.BACKTEST_DAYS} dager · range ${p.orbMinutes} min · mål ${p.rewardRisk}R\n`);

const results: Record<string, unknown> = {};
const rows: string[][] = [];
for (const epic of cfg.MARKETS) {
  const m = marketDef(epic);
  process.stdout.write(`Henter ${epic} `);
  const candles = await fetchHistory(broker, epic, cfg.BACKTEST_DAYS, () => process.stdout.write("."));
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
