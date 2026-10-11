/**
 * Kjør læringen manuelt og se hva boten fant ut:
 *   npm run learn
 *
 * Boten gjør dette selv én gang i døgnet etter at markedene har stengt.
 */
import { CapitalBroker } from "../broker/capital.js";
import { loadConfig, orbParams } from "../config.js";
import { LearningMemory } from "../learn/memory.js";
import { runLearning } from "../learn/learner.js";
import { describe } from "../learn/optimizer.js";
import { marketDef } from "../markets.js";

const cfg = loadConfig();
const broker = new CapitalBroker({ env: cfg.CAPITAL_ENV, apiKey: cfg.CAPITAL_API_KEY, identifier: cfg.CAPITAL_IDENTIFIER, password: cfg.CAPITAL_API_PASSWORD });
const base = orbParams(cfg);
const memory = new LearningMemory(`data/learning-${cfg.CAPITAL_ENV}.json`, {
  orbMinutes: base.orbMinutes,
  rewardRisk: base.rewardRisk,
  entryCutoffMinutes: base.entryCutoffMinutes,
  directions: "both",
});

await broker.login();
const results = await runLearning(broker, cfg.MARKETS.map(marketDef), memory, base, cfg.LEARN_DAYS);

const word = { adopt: "BYTTER", keep: "BEHOLDER", pause: "PAUSE", resume: "STARTER IGJEN", "too-little-data": "FOR LITE DATA" } as const;
console.log("\nResultat (lete-periode = eldste 2/3, eksamen = nyeste 1/3 som innstillingene aldri har sett):\n");
for (const r of results) {
  console.log(`${r.epic.padEnd(10)} ${word[r.decision]}`);
  console.log(`  Nå:      ${describe(r.current)}  ->  eksamen ${r.currentTest.totalR >= 0 ? "+" : ""}${r.currentTest.totalR}R på ${r.currentTest.trades} handler`);
  if (r.decision !== "too-little-data") {
    console.log(`  Beste:   ${describe(r.best)}  ->  eksamen ${r.bestTest.totalR >= 0 ? "+" : ""}${r.bestTest.totalR}R på ${r.bestTest.trades} handler`);
  }
  console.log(`  ${r.reason}\n`);
}
console.log("Boten bruker disse innstillingene neste gang den starter. Alt er lagret i data/learning-*.json.\n");
