import type { Connection } from "@solana/web3.js";
import type { Config } from "../config.js";
import { fetchTokenFacts } from "./fetchFacts.js";
import { scoreToken, type SafetyResult } from "./score.js";

export async function checkToken(conn: Connection, cfg: Config, mint: string): Promise<SafetyResult> {
  const facts = await fetchTokenFacts(conn, mint);
  return scoreToken(facts, {
    minScore: cfg.MIN_SAFETY_SCORE,
    minLiquidityUsd: cfg.MIN_LIQUIDITY_USD,
    maxTop10HolderPct: cfg.MAX_TOP10_HOLDER_PCT,
  });
}

export { scoreToken } from "./score.js";
export type { SafetyResult, TokenFacts } from "./score.js";
