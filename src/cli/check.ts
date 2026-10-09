/**
 * Sjekk en enkelt token manuelt:
 *   npm run check <mint-adresse>
 */
import { Connection } from "@solana/web3.js";
import { loadConfig } from "../config.js";
import { checkToken } from "../safety/index.js";

const mint = process.argv[2];
if (!mint) {
  console.error("Bruk: npm run check <mint-adresse>");
  process.exit(1);
}

const cfg = loadConfig();
const conn = new Connection(cfg.SOLANA_RPC_URL, "confirmed");

try {
  const r = await checkToken(conn, cfg, mint);
  const name = r.symbol ? `$${r.symbol}` : mint;
  const verdict = r.passed ? "\x1b[32mGODKJENT\x1b[0m" : "\x1b[31mAVVIST\x1b[0m";
  console.log(`\n${name}  score ${r.score}/100  ${verdict}  (grense ${cfg.MIN_SAFETY_SCORE})\n`);
  if (!r.findings.length) console.log("  Ingen funn.");
  for (const f of r.findings) {
    const tag = f.severity === "critical" ? "\x1b[31mKRITISK\x1b[0m" : f.severity === "warn" ? "\x1b[33mADVARSEL\x1b[0m" : "\x1b[90mINFO\x1b[0m";
    console.log(`  ${tag.padEnd(18)} -${String(f.points).padStart(2)}  ${f.reason}`);
  }
  console.log();
} catch (e) {
  console.error((e as Error).message);
  process.exit(1);
}
