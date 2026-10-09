import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

/**
 * Alt boten gjør logges som én JSON-linje per hendelse i data/events.jsonl.
 * Dashboardet kan senere lese denne filen (eller samme hendelser fra en database).
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
  | "error";

export interface BotEvent {
  ts: string;
  type: EventType;
  msg: string;
  data?: Record<string, unknown>;
}

const DATA_DIR = process.env.SIGARSJEFEN_DATA_DIR ?? "data";
const FILE = join(DATA_DIR, "events.jsonl");

const colors: Partial<Record<EventType, string>> = {
  buy: "\x1b[32m",
  sell: "\x1b[32m",
  stop: "\x1b[31m",
  rug: "\x1b[31m",
  halt: "\x1b[31m",
  error: "\x1b[31m",
  risk_block: "\x1b[33m",
  safety: "\x1b[36m",
};

export function log(type: EventType, msg: string, data?: Record<string, unknown>): BotEvent {
  const ev: BotEvent = { ts: new Date().toISOString(), type, msg, ...(data ? { data } : {}) };
  const time = ev.ts.slice(11, 19);
  const c = colors[type] ?? "\x1b[90m";
  console.log(`${time} ${c}${type.toUpperCase().padEnd(10)}\x1b[0m ${msg}`);
  try {
    mkdirSync(DATA_DIR, { recursive: true });
    appendFileSync(FILE, JSON.stringify(ev) + "\n");
  } catch {
    // Logging til fil skal aldri stoppe boten.
  }
  return ev;
}
