import type { Broker } from "../broker/types.js";
import type { Candle } from "../strategy/orb.js";

/** Hent historiske 5-minutters lys for de siste `days` dagene, i biter Capital.com godtar. */
export async function fetchHistory(broker: Broker, epic: string, days: number, onChunk?: () => void): Promise<Candle[]> {
  const out = new Map<number, Candle>();
  const end = Date.now();
  const start = end - days * 86_400_000;
  const chunk = 3 * 86_400_000; // 1000 lys à 5 min er ca. 3,4 døgn
  for (let from = start; from < end; from += chunk) {
    const to = Math.min(end, from + chunk);
    try {
      for (const c of await broker.candles(epic, new Date(from), new Date(to))) out.set(c.t, c);
    } catch (e) {
      const msg = (e as Error).message;
      // Helger og helligdager gir ofte "ingen data"-feil. Det er greit.
      if (!msg.includes("(404)") && !msg.includes("(400)")) throw e;
    }
    onChunk?.();
  }
  return [...out.values()].sort((a, b) => a.t - b.t);
}
