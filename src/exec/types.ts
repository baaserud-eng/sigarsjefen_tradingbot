export const SOL_MINT = "So11111111111111111111111111111111111111112";

export interface Quote {
  inputMint: string;
  outputMint: string;
  inAmount: string;
  outAmount: string;
  priceImpactPct: string;
  [k: string]: unknown;
}

export interface SwapResult {
  /** Transaksjons-ID, eller null når handelen bare er simulert (DRY_RUN) */
  signature: string | null;
  inAmount: bigint;
  outAmount: bigint;
}

/**
 * Alt som har med kjøp og salg å gjøre. Trader-logikken snakker bare med dette
 * grensesnittet, så den kan testes uten nett og uten ekte penger.
 */
export interface Swapper {
  quote(inputMint: string, outputMint: string, amountRaw: bigint): Promise<Quote>;
  swap(inputMint: string, outputMint: string, amountRaw: bigint): Promise<SwapResult>;
  tokenBalanceRaw(mint: string): Promise<bigint>;
}
