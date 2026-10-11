import type { Broker } from "../broker/types.js";
import { log } from "../core/logger.js";
import type { MarketDef } from "../markets.js";
import type { OrbParams } from "../strategy/orb.js";
import { fetchHistory } from "./history.js";
import type { LearningMemory } from "./memory.js";
import { describe, learnMarket, type LearnResult } from "./optimizer.js";

/**
 * Kjør læringen for alle markeder og ta i bruk det den finner.
 * Kalles én gang i døgnet etter at markedene har stengt, og ved oppstart hvis det er lenge siden.
 */
export async function runLearning(broker: Broker, markets: MarketDef[], memory: LearningMemory, base: OrbParams, days: number): Promise<LearnResult[]> {
  const results: LearnResult[] = [];
  log("learn", `Lærer av de siste ${days} dagene for ${markets.map((m) => m.epic).join(", ")}…`);
  for (const m of markets) {
    try {
      const candles = await fetchHistory(broker, m.epic, days);
      const mem = memory.market(m.epic);
      const r = learnMarket(candles, m, base, mem.tunable, mem.paused);
      results.push(r);
      apply(memory, r);
    } catch (e) {
      log("error", `Læring for ${m.epic} feilet: ${(e as Error).message}`, { epic: m.epic });
    }
  }
  memory.state.lastRun = new Date().toISOString();
  memory.save();
  return results;
}

export function apply(memory: LearningMemory, r: LearnResult) {
  const now = new Date().toISOString();
  const prev = memory.market(r.epic);
  switch (r.decision) {
    case "adopt":
    case "resume":
      memory.setMarket(r.epic, { tunable: r.best, paused: false, updatedAt: now, reason: r.reason });
      memory.lesson(r.epic, r.decision, `${r.decision === "resume" ? "Starter igjen" : "Bytter"} til ${describe(r.best)}. ${r.reason}`);
      log("learn", `${r.epic}: ${r.decision === "resume" ? "starter igjen med" : "bytter til"} ${describe(r.best)}. ${r.reason}`, { epic: r.epic, decision: r.decision });
      break;
    case "pause":
      memory.setMarket(r.epic, { ...prev, paused: true, updatedAt: now, reason: r.reason });
      if (!prev.paused) memory.lesson(r.epic, "pause", r.reason);
      log("learn", `${r.epic}: på pause. ${r.reason}`, { epic: r.epic, decision: r.decision });
      break;
    default:
      memory.setMarket(r.epic, { ...prev, updatedAt: now, reason: r.reason });
      log("learn", `${r.epic}: ${r.reason}`, { epic: r.epic, decision: r.decision });
  }
}
