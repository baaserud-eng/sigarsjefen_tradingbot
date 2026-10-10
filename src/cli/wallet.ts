/**
 * Lag en ny bot-wallet og lagre private key i .env:
 *   npm run wallet:new
 *
 * Vis adresse og saldo for walleten som allerede ligger i .env:
 *   npm run wallet
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { Connection, Keypair, LAMPORTS_PER_SOL } from "@solana/web3.js";
import bs58 from "bs58";
import "dotenv/config";

const ENV = ".env";
const mode = process.argv[2];

if (mode === "new") {
  if (!existsSync(ENV)) writeFileSync(ENV, readFileSync(".env.example", "utf8"));
  const env = readFileSync(ENV, "utf8");
  const existing = env.match(/^BOT_WALLET_PRIVATE_KEY=(.*)$/m)?.[1]?.trim();
  if (existing) {
    console.error("Det ligger allerede en wallet i .env. Jeg overskriver den ikke, så du ikke mister tilgang til pengene.");
    console.error("Vil du lage en ny, flytt først pengene ut og slett verdien til BOT_WALLET_PRIVATE_KEY i .env.");
    process.exit(1);
  }
  const kp = Keypair.generate();
  const secret = bs58.encode(kp.secretKey);
  const updated = /^BOT_WALLET_PRIVATE_KEY=.*$/m.test(env)
    ? env.replace(/^BOT_WALLET_PRIVATE_KEY=.*$/m, `BOT_WALLET_PRIVATE_KEY=${secret}`)
    : `${env.trimEnd()}\nBOT_WALLET_PRIVATE_KEY=${secret}\n`;
  writeFileSync(ENV, updated);
  console.log("\nNy bot-wallet laget og lagret i .env.\n");
  console.log(`  Adresse (send SOL hit):  ${kp.publicKey.toBase58()}\n`);
  console.log("Viktig:");
  console.log("  - Ta backup av .env et trygt sted. Mister du filen, mister du pengene i walleten.");
  console.log("  - Ikke del innholdet i .env med noen, og ikke push den til GitHub.\n");
  process.exit(0);
}

const key = process.env.BOT_WALLET_PRIVATE_KEY?.trim();
if (!key) {
  console.error("Ingen wallet i .env. Kjør: npm run wallet:new");
  process.exit(1);
}
const kp = Keypair.fromSecretKey(bs58.decode(key));
const conn = new Connection(process.env.SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com", "confirmed");
const bal = (await conn.getBalance(kp.publicKey)) / LAMPORTS_PER_SOL;
console.log(`\n  Adresse: ${kp.publicKey.toBase58()}\n  Saldo:   ${bal.toFixed(4)} SOL\n`);
