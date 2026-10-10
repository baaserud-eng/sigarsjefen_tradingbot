import { Connection, Keypair, LAMPORTS_PER_SOL } from "@solana/web3.js";
import bs58 from "bs58";
import type { Config } from "../config.js";

/**
 * Laster bot-walleten fra .env. I DRY_RUN brukes ingen ekte wallet,
 * og saldoen er PAPER_START_SOL.
 */
export function loadWallet(cfg: Config): Keypair | null {
  if (cfg.DRY_RUN) return null;
  try {
    return Keypair.fromSecretKey(bs58.decode(cfg.BOT_WALLET_PRIVATE_KEY.trim()));
  } catch {
    throw new Error("BOT_WALLET_PRIVATE_KEY i .env er ikke en gyldig base58 private key");
  }
}

export async function getBalanceSol(conn: Connection, cfg: Config, wallet: Keypair | null): Promise<number> {
  if (!wallet) return cfg.PAPER_START_SOL;
  return (await conn.getBalance(wallet.publicKey)) / LAMPORTS_PER_SOL;
}
