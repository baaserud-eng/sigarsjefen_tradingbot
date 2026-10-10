import { Connection, PublicKey, type ParsedAccountData } from "@solana/web3.js";
import type { TokenFacts } from "./score.js";

const TOKEN_2022 = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";

/** Token-2022-utvidelser som gir utvikleren makt over dine tokens */
const RISKY_EXTENSIONS: Record<string, string> = {
  permanentDelegate: "permanent delegate (kan flytte tokens ut av din wallet)",
  transferHook: "transfer hook (egen kode kjører ved hver overføring, kan blokkere salg)",
  nonTransferable: "non-transferable (kan ikke selges)",
  defaultAccountState: "default account state (nye kontoer kan starte frosset)",
};

interface DexPair {
  chainId: string;
  baseToken?: { address: string; symbol?: string };
  liquidity?: { usd?: number };
  pairCreatedAt?: number;
}

/** Henter fakta om en token fra Solana RPC og DexScreener. */
export async function fetchTokenFacts(conn: Connection, mintStr: string): Promise<TokenFacts> {
  const mint = new PublicKey(mintStr);

  // 1) Mint-kontoen: authorities, supply og Token-2022-utvidelser
  const info = await conn.getParsedAccountInfo(mint);
  const acc = info.value;
  if (!acc || !("parsed" in (acc.data as object))) {
    throw new Error(`Fant ingen token-mint på adressen ${mintStr}`);
  }
  const parsed = (acc.data as ParsedAccountData).parsed?.info ?? {};
  const mintAuthority: string | null = parsed.mintAuthority ?? null;
  const freezeAuthority: string | null = parsed.freezeAuthority ?? null;
  const supply = Number(parsed.supply ?? 0);

  const riskyExtensions: string[] = [];
  if (acc.owner.toBase58() === TOKEN_2022 && Array.isArray(parsed.extensions)) {
    for (const ext of parsed.extensions as { extension: string; state?: Record<string, unknown> }[]) {
      const label = RISKY_EXTENSIONS[ext.extension];
      if (!label) continue;
      if (ext.extension === "defaultAccountState" && ext.state?.accountState !== "frozen") continue;
      if (ext.extension === "transferHook" && !ext.state?.programId) continue;
      riskyExtensions.push(label);
    }
  }

  // 2) Topp-holdere. Kontoer eid av program (pooler, bonding curves, låser) har eier
  //    utenfor ed25519-kurven, så de trekkes fra for å finne vanlige lommebøker.
  let top10HolderPct: number | null = null;
  try {
    const largest = await conn.getTokenLargestAccounts(mint);
    const accounts = largest.value.slice(0, 20);
    const infos = await conn.getMultipleParsedAccounts(accounts.map((a) => a.address));
    const walletAmounts: number[] = [];
    infos.value.forEach((ai, i) => {
      const owner: string | undefined = (ai?.data as ParsedAccountData | undefined)?.parsed?.info?.owner;
      if (!owner) return;
      if (!PublicKey.isOnCurve(new PublicKey(owner).toBytes())) return; // program-eid: hopp over
      walletAmounts.push(Number(accounts[i]!.amount));
    });
    const top10 = walletAmounts.sort((a, b) => b - a).slice(0, 10).reduce((s, x) => s + x, 0);
    top10HolderPct = supply > 0 ? (top10 / supply) * 100 : null;
  } catch {
    top10HolderPct = null;
  }

  // 3) Likviditet og alder fra DexScreener (gratis, ingen nøkkel)
  let liquidityUsd: number | null = null;
  let poolAgeMinutes: number | null = null;
  let symbol: string | undefined;
  try {
    const res = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${mintStr}`);
    if (res.ok) {
      const body = (await res.json()) as { pairs?: DexPair[] | null };
      const pairs = (body.pairs ?? []).filter((p) => p.chainId === "solana");
      if (pairs.length) {
        liquidityUsd = Math.max(...pairs.map((p) => p.liquidity?.usd ?? 0));
        const created = pairs.map((p) => p.pairCreatedAt).filter((x): x is number => typeof x === "number");
        if (created.length) poolAgeMinutes = (Date.now() - Math.min(...created)) / 60000;
        symbol = pairs.find((p) => p.baseToken?.address === mintStr)?.baseToken?.symbol;
      }
    }
  } catch {
    liquidityUsd = null;
  }

  return {
    mint: mintStr,
    ...(symbol ? { symbol } : {}),
    mintAuthority,
    freezeAuthority,
    riskyExtensions,
    top10HolderPct,
    liquidityUsd,
    poolAgeMinutes,
  };
}
