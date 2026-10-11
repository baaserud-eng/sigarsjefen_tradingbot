/**
 * Sjekk at innloggingen til Capital.com virker, og vis konto og markeder:
 *   npm run konto
 */
import { CapitalBroker } from "../broker/capital.js";
import { loadConfig } from "../config.js";

const cfg = loadConfig();
const broker = new CapitalBroker({ env: cfg.CAPITAL_ENV, apiKey: cfg.CAPITAL_API_KEY, identifier: cfg.CAPITAL_IDENTIFIER, password: cfg.CAPITAL_API_PASSWORD });

try {
  await broker.login();
  const acc = await broker.account();
  console.log(`\nInnlogget på Capital.com (${cfg.CAPITAL_ENV === "live" ? "LIVE, ekte penger" : "DEMO, lekepenger"})`);
  console.log(`  Saldo:       ${acc.balance.toFixed(2)} ${acc.currency}`);
  console.log(`  Tilgjengelig: ${acc.available.toFixed(2)} ${acc.currency}\n`);
  console.log("Markeder:");
  for (const epic of cfg.MARKETS) {
    try {
      const m = await broker.market(epic);
      console.log(`  ${epic.padEnd(10)} ${m.name.padEnd(22)} pris ${m.bid}  minste størrelse ${m.minSize}  ${m.tradeable ? "åpent" : "stengt nå"}`);
    } catch (e) {
      console.log(`  ${epic.padEnd(10)} FINNES IKKE: ${(e as Error).message.slice(0, 120)}`);
    }
  }
  console.log();
} catch (e) {
  console.error(`\n${(e as Error).message}\n`);
  process.exit(1);
}
