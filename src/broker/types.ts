import type { Candle, Direction } from "../strategy/orb.js";

export interface MarketInfo {
  epic: string;
  name: string;
  currency: string;
  minSize: number;
  sizeStep: number;
  bid: number;
  offer: number;
  tradeable: boolean;
}

export interface AccountInfo {
  balance: number;
  available: number;
  profitLoss: number;
  currency: string;
}

export interface OpenPosition {
  dealId: string;
  epic: string;
  direction: Direction;
  size: number;
  level: number;
  stopLevel?: number;
  profitLevel?: number;
  upl: number;
  createdAt: string;
}

export interface OpenRequest {
  epic: string;
  direction: Direction;
  size: number;
  stopLevel: number;
  profitLevel: number;
}

/** Alt boten trenger fra megleren. Gjør det mulig å teste boten uten nett. */
export interface Broker {
  candles(epic: string, from: Date, to: Date, resolution?: string): Promise<Candle[]>;
  market(epic: string): Promise<MarketInfo>;
  account(): Promise<AccountInfo>;
  positions(): Promise<OpenPosition[]>;
  open(req: OpenRequest): Promise<{ dealId: string; level: number }>;
  close(dealId: string): Promise<{ level?: number }>;
  /** Hvor mye `to`-valuta 1 enhet `from`-valuta er verdt */
  fx(from: string, to: string): Promise<number>;
}
