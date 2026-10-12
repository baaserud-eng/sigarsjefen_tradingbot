import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import type { BotEvent, TradeStats } from "../core/logger.js";

/**
 * Dashboard på http://localhost:3000.
 *
 * Serveren lytter BARE på denne maskinen (127.0.0.1), så ingen andre på nettet
 * eller i samme Wi-Fi kan åpne den eller trykke på knappene. Den skal aldri
 * legges ut offentlig: den styrer en wallet med ekte penger.
 */

export interface DashboardPosition {
  mint: string;
  symbol?: string;
  sizeSol: number;
  openedAt: string;
  valueSol?: number;
  pnlPct?: number;
}

export interface DashboardState {
  mode: "dry" | "live";
  wallet: string | null;
  balanceSol: number;
  /** Pris for 1 SOL i dollar (fra Jupiter). null hvis den ikke er hentet ennå. */
  solUsd: number | null;
  paused: boolean;
  halted: boolean;
  rules: {
    maxSolPerTrade: number;
    dailyLossLimitPct: number;
    maxOpenPositions: number;
    stopLossPct: number;
    takeProfitPct: number;
    maxHoldMinutes: number;
    minSafetyScore: number;
    minLiquidityUsd: number;
    maxTop10HolderPct: number;
  };
  day: { realizedPnlSol: number; lossLimitSol: number; startBalanceSol: number };
  positions: DashboardPosition[];
  stats: TradeStats;
  equity: [string, number][];
  events: BotEvent[];
  startedAt: string;
}

export interface DashboardActions {
  pause(): void;
  resume(): void;
  sell(mint: string): Promise<boolean>;
}

const html = readFileSync(fileURLToPath(new URL("./dashboard.html", import.meta.url)), "utf8");
const lab = readFileSync(fileURLToPath(new URL("./lab.html", import.meta.url)), "utf8");

/** 3D-biblioteket (three.js) ligger lokalt i web/vendor, så laben virker uten nett. Lastes inn i minnet ved oppstart. */
const vendorDir = fileURLToPath(new URL("./vendor", import.meta.url));
const vendor = new Map<string, { body: Buffer; type: string }>();
(function loadVendor(dir: string) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) loadVendor(full);
    else if (/\.(js|txt)$/.test(name)) {
      const key = "/vendor/" + relative(vendorDir, full).split(sep).join("/");
      vendor.set(key, { body: readFileSync(full), type: name.endsWith(".js") ? "text/javascript; charset=utf-8" : "text/plain; charset=utf-8" });
    }
  }
})(vendorDir);

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

      if (req.method === "GET" && url.pathname === "/") return send(res, 200, lab, "text/html; charset=utf-8");
      if (req.method === "GET" && vendor.has(url.pathname)) {
        const f = vendor.get(url.pathname)!;
        res.writeHead(200, { "content-type": f.type, "cache-control": "max-age=86400", "x-content-type-options": "nosniff" });
        return res.end(f.body);
      }
      if (req.method === "GET" && url.pathname === "/klassisk") return send(res, 200, html, "text/html; charset=utf-8");
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
        if (url.pathname === "/api/sell") {
          const body = await readBody(req);
          const mint = typeof body.mint === "string" ? body.mint : "";
          if (!mint) return send(res, 400, '{"error":"Mangler mint"}');
          const ok = await actions.sell(mint);
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
