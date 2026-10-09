import { Connection, Keypair, PublicKey, VersionedTransaction } from "@solana/web3.js";
import type { Config } from "../config.js";
import { SOL_MINT, type Quote, type SwapResult, type Swapper } from "./types.js";

export { SOL_MINT } from "./types.js";
export type { Quote, SwapResult, Swapper } from "./types.js";

const TOKEN_PROGRAM = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const TOKEN_2022_PROGRAM = new PublicKey("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");

export class JupiterSwapper implements Swapper {
  constructor(
    private conn: Connection,
    private cfg: Config,
    private wallet: Keypair | null,
  ) {}

  async quote(inputMint: string, outputMint: string, amountRaw: bigint): Promise<Quote> {
    const url = new URL(`${this.cfg.JUPITER_API_URL}/quote`);
    url.searchParams.set("inputMint", inputMint);
    url.searchParams.set("outputMint", outputMint);
    url.searchParams.set("amount", amountRaw.toString());
    url.searchParams.set("slippageBps", String(this.cfg.SLIPPAGE_BPS));
    const res = await fetch(url, { headers: this.headers() });
    if (!res.ok) throw new Error(`Jupiter quote feilet (${res.status}): ${(await res.text()).slice(0, 200)}`);
    const q = (await res.json()) as Quote;
    if (!q.outAmount) throw new Error("Jupiter fant ingen rute for denne handelen");
    return q;
  }

  async swap(inputMint: string, outputMint: string, amountRaw: bigint): Promise<SwapResult> {
    const q = await this.quote(inputMint, outputMint, amountRaw);
    if (this.cfg.DRY_RUN || !this.wallet) {
      return { signature: null, inAmount: BigInt(q.inAmount), outAmount: BigInt(q.outAmount) };
    }

    const res = await fetch(`${this.cfg.JUPITER_API_URL}/swap`, {
      method: "POST",
      headers: { "content-type": "application/json", ...this.headers() },
      body: JSON.stringify({
        quoteResponse: q,
        userPublicKey: this.wallet.publicKey.toBase58(),
        wrapAndUnwrapSol: true,
        dynamicComputeUnitLimit: true,
        dynamicSlippage: true,
        prioritizationFeeLamports: {
          priorityLevelWithMaxLamports: {
            maxLamports: this.cfg.PRIORITY_FEE_MAX_LAMPORTS,
            priorityLevel: "veryHigh",
          },
        },
      }),
    });
    if (!res.ok) throw new Error(`Jupiter swap feilet (${res.status}): ${(await res.text()).slice(0, 200)}`);
    const body = (await res.json()) as { swapTransaction: string; lastValidBlockHeight: number };

    const tx = VersionedTransaction.deserialize(Buffer.from(body.swapTransaction, "base64"));
    tx.sign([this.wallet]);
    const { blockhash } = await this.conn.getLatestBlockhash("confirmed");
    const signature = await this.conn.sendRawTransaction(tx.serialize(), { maxRetries: 3, skipPreflight: false });
    const conf = await this.conn.confirmTransaction(
      { signature, blockhash: tx.message.recentBlockhash ?? blockhash, lastValidBlockHeight: body.lastValidBlockHeight },
      "confirmed",
    );
    if (conf.value.err) throw new Error(`Transaksjonen feilet på kjeden: ${JSON.stringify(conf.value.err)} (${signature})`);

    // Faktisk mottatt mengde kan avvike fra quote pga. slippage. Les den fra kjeden.
    let outAmount = BigInt(q.outAmount);
    if (outputMint !== SOL_MINT) {
      const held = await this.tokenBalanceRaw(outputMint).catch(() => 0n);
      if (held > 0n) outAmount = held;
    }
    return { signature, inAmount: BigInt(q.inAmount), outAmount };
  }

  private headers(): Record<string, string> {
    return this.cfg.JUPITER_API_KEY ? { "x-api-key": this.cfg.JUPITER_API_KEY } : {};
  }

  async tokenBalanceRaw(mint: string): Promise<bigint> {
    if (!this.wallet) return 0n;
    let total = 0n;
    for (const programId of [TOKEN_PROGRAM, TOKEN_2022_PROGRAM]) {
      const accs = await this.conn.getParsedTokenAccountsByOwner(this.wallet.publicKey, { programId });
      for (const a of accs.value) {
        const info = (a.account.data as { parsed?: { info?: { mint?: string; tokenAmount?: { amount?: string } } } }).parsed?.info;
        if (info?.mint === mint) total += BigInt(info.tokenAmount?.amount ?? "0");
      }
    }
    return total;
  }
}
