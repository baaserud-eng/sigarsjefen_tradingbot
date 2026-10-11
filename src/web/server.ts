import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { BotEvent, TradeStats } from "../core/logger.js";

/**
 * Dashboard på http://localhost:3000.
 *
 * Serveren lytter BARE på denne maskinen (127.0.0.1), så ingen andre på nettet
 * eller i samme Wi-Fi kan åpne den eller trykke på knappene. Den skal aldri
 * legges ut offentlig: den styrer en konto med ekte penger.
 */

export interface DashboardPosition {
  dealId: string;
  epic: string;
  direction: "BUY" | "SELL";
  size: number;
  level: number;
  stopLevel?: number;
  profitLevel?: number;
  upl: number;
  createdAt: string;
}

export interface DashboardMarket {
  epic: string;
  name: string;
  futures: string;
  session: string;
  phase: string;
  phaseText: string;
  rangeHigh?: number;
  rangeLow?: number;
  last?: number;
  signal?: { direction: "BUY" | "SELL"; stop: number; target: number };
  note?: string;
  tradedToday: boolean;
}

export interface DashboardState {
  env: "demo" | "live";
  currency: string;
  balance: number;
  equity: number;
  paused: boolean;
  halted: boolean;
  day: { pnl: number; lossLimit: number; trades: number; maxTrades: number };
  rules: {
    riskPerTradePct: number;
    dailyLossLimitPct: number;
    maxTradesPerDay: number;
    orbMinutes: number;
    entryCutoffMinutes: number;
    rewardRisk: number;
    flatBeforeCloseMinutes: number;
  };
  markets: DashboardMarket[];
  positions: DashboardPosition[];
  stats: TradeStats;
  equityHistory: [string, number][];
  events: BotEvent[];
  startedAt: string;
  lastTick: string | null;
}

export interface DashboardActions {
  pause(): void;
  resume(): void;
  close(dealId: string): Promise<boolean>;
}

const html = readFileSync(fileURLToPath(new URL("./dashboard.html", import.meta.url)), "utf8");

export function startWebServer(port: number, getState: () => Promise<DashboardState>, actions: DashboardActions) {
  const allowedHosts = new Set([`localhost:${port}`, `127.0.0.1:${port}`]);

  const send = (res: ServerResponse, status: number, body: string, type = "application/json; charset=utf-8") => {
    res.writeHead(status, {
      "content-type": type,
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      "x-frame-options": "DENY",
    });
    res.end(body);
  };

  const readBody = (req: IncomingMessage) =>
    new Promise<Record<string, unknown>>((resolve) => {
      let raw = "";
      req.on("data", (c) => {
        raw += c;
        if (raw.length > 10_000) req.destroy();
      });
      req.on("end", () => {
        try {
          resolve(raw ? (JSON.parse(raw) as Record<string, unknown>) : {});
        } catch {
          resolve({});
        }
      });
    });

  const server = createServer(async (req, res) => {
    try {
      // Stopper andre nettsider fra å nå dashboardet via nettleseren din (DNS rebinding).
      if (!allowedHosts.has(req.headers.host ?? "")) return send(res, 403, '{"error":"Ukjent vert"}');
      const url = new URL(req.url ?? "/", `http://${req.headers.host}`);

      if (req.method === "GET" && url.pathname === "/") return send(res, 200, html, "text/html; charset=utf-8");
      if (req.method === "GET" && url.pathname === "/api/state") return send(res, 200, JSON.stringify(await getState()));

      if (req.method === "POST" && url.pathname.startsWith("/api/")) {
        // Knappene sender en egen header. Andre nettsider kan ikke sende den uten
        // en CORS-godkjenning som denne serveren aldri gir.
        const origin = req.headers.origin;
        if (req.headers["x-sigarsjefen"] !== "1" || (origin && !allowedHosts.has(origin.replace(/^https?:\/\//, "")))) {
          return send(res, 403, '{"error":"Ikke tillatt"}');
        }
        if (url.pathname === "/api/pause") {
          actions.pause();
          return send(res, 200, '{"ok":true}');
        }
        if (url.pathname === "/api/resume") {
          actions.resume();
          return send(res, 200, '{"ok":true}');
        }
        if (url.pathname === "/api/close") {
          const body = await readBody(req);
          const dealId = typeof body.dealId === "string" ? body.dealId : "";
          if (!dealId) return send(res, 400, '{"error":"Mangler dealId"}');
          const ok = await actions.close(dealId);
          return send(res, ok ? 200 : 409, JSON.stringify({ ok }));
        }
      }
      send(res, 404, '{"error":"Ikke funnet"}');
    } catch (e) {
      send(res, 500, JSON.stringify({ error: (e as Error).message }));
    }
  });

  server.listen(port, "127.0.0.1");
  return server;
}
