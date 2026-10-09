/**
 * Test at ekte kjøp og salg fungerer, med et lite beløp:
 *   npm run swaptest
 *
 * Bytter 0.002 SOL til USDC og tilbake. Koster bare gebyrer (rundt 0.0005 SOL).
 * Kjør denne én gang før du setter DRY_RUN=false.
 */
import { Connection } from "@solana/web3.js";
import { loadConfig } from "../config.js";
import { loadWallet, getBalanceSol } from "../core/wallet.js";
import { JupiterSwapper, SOL_MINT } from "../exec/jupiter.js";

const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

const cfg = { ...loadConfig({ ...process.env, DRY_RUN: "false" }), DRY_RUN: false };
const conn = new Connection(cfg.SOLANA_RPC_URL, "confirmed");
const wallet = loadWallet(cfg)!;
const swapper = new JupiterSwapper(conn, cfg, wallet);

const before = await getBalanceSol(conn, cfg, wallet);
console.log(`\nWallet ${wallet.publicKey.toBase58()} · saldo ${before.toFixed(4)} SOL`);
if (before < 0.01) {
  console.error("Trenger minst 0.01 SOL i walleten for testen.");
  process.exit(1);
}

console.log("1/2  Kjøper USDC for 0.002 SOL…");
const buy = await swapper.swap(SOL_MINT, USDC, 2_000_000n);
console.log(`     OK · fikk ${(Number(buy.outAmount) / 1e6).toFixed(4)} USDC · https://solscan.io/tx/${buy.signature}`);

console.log("2/2  Selger USDC tilbake til SOL…");
const held = await swapper.tokenBalanceRaw(USDC);
const sell = await swapper.swap(USDC, SOL_MINT, held);
console.log(`     OK · https://solscan.io/tx/${sell.signature}`);

const after = await getBalanceSol(conn, cfg, wallet);
console.log(`\nFerdig. Saldo ${after.toFixed(4)} SOL (kostnad ${(before - after).toFixed(5)} SOL i gebyrer og slippage).`);
console.log("Kjøp og salg fungerer. Du kan nå sette DRY_RUN=false i .env.\n");
