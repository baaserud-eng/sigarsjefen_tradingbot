import "dotenv/config";
import { z } from "zod";

const bool = (def: boolean) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v.trim() === "" ? def : v.trim().toLowerCase() !== "false"));

const num = (def: number) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v.trim() === "" ? def : Number(v)))
    .pipe(z.number().finite());

const schema = z.object({
  // --- Capital.com ---
  CAPITAL_ENV: z
    .string()
    .optional()
    .transform((v) => (v?.trim().toLowerCase() === "live" ? "live" : "demo")),
  CAPITAL_API_KEY: z.string().optional().default(""),
  CAPITAL_IDENTIFIER: z.string().optional().default(""),
  CAPITAL_API_PASSWORD: z.string().optional().default(""),

  // --- Markeder ---
  MARKETS: z
    .string()
    .optional()
    .transform((v) =>
      (v && v.trim() ? v : "US100,US500,GOLD,OIL_CRUDE")
        .split(",")
        .map((s) => s.trim().toUpperCase())
        .filter(Boolean),
    ),

  // --- Strategi (opening range breakout) ---
  ORB_MINUTES: num(15).pipe(z.number().int().min(5).max(120)),
  ENTRY_CUTOFF_MINUTES: num(120).pipe(z.number().int().min(10)),
  REWARD_RISK: num(2).pipe(z.number().positive().max(10)),
  FLAT_BEFORE_CLOSE_MINUTES: num(15).pipe(z.number().int().min(0)),
  MIN_RANGE_PCT: num(0.05).pipe(z.number().min(0)),
  MAX_RANGE_PCT: num(1.5).pipe(z.number().positive()),

  // --- Risiko ---
  RISK_PER_TRADE_PCT: num(0.5).pipe(z.number().positive().max(5)),
  DAILY_LOSS_LIMIT_PCT: num(2).pipe(z.number().positive().max(20)),
  MAX_TRADES_PER_DAY: num(3).pipe(z.number().int().positive()),

  // --- Diverse ---
  LOOP_SECONDS: num(20).pipe(z.number().min(5)),
  BACKTEST_DAYS: num(60).pipe(z.number().int().min(5).max(400)),
  LEARN_ENABLED: bool(true),
  LEARN_DAYS: num(90).pipe(z.number().int().min(45).max(400)),
  WEB_ENABLED: bool(true),
  WEB_PORT: num(3000).pipe(z.number().int().min(1).max(65535)),
});

export type Config = z.infer<typeof schema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Feil i .env:\n${issues}`);
  }
  const cfg = parsed.data;
  const missing = (["CAPITAL_API_KEY", "CAPITAL_IDENTIFIER", "CAPITAL_API_PASSWORD"] as const).filter((k) => !cfg[k].trim());
  if (missing.length) {
    throw new Error(
      `Mangler ${missing.join(", ")} i .env.\n` +
        "Lag en gratis demokonto på capital.com, slå på tofaktor-innlogging, og lag en API-nøkkel under Innstillinger -> API integrations.",
    );
  }
  if (cfg.ENTRY_CUTOFF_MINUTES <= cfg.ORB_MINUTES) throw new Error("ENTRY_CUTOFF_MINUTES må være større enn ORB_MINUTES");
  return cfg;
}

export const orbParams = (cfg: Config) => ({
  orbMinutes: cfg.ORB_MINUTES,
  entryCutoffMinutes: cfg.ENTRY_CUTOFF_MINUTES,
  rewardRisk: cfg.REWARD_RISK,
  flatBeforeCloseMinutes: cfg.FLAT_BEFORE_CLOSE_MINUTES,
  barMinutes: 5,
  minRangePct: cfg.MIN_RANGE_PCT,
  maxRangePct: cfg.MAX_RANGE_PCT,
});
