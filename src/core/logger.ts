import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Alt boten gjør logges som én JSON-linje per hendelse i data/events.jsonl.
 * De siste hendelsene holdes også i minnet så dashboardet kan vise dem.
 */
export type EventType =
  | "start"
  | "heartbeat"
  | "scan"
  | "safety"
  | "rug"
  | "buy"
  | "sell"
  | "stop"
  | "risk_block"
  | "halt"
  | "control"
  | "error";

export interface BotEvent {
  ts: string;
  type: EventType;
  msg: string;
  data?: Record<string, unknown>;
}

export interface TradeStats {
  trades: number;
  wins: number;
  realizedSol: number;
  best: number;
  worst: number;
}

const DATA_DIR = process.env.SIGARSJEFEN_DATA_DIR ?? "data";
let FILE = join(DATA_DIR, "events.jsonl");
const KEEP = 400;

const recent: BotEvent[] = [];
const stats: TradeStats = { trades: 0, wins: 0, realizedSol: 0, best: 0, worst: 0 };
let historyLoaded = false;

const colors: Partial<Record<EventType, string>> = {
  buy: "\x1b[32m",
  sell: "\x1b[32m",
  stop: "\x1b[31m",
  rug: "\x1b[31m",
  halt: "\x1b[31m",
  error: "\x1b[31m",
  risk_block: "\x1b[33m",
  safety: "\x1b[36m",
  control: "\x1b[35m",
};

function track(ev: BotEvent) {
  recent.push(ev);
  if (recent.length > KEEP) recent.splice(0, recent.length - KEEP);
  const pnl = ev.data?.pnlSol;
  if (typeof pnl === "number" && (ev.type === "sell" || ev.type === "stop" || ev.type === "rug")) {
    stats.trades++;
    if (pnl > 0) stats.wins++;
    stats.realizedSol += pnl;
    stats.best = Math.max(stats.best, pnl);
    stats.worst = Math.min(stats.worst, pnl);
  }
}

/** Egen loggfil for DRY_RUN og LIVE, så simulerte handler ikke blandes med ekte. */
export function useLogFile(name: string) {
  FILE = join(DATA_DIR, name);
}

/** Les tidligere hendelser fra fil ved oppstart, så dashboardet har historikk. */
export function loadHistory() {
  if (historyLoaded) return;
  historyLoaded = true;
  if (!existsSync(FILE)) return;
  try {
    for (const line of readFileSync(FILE, "utf8").split("\n")) {
      if (!line.trim()) continue;
      try {
        track(JSON.parse(line) as BotEvent);
      } catch {
        // hopp over ødelagte linjer
      }
    }
  } catch {
    // ingen historikk er greit
  }
}

export function recentEvents(limit = KEEP): BotEvent[] {
  return recent.slice(-limit);
}

export function tradeStats(): TradeStats {
  return { ...stats };
}

export function log(type: EventType, msg: string, data?: Record<string, unknown>): BotEvent {
  const ev: BotEvent = { ts: new Date().toISOString(), type, msg, ...(data ? { data } : {}) };
  const time = new Date(ev.ts).toLocaleTimeString("nb-NO", { hour12: false });
  const c = colors[type] ?? "\x1b[90m";
  console.log(`${time} ${c}${type.toUpperCase().padEnd(10)}\x1b[0m ${msg}`);
  track(ev);
  try {
    mkdirSync(DATA_DIR, { recursive: true });
    appendFileSync(FILE, JSON.stringify(ev) + "\n");
  } catch {
    // Logging til fil skal aldri stoppe boten.
  }
  return ev;
}
