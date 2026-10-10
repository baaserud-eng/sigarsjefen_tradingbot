import "dotenv/config";
import { z } from "zod";

const bool = z
  .string()
  .optional()
  .transform((v) => (v ?? "true").trim().toLowerCase() !== "false");

const num = (def: number) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v.trim() === "" ? def : Number(v)))
    .pipe(z.number().finite());

const schema = z.object({
  DRY_RUN: bool,
  SOLANA_RPC_URL: z.string().url().default("https://api.mainnet-beta.solana.com"),
  BOT_WALLET_PRIVATE_KEY: z.string().optional().default(""),

  MAX_SOL_PER_TRADE: num(0.1).pipe(z.number().positive()),
  DAILY_LOSS_LIMIT_PCT: num(5).pipe(z.number().positive().max(100)),
  MAX_OPEN_POSITIONS: num(3).pipe(z.number().int().positive()),
  STOP_LOSS_PCT: num(20).pipe(z.number().positive().max(100)),
  TAKE_PROFIT_PCT: num(50).pipe(z.number().positive()),
  PAPER_START_SOL: num(1).pipe(z.number().positive()),

  MAX_HOLD_MINUTES: num(60).pipe(z.number().positive()),
  MIN_SOL_RESERVE: num(0.02).pipe(z.number().min(0)),

  /** Gratis nøkkel fra portal.jup.ag. Uten nøkkel brukes lite-api, som Jupiter skal fase ut. */
  JUPITER_API_KEY: z.string().optional().default(""),
  JUPITER_API_URL: z.string().optional().default(""),
  SLIPPAGE_BPS: num(1000).pipe(z.number().int().min(1).max(5000)),
  PRIORITY_FEE_MAX_LAMPORTS: num(200000).pipe(z.number().int().min(0)),

  WEB_ENABLED: bool,
  WEB_PORT: num(3000).pipe(z.number().int().min(1).max(65535)),

  SCAN_INTERVAL_SEC: num(30).pipe(z.number().min(5)),
  CHECK_POSITIONS_SEC: num(10).pipe(z.number().min(3)),

  MIN_SAFETY_SCORE: num(70).pipe(z.number().min(0).max(100)),
  MIN_LIQUIDITY_USD: num(15000).pipe(z.number().min(0)),
  MAX_TOP10_HOLDER_PCT: num(30).pipe(z.number().min(0).max(100)),

  FOMO_API_KEY: z.string().optional().default(""),
  TELEGRAM_BOT_TOKEN: z.string().optional().default(""),
  TELEGRAM_CHAT_ID: z.string().optional().default(""),
});

export type Config = z.infer<typeof schema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Feil i .env:\n${issues}`);
  }
  const cfg = parsed.data;
  if (!cfg.DRY_RUN && !cfg.BOT_WALLET_PRIVATE_KEY) {
    throw new Error("DRY_RUN=false krever BOT_WALLET_PRIVATE_KEY i .env");
  }
  if (!cfg.JUPITER_API_URL) {
    cfg.JUPITER_API_URL = cfg.JUPITER_API_KEY ? "https://api.jup.ag/swap/v1" : "https://lite-api.jup.ag/swap/v1";
  }
  return cfg;
}
