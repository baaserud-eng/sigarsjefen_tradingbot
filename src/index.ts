/**
 * Sigarsjefen: opening range breakout på US100 (NQ), US500 (ES), gull og olje
 * via Capital.com. Dashboard på http://localhost:3000.
 */
import { Bot, phaseText } from "./bot.js";
import { CapitalBroker } from "./broker/capital.js";
import { loadConfig, orbParams } from "./config.js";
import { loadHistory, log, recentEvents, tradeStats, useLogFile } from "./core/logger.js";
import { nyParts } from "./core/time.js";
import { runLearning } from "./learn/learner.js";
import { LearningMemory } from "./learn/memory.js";
import { marketDef } from "./markets.js";
import { DayGuard } from "./risk.js";
import { EquityHistory } from "./web/equity.js";
import { startWebServer, type DashboardState } from "./web/server.js";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const cfg = loadConfig();
  const env = cfg.CAPITAL_ENV;
  useLogFile(`events-${env}.jsonl`);
  loadHistory();

  const broker = new CapitalBroker({ env, apiKey: cfg.CAPITAL_API_KEY, identifier: cfg.CAPITAL_IDENTIFIER, password: cfg.CAPITAL_API_PASSWORD });
  await broker.login();

  const markets = cfg.MARKETS.map(marketDef);
  const guard = new DayGuard(cfg.DAILY_LOSS_LIMIT_PCT, cfg.MAX_TRADES_PER_DAY, `data/day-${env}.json`);
  const base = orbParams(cfg);
  const memory = new LearningMemory(`data/learning-${env}.json`, {
    orbMinutes: base.orbMinutes,
    rewardRisk: base.rewardRisk,
    entryCutoffMinutes: base.entryCutoffMinutes,
    directions: "both",
  });
  const bot = new Bot(broker, guard, markets, { riskPerTradePct: cfg.RISK_PER_TRADE_PCT, orb: base }, undefined, memory);
  let learning = false;
  /** Læring kjøres utenfor handelstiden (før 08:00 eller etter 16:20 New York-tid, eller i helgen), maks én gang per dag. */
  const maybeLearn = async () => {
    if (!cfg.LEARN_ENABLED || learning) return;
    const ny = nyParts(Date.now());
    const quiet = ny.weekday === 0 || ny.weekday === 6 || ny.minutes < 8 * 60 || ny.minutes >= 16 * 60 + 20;
    const stale = !memory.state.lastRun || Date.now() - new Date(memory.state.lastRun).getTime() > 20 * 3600_000;
    if (!quiet || !stale) return;
    learning = true;
    try {
      await runLearning(broker, markets, memory, base, cfg.LEARN_DAYS);
    } catch (e) {
      log("error", `Læringen feilet: ${(e as Error).message}`);
    } finally {
      learning = false;
    }
  };
  const equity = new EquityHistory(`data/equity-${env}.json`);
  const startedAt = new Date().toISOString();
  let lastTick: string | null = null;

  const acc = await broker.account();
  log("start", `Sigarsjefen starter på Capital.com ${env === "live" ? "LIVE (ekte penger)" : "DEMO (lekepenger)"} · saldo ${acc.balance.toFixed(2)} ${acc.currency} · markeder ${cfg.MARKETS.join(", ")}`);

  if (cfg.WEB_ENABLED) {
    const getState = async (): Promise<DashboardState> => ({
      env,
      currency: bot.account?.currency ?? acc.currency,
      balance: bot.account?.balance ?? acc.balance,
      equity: bot.account ? bot.equity() : acc.balance,
      paused: bot.paused,
      halted: guard.state.halted,
      day: {
        pnl: bot.account ? guard.dayPnl(bot.equity()) : 0,
        lossLimit: guard.lossLimit,
        trades: guard.state.traded.length,
        maxTrades: cfg.MAX_TRADES_PER_DAY,
      },
      rules: {
        riskPerTradePct: cfg.RISK_PER_TRADE_PCT,
        dailyLossLimitPct: cfg.DAILY_LOSS_LIMIT_PCT,
        maxTradesPerDay: cfg.MAX_TRADES_PER_DAY,
        orbMinutes: cfg.ORB_MINUTES,
        entryCutoffMinutes: cfg.ENTRY_CUTOFF_MINUTES,
        rewardRisk: cfg.REWARD_RISK,
        flatBeforeCloseMinutes: cfg.FLAT_BEFORE_CLOSE_MINUTES,
      },
      markets: markets.map((m) => {
        const v = bot.views.get(m.epic);
        return {
          epic: m.epic,
          name: m.name,
          futures: m.futures,
          session: v?.session ?? "",
          phase: v?.phase ?? "closed",
          phaseText: phaseText(v?.phase ?? "closed"),
          ...(v?.rangeHigh !== undefined ? { rangeHigh: v.rangeHigh } : {}),
          ...(v?.rangeLow !== undefined ? { rangeLow: v.rangeLow } : {}),
          ...(v?.last !== undefined ? { last: v.last } : {}),
          ...(v?.signal ? { signal: { direction: v.signal.direction, stop: v.signal.stop, target: v.signal.target } } : {}),
          ...(v?.note ? { note: v.note } : {}),
          tradedToday: guard.state.traded.includes(m.epic),
          learned: v?.learned ?? "",
          learnedPaused: v?.learnedPaused ?? false,
          riskMult: v?.riskMult ?? 1,
        };
      }),
      learning: {
        enabled: cfg.LEARN_ENABLED,
        running: learning,
        lastRun: memory.state.lastRun,
        lessons: memory.state.lessons.slice(-20).reverse(),
        journalTrades: memory.state.journal.length,
      },
      positions: bot.positions,
      stats: tradeStats(),
      equityHistory: equity.points,
      events: recentEvents(),
      startedAt,
      lastTick,
    });
    const server = startWebServer(cfg.WEB_PORT, getState, {
      pause: () => {
        bot.paused = true;
        log("control", "Nye handler pauset fra dashboardet. Åpne posisjoner beholder stop og mål.");
      },
      resume: () => {
        bot.paused = false;
        log("control", "Handel startet igjen fra dashboardet.");
      },
      close: async (dealId) => {
        log("control", `Manuell lukking bestilt fra dashboardet (${dealId})`);
        try {
          return await bot.closeNow(dealId);
        } catch (e) {
          log("error", `Lukking feilet: ${(e as Error).message}`);
          return false;
        }
      },
    });
    server.on("listening", () => log("start", `Dashboard: http://localhost:${cfg.WEB_PORT}`));
    server.on("error", (e) => log("error", `Dashboardet kunne ikke starte på port ${cfg.WEB_PORT}: ${e.message}. Endre WEB_PORT i .env.`));
  }

  if (env === "live") {
    log("start", "LIVE-modus: ekte penger. Trykk Ctrl+C innen 10 sekunder for å avbryte.");
    await sleep(10_000);
  }

  let running = true;
  const stop = () => {
    if (!running) process.exit(0);
    running = false;
    log("halt", "Stopper Sigarsjefen. Åpne posisjoner beholder stop-loss og mål hos Capital.com.");
    setTimeout(() => process.exit(0), 2000);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);

  void maybeLearn();
  let lastSample = 0;
  let lastHeartbeat = 0;
  while (running) {
    try {
      await bot.tick();
      lastTick = new Date().toISOString();
      void maybeLearn();
      if (Date.now() - lastSample > 60_000) {
        lastSample = Date.now();
        equity.add(bot.equity());
      }
      if (Date.now() - lastHeartbeat > 5 * 60_000) {
        lastHeartbeat = Date.now();
        const a = bot.account!;
        log("heartbeat", `Konto ${bot.equity().toFixed(2)} ${a.currency} · i dag ${guard.dayPnl(bot.equity()) >= 0 ? "+" : ""}${guard.dayPnl(bot.equity()).toFixed(2)} · åpne ${bot.positions.length}${guard.state.halted ? " · STOPPET FOR I DAG" : bot.paused ? " · PAUSET" : ""}`);
      }
    } catch (e) {
      log("error", (e as Error).message);
    }
    await sleep(cfg.LOOP_SECONDS * 1000);
  }
}

main().catch((e) => {
  log("error", (e as Error).message);
  process.exit(1);
});
