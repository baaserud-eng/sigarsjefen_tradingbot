/**
 * Ren poengberegning for sikkerhetssjekk. Ingen nettverkskall her,
 * slik at reglene er enkle å teste og justere.
 */

export interface TokenFacts {
  mint: string;
  symbol?: string;
  /** Kan noen fortsatt lage flere tokens? */
  mintAuthority: string | null;
  /** Kan noen fryse lommebøkene dine slik at du ikke får solgt? */
  freezeAuthority: string | null;
  /** Token-2022-utvidelser som kan brukes til å stjele eller låse tokens */
  riskyExtensions: string[];
  /** Andel (0-100) av supply eid av de 10 største vanlige lommebøkene (pooler og program-kontoer er trukket fra) */
  top10HolderPct: number | null;
  /** Største pool-likviditet i USD, null hvis ingen pool ble funnet */
  liquidityUsd: number | null;
  /** Alder på eldste pool i minutter */
  poolAgeMinutes: number | null;
}

export interface SafetyRules {
  minScore: number;
  minLiquidityUsd: number;
  maxTop10HolderPct: number;
}

export interface SafetyFinding {
  severity: "critical" | "warn" | "info";
  points: number;
  reason: string;
  /** Tegn på at tokenen er laget for å svindle (rug pull), ikke bare risikabel */
  rug?: boolean;
}

export interface SafetyResult {
  mint: string;
  symbol?: string;
  score: number;
  passed: boolean;
  findings: SafetyFinding[];
}

export function scoreToken(f: TokenFacts, rules: SafetyRules): SafetyResult {
  const findings: SafetyFinding[] = [];
  const add = (severity: SafetyFinding["severity"], points: number, reason: string, rug = false) =>
    findings.push({ severity, points, reason, ...(rug ? { rug } : {}) });

  if (f.mintAuthority) add("critical", 40, "Mint authority er på: utvikleren kan lage nye tokens og dumpe prisen", true);
  if (f.freezeAuthority) add("critical", 40, "Freeze authority er på: utvikleren kan fryse tokens slik at du ikke får solgt", true);
  for (const ext of f.riskyExtensions) add("critical", 40, `Farlig Token-2022-utvidelse: ${ext}`, true);

  // Grensene fra .env er absolutte: brytes en av dem, kjøpes ikke tokenen.
  if (f.liquidityUsd === null) {
    add("critical", 40, "Fant ingen pool med likviditet");
  } else if (f.liquidityUsd < rules.minLiquidityUsd) {
    add("critical", 40, `For lav likviditet: $${Math.round(f.liquidityUsd).toLocaleString("nb-NO")} (minimum $${rules.minLiquidityUsd.toLocaleString("nb-NO")})`);
  } else if (f.liquidityUsd < rules.minLiquidityUsd * 2) {
    add("warn", 10, `Likviditeten er lav: $${Math.round(f.liquidityUsd).toLocaleString("nb-NO")}`);
  }

  // Holdere sjekkes bare når likviditeten er god nok (ellers er tokenen avvist uansett).
  const liquidityOk = f.liquidityUsd !== null && f.liquidityUsd >= rules.minLiquidityUsd;
  if (liquidityOk) {
    if (f.top10HolderPct === null) {
      add("critical", 40, "Klarte ikke å sjekke topp-holdere, så tokenen kan ikke verifiseres");
    } else if (f.top10HolderPct > rules.maxTop10HolderPct) {
      add("critical", 40, `Topp-10 holdere eier ${f.top10HolderPct.toFixed(1)}% (grense ${rules.maxTop10HolderPct}%)`);
    } else if (f.top10HolderPct > rules.maxTop10HolderPct * 0.75) {
      add("warn", 10, `Topp-10 holdere eier ${f.top10HolderPct.toFixed(1)}%, nær grensen på ${rules.maxTop10HolderPct}%`);
    }
  }

  if (f.poolAgeMinutes !== null && f.poolAgeMinutes < 10) {
    add("info", 5, `Poolen er bare ${Math.round(f.poolAgeMinutes)} minutter gammel`);
  }

  const score = Math.max(0, 100 - findings.reduce((s, x) => s + x.points, 0));
  const hasCritical = findings.some((x) => x.severity === "critical");

  return {
    mint: f.mint,
    ...(f.symbol ? { symbol: f.symbol } : {}),
    score,
    passed: !hasCritical && score >= rules.minScore,
    findings,
  };
}
