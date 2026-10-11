/**
 * Tidshjelpere. Markedene åpner etter New York-tid, så all strategi regnes i
 * America/New_York. Det tar automatisk hensyn til sommertid i både USA og Norge.
 */

const nyFmt = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  hourCycle: "h23",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  weekday: "short",
});

const WEEKDAYS: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

export interface NyParts {
  /** YYYY-MM-DD i New York */
  date: string;
  /** Minutter siden midnatt i New York */
  minutes: number;
  /** 0 = søndag … 6 = lørdag */
  weekday: number;
}

const cache = new Map<number, NyParts>();

export function nyParts(d: Date | number): NyParts {
  // Samme minutt gir samme svar. Mellomlagring gjør backtest og læring mange ganger raskere.
  const key = Math.floor(new Date(d).getTime() / 60_000);
  const hit = cache.get(key);
  if (hit) return hit;
  const res = computeNyParts(key * 60_000);
  if (cache.size > 300_000) cache.clear();
  cache.set(key, res);
  return res;
}

function computeNyParts(d: number): NyParts {
  const parts = Object.fromEntries(nyFmt.formatToParts(new Date(d)).map((p) => [p.type, p.value]));
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    minutes: Number(parts.hour) * 60 + Number(parts.minute),
    weekday: WEEKDAYS[parts.weekday as string] ?? 0,
  };
}

/** "09:30" -> 570 */
export function hhmm(s: string): number {
  const [h, m] = s.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

/** Finn tidspunktet (UTC) for et klokkeslett i New York på en gitt New York-dato. */
export function nyToDate(date: string, minutes: number): Date {
  const [y, mo, d] = date.split("-").map(Number);
  // Start med en gjetning (New York er 4-5 timer bak UTC) og juster.
  let t = Date.UTC(y!, mo! - 1, d!, 0, minutes) + 5 * 3600_000;
  for (let i = 0; i < 3; i++) {
    const p = nyParts(t);
    const dayDiff = p.date === date ? 0 : p.date < date ? 1 : -1;
    const diff = minutes - p.minutes + dayDiff * 1440;
    if (diff === 0) break;
    t += diff * 60_000;
  }
  return new Date(t);
}

/** Klokkeslett i norsk tid, f.eks. "15:30". */
export function osloClock(d: Date): string {
  return d.toLocaleTimeString("nb-NO", { timeZone: "Europe/Oslo", hour: "2-digit", minute: "2-digit", hour12: false });
}

/** Format Capital.com bruker i spørringer: YYYY-MM-DDTHH:MM:SS (UTC, uten Z) */
export function capitalTime(d: Date): string {
  return d.toISOString().slice(0, 19);
}
