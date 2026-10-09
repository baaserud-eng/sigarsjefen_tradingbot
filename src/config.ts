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
  return cfg;
}
