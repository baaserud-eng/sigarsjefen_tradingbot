/**
 * Skanner: henter nylig oppførte og boostede Solana-tokens fra DexScreener
 * (gratis API, ingen nøkkel). Returnerer bare tokens den ikke har sett før.
 *
 * Reddit, X, pump.fun og FOMO-copytrade kan legges til som flere kilder
 * som returnerer samme format.
 */

export interface Candidate {
  mint: string;
  source: string;
}

interface DexListing {
  chainId?: string;
  tokenAddress?: string;
}

const FEEDS: { url: string; source: string }[] = [
  { url: "https://api.dexscreener.com/token-profiles/latest/v1", source: "dexscreener-nye" },
  { url: "https://api.dexscreener.com/token-boosts/latest/v1", source: "dexscreener-boost" },
];

export class DexScreenerScanner {
  private seen = new Set<string>();

  constructor(private fetchFn: typeof fetch = fetch) {}

  async scan(): Promise<Candidate[]> {
    const out: Candidate[] = [];
    for (const feed of FEEDS) {
      try {
        const res = await this.fetchFn(feed.url);
        if (!res.ok) continue;
        const list = (await res.json()) as DexListing[];
        for (const item of Array.isArray(list) ? list : []) {
          if (item.chainId !== "solana" || !item.tokenAddress) continue;
          if (this.seen.has(item.tokenAddress)) continue;
          this.seen.add(item.tokenAddress);
          out.push({ mint: item.tokenAddress, source: feed.source });
        }
      } catch {
        // én kilde som feiler skal ikke stoppe skanningen
      }
    }
    if (this.seen.size > 5000) this.seen = new Set([...this.seen].slice(-2500));
    return out;
  }
}
