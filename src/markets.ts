/**
 * Markedene boten kan handle, med åpningstidene opening range-strategien bruker
 * (New York-tid). CFD-ene handles nesten døgnet rundt, men strategien handler bare
 * rundt den "ekte" åpningen, når volumet og bevegelsene er størst.
 */

export interface MarketDef {
  epic: string;
  name: string;
  /** Tilsvarende futures-kontrakt */
  futures: string;
  /** Sesjonsstart i New York-tid, HH:MM */
  open: string;
  /** Sesjonsslutt i New York-tid, HH:MM. Boten er flat før dette. */
  close: string;
}

export const KNOWN_MARKETS: Record<string, MarketDef> = {
  US100: { epic: "US100", name: "US Tech 100", futures: "NQ", open: "09:30", close: "16:00" },
  US500: { epic: "US500", name: "US 500", futures: "ES", open: "09:30", close: "16:00" },
  GOLD: { epic: "GOLD", name: "Gull", futures: "GC", open: "08:20", close: "13:30" },
  OIL_CRUDE: { epic: "OIL_CRUDE", name: "Olje (WTI)", futures: "CL", open: "09:00", close: "14:30" },
};

export function marketDef(epic: string): MarketDef {
  return KNOWN_MARKETS[epic] ?? { epic, name: epic, futures: "–", open: "09:30", close: "16:00" };
}
