/**
 * Sigarsjefen: hovedløkke.
 *
 * Grunnmuren starter boten, laster konfig og risikoregler, og kjører en løkke
 * som foreløpig bare sender heartbeat. Skanner, copytrade og kjøp/salg via
 * Jupiter kobles inn her i neste steg.
 */
import { Connection } from "@solana/web3.js";
import { loadConfig } from "./config.js";
import { log } from "./core/logger.js";
import { getBalanceSol, loadWallet } from "./core/wallet.js";
import { RiskManager } from "./risk/riskManager.js";

const LOOP_MS = 15_000;

async function main() {
  const cfg = loadConfig();
  const conn = new Connection(cfg.SOLANA_RPC_URL, "confirmed");
  const wallet = loadWallet(cfg);
  const balance = await getBalanceSol(conn, cfg, wallet);

  const risk = new RiskManager(
    {
      maxSolPerTrade: cfg.MAX_SOL_PER_TRADE,
      dailyLossLimitPct: cfg.DAILY_LOSS_LIMIT_PCT,
      maxOpenPositions: cfg.MAX_OPEN_POSITIONS,
    },
    balance,
  );

  log("start", `Sigarsjefen starter i ${cfg.DRY_RUN ? "DRY RUN (ingen ekte handler)" : "LIVE-modus"}`, {
    dryRun: cfg.DRY_RUN,
    wallet: wallet?.publicKey.toBase58() ?? null,
    balanceSol: balance,
    rules: {
      maxSolPerTrade: cfg.MAX_SOL_PER_TRADE,
      dailyLossLimitPct: cfg.DAILY_LOSS_LIMIT_PCT,
      maxOpenPositions: cfg.MAX_OPEN_POSITIONS,
      minSafetyScore: cfg.MIN_SAFETY_SCORE,
    },
  });

  if (!cfg.DRY_RUN) {
    log("start", "LIVE-modus er på. Ekte SOL kan brukes. Trykk Ctrl+C innen 10 sekunder for å avbryte.");
    await new Promise((r) => setTimeout(r, 10_000));
  }

  let running = true;
  const stop = () => {
    running = false;
    log("halt", "Stopper Sigarsjefen…");
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);

  while (running) {
    try {
      const bal = await getBalanceSol(conn, cfg, wallet);
      risk.rollDay(bal);
      log("heartbeat", `Saldo ${bal.toFixed(3)} SOL · åpne posisjoner ${risk.state.openPositions.length} · dagens PnL ${risk.state.realizedPnlSol.toFixed(3)} SOL${risk.state.halted ? " · STOPPET" : ""}`);
      // TODO neste steg: scanner -> safety -> risk.canOpen -> executor
    } catch (e) {
      log("error", (e as Error).message);
    }
    await new Promise((r) => setTimeout(r, LOOP_MS));
  }
}

main().catch((e) => {
  log("error", (e as Error).message);
  process.exit(1);
});
