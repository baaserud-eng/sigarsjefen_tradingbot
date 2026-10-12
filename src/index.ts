/**
 * Sigarsjefen: hovedløkke.
 *
 *   skanner (DexScreener) -> sikkerhetssjekk -> risikosjekk -> kjøp via Jupiter
 *   åpne posisjoner sjekkes jevnlig -> salg ved stop-loss, take-profit eller tidsgrense
 *   dashboard på http://localhost:3000
 */
import { Connection } from "@solana/web3.js";
import { loadConfig } from "./config.js";
import { loadHistory, log, recentEvents, tradeStats, useLogFile } from "./core/logger.js";
import { getBalanceSol, loadWallet } from "./core/wallet.js";
import { JupiterSwapper, SOL_MINT } from "./exec/jupiter.js";
import { RiskManager } from "./risk/riskManager.js";
import { checkToken } from "./safety/index.js";
import { DexScreenerScanner } from "./scanner/dexscreener.js";
import { Trader } from "./trader.js";
import { EquityHistory } from "./web/equity.js";
import { startWebServer, type DashboardState } from "./web/server.js";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const cfg = loadConfig();
  const mode = cfg.DRY_RUN ? "dryrun" : "live";
  useLogFile(`events-${mode}.jsonl`);
  loadHistory();

  const conn = new Connection(cfg.SOLANA_RPC_URL, "confirmed");
  const wallet = loadWallet(cfg);
  const startBalance = await getBalanceSol(conn, cfg, wallet);
  const startedAt = new Date().toISOString();

  const risk = new RiskManager(
    {
      maxSolPerTrade: cfg.MAX_SOL_PER_TRADE,
      dailyLossLimitPct: cfg.DAILY_LOSS_LIMIT_PCT,
      maxOpenPositions: cfg.MAX_OPEN_POSITIONS,
    },
    startBalance,
    `data/state-${mode}.json`,
  );
  const swapper = new JupiterSwapper(conn, cfg, wallet);
  const trader = new Trader({
    cfg,
    risk,
    swapper,
    checkSafety: (mint) => checkToken(conn, cfg, mint),
    walletBalanceSol: () => getBalanceSol(conn, cfg, wallet),
  });
  const scanner = new DexScreenerScanner();
  const equity = new EquityHistory(`data/equity-${mode}.json`);

  // Saldo + verdien av åpne posisjoner. Saldoen caches så dashboardet ikke spør RPC hvert 2. sekund.
  let lastBalance = await trader.balanceSol();

  // SOL-kurs i dollar, så dashboardet kan vise gevinst og tap i $. Hentes fra Jupiter (1 SOL -> USDC) hvert minutt.
  const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
  let solUsd: number | null = null;
  const refreshSolUsd = async () => {
    try {
      const q = await swapper.quote(SOL_MINT, USDC, 1_000_000_000n);
      const px = Number(q.outAmount) / 1e6;
      if (px > 0) solUsd = px;
    } catch {
      /* beholder forrige kurs */
    }
  };
  await refreshSolUsd();
  setInterval(refreshSolUsd, 60_000).unref();
  const totalValue = () =>
    lastBalance +
    risk.state.openPositions.reduce((s, p) => s + (trader.valuations.get(p.mint)?.valueSol ?? p.sizeSol), 0);

  log("start", `Sigarsjefen starter i ${cfg.DRY_RUN ? "DRY RUN (simulerte handler, ingen ekte penger)" : "LIVE-modus"}`, {
    dryRun: cfg.DRY_RUN,
    wallet: wallet?.publicKey.toBase58() ?? null,
    balanceSol: lastBalance,
  });

  if (cfg.WEB_ENABLED) {
    const getState = async (): Promise<DashboardState> => ({
      mode: cfg.DRY_RUN ? "dry" : "live",
      wallet: wallet?.publicKey.toBase58() ?? null,
      balanceSol: lastBalance,
      solUsd,
      paused: trader.paused,
      halted: risk.state.halted,
      rules: {
        maxSolPerTrade: cfg.MAX_SOL_PER_TRADE,
        dailyLossLimitPct: cfg.DAILY_LOSS_LIMIT_PCT,
        maxOpenPositions: cfg.MAX_OPEN_POSITIONS,
        stopLossPct: cfg.STOP_LOSS_PCT,
        takeProfitPct: cfg.TAKE_PROFIT_PCT,
        maxHoldMinutes: cfg.MAX_HOLD_MINUTES,
        minSafetyScore: cfg.MIN_SAFETY_SCORE,
        minLiquidityUsd: cfg.MIN_LIQUIDITY_USD,
        maxTop10HolderPct: cfg.MAX_TOP10_HOLDER_PCT,
      },
      day: {
        realizedPnlSol: risk.state.realizedPnlSol,
        lossLimitSol: risk.lossLimitSol,
        startBalanceSol: risk.state.dayStartBalanceSol,
      },
      positions: risk.state.openPositions.map((p) => {
        const v = trader.valuations.get(p.mint);
        return {
          mint: p.mint,
          ...(p.symbol ? { symbol: p.symbol } : {}),
          sizeSol: p.sizeSol,
          openedAt: p.openedAt,
          ...(v ? { valueSol: v.valueSol, pnlPct: v.pnlPct } : {}),
        };
      }),
      stats: tradeStats(),
      equity: equity.points,
      events: recentEvents(),
      startedAt,
    });
    const server = startWebServer(cfg.WEB_PORT, getState, {
      pause: () => {
        trader.paused = true;
        log("control", "Kjøp pauset fra dashboardet. Åpne posisjoner passes fortsatt på.");
      },
      resume: () => {
        trader.paused = false;
        log("control", "Kjøp startet igjen fra dashboardet.");
      },
      sell: async (mint) => {
        log("control", `Manuelt salg bestilt fra dashboardet (${mint.slice(0, 4)}…${mint.slice(-4)})`);
        const ok = await trader.sellNow(mint);
        lastBalance = await trader.balanceSol().catch(() => lastBalance);
        return ok;
      },
    });
    server.on("listening", () => log("start", `Dashboard: http://localhost:${cfg.WEB_PORT}`));
    server.on("error", (e) => log("error", `Dashboardet kunne ikke starte på port ${cfg.WEB_PORT}: ${e.message}. Endre WEB_PORT i .env.`));
  }

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
    setTimeout(() => process.exit(0), 3000);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);

  // Posisjonssjekk i egen løkke, så salg ikke venter på skanning.
  (async () => {
    let lastSample = 0;
    while (running) {
      try {
        await trader.checkPositions();
        lastBalance = await trader.balanceSol();
        if (Date.now() - lastSample > 15_000) {
          lastSample = Date.now();
          equity.add(totalValue());
        }
      } catch (e) {
        log("error", `Posisjonssjekk feilet: ${(e as Error).message}`);
      }
      await sleep(cfg.CHECK_POSITIONS_SEC * 1000);
    }
  })();

  let lastHeartbeat = 0;
  while (running) {
    try {
      risk.rollDay(totalValue());

      if (!risk.state.halted && !trader.paused) {
        const candidates = await scanner.scan();
        if (candidates.length) log("scan", `${candidates.length} nye tokens funnet`);
        for (const c of candidates) {
          if (!running || risk.state.halted || trader.paused) break;
          await trader.consider(c.mint, c.source);
          // Litt pause mellom hver sjekk, så gratisplanen hos Helius ikke blokkerer oss (429).
          await sleep(400);
        }
        lastBalance = await trader.balanceSol();
      }

      if (Date.now() - lastHeartbeat > 60_000) {
        lastHeartbeat = Date.now();
        log("heartbeat", `Saldo ${lastBalance.toFixed(4)} SOL · åpne ${risk.state.openPositions.length} · dagens PnL ${risk.state.realizedPnlSol >= 0 ? "+" : ""}${risk.state.realizedPnlSol.toFixed(4)} SOL${solUsd ? ` (${risk.state.realizedPnlSol < 0 ? "−" : "+"}$${Math.abs(risk.state.realizedPnlSol * solUsd).toFixed(2)})` : ""}${risk.state.halted ? " · STOPPET FOR I DAG" : trader.paused ? " · PAUSET" : ""}`);
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
