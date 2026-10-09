/**
 * Sigarsjefen: hovedløkke.
 *
 *   skanner (DexScreener) -> sikkerhetssjekk -> risikosjekk -> kjøp via Jupiter
 *   åpne posisjoner sjekkes jevnlig -> salg ved stop-loss, take-profit eller tidsgrense
 */
import { Connection } from "@solana/web3.js";
import { loadConfig } from "./config.js";
import { log } from "./core/logger.js";
import { getBalanceSol, loadWallet } from "./core/wallet.js";
import { JupiterSwapper } from "./exec/jupiter.js";
import { RiskManager } from "./risk/riskManager.js";
import { checkToken } from "./safety/index.js";
import { DexScreenerScanner } from "./scanner/dexscreener.js";
import { Trader } from "./trader.js";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const cfg = loadConfig();
  const conn = new Connection(cfg.SOLANA_RPC_URL, "confirmed");
  const wallet = loadWallet(cfg);
  const startBalance = await getBalanceSol(conn, cfg, wallet);

  const risk = new RiskManager(
    {
      maxSolPerTrade: cfg.MAX_SOL_PER_TRADE,
      dailyLossLimitPct: cfg.DAILY_LOSS_LIMIT_PCT,
      maxOpenPositions: cfg.MAX_OPEN_POSITIONS,
    },
    startBalance,
    cfg.DRY_RUN ? "data/state-dryrun.json" : "data/state-live.json",
  );
  const trader = new Trader({
    cfg,
    risk,
    swapper: new JupiterSwapper(conn, cfg, wallet),
    checkSafety: (mint) => checkToken(conn, cfg, mint),
    walletBalanceSol: () => getBalanceSol(conn, cfg, wallet),
  });
  const scanner = new DexScreenerScanner();

  log("start", `Sigarsjefen starter i ${cfg.DRY_RUN ? "DRY RUN (simulerte handler, ingen ekte penger)" : "LIVE-modus"}`, {
    dryRun: cfg.DRY_RUN,
    wallet: wallet?.publicKey.toBase58() ?? null,
    balanceSol: await trader.balanceSol(),
    rules: {
      maxSolPerTrade: cfg.MAX_SOL_PER_TRADE,
      dailyLossLimitPct: cfg.DAILY_LOSS_LIMIT_PCT,
      maxOpenPositions: cfg.MAX_OPEN_POSITIONS,
      stopLossPct: cfg.STOP_LOSS_PCT,
      takeProfitPct: cfg.TAKE_PROFIT_PCT,
      minSafetyScore: cfg.MIN_SAFETY_SCORE,
    },
  });

  if (!cfg.DRY_RUN) {
    if (startBalance <= cfg.MIN_SOL_RESERVE + 0.005) {
      throw new Error(`For lite SOL i bot-walleten (${startBalance.toFixed(4)} SOL). Send SOL til ${wallet!.publicKey.toBase58()} først.`);
    }
    log("start", `LIVE-modus: ekte SOL brukes fra ${wallet!.publicKey.toBase58()}. Trykk Ctrl+C innen 10 sekunder for å avbryte.`);
    await sleep(10_000);
  }

  let running = true;
  const stop = () => {
    if (!running) process.exit(0);
    running = false;
    log("halt", "Stopper Sigarsjefen… (åpne posisjoner blir liggende og sjekkes neste gang boten starter)");
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);

  // Posisjonssjekk i egen løkke, så salg ikke venter på skanning.
  (async () => {
    while (running) {
      try {
        await trader.checkPositions();
      } catch (e) {
        log("error", `Posisjonssjekk feilet: ${(e as Error).message}`);
      }
      await sleep(cfg.CHECK_POSITIONS_SEC * 1000);
    }
  })();

  let lastHeartbeat = 0;
  while (running) {
    try {
      const bal = await trader.balanceSol();
      risk.rollDay(bal + risk.state.openPositions.reduce((s, p) => s + p.sizeSol, 0));

      if (!risk.state.halted) {
        const candidates = await scanner.scan();
        if (candidates.length) log("scan", `${candidates.length} nye tokens funnet`);
        for (const c of candidates) {
          if (!running || risk.state.halted) break;
          await trader.consider(c.mint, c.source);
        }
      }

      if (Date.now() - lastHeartbeat > 60_000) {
        lastHeartbeat = Date.now();
        log("heartbeat", `Saldo ${(await trader.balanceSol()).toFixed(4)} SOL · åpne ${risk.state.openPositions.length} · dagens PnL ${risk.state.realizedPnlSol >= 0 ? "+" : ""}${risk.state.realizedPnlSol.toFixed(4)} SOL${risk.state.halted ? " · STOPPET FOR I DAG" : ""}`);
      }
    } catch (e) {
      log("error", (e as Error).message);
    }
    await sleep(cfg.SCAN_INTERVAL_SEC * 1000);
  }
}

main().catch((e) => {
  log("error", (e as Error).message);
  process.exit(1);
});
