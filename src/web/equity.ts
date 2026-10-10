import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

/** Saldo over tid for grafen på dashboardet. Lagres så grafen overlever en omstart. */
export class EquityHistory {
  points: [string, number][] = [];

  constructor(
    private file: string | null,
    private max = 2000,
  ) {
    if (!file) return;
    try {
      const loaded = JSON.parse(readFileSync(file, "utf8"));
      if (Array.isArray(loaded)) this.points = loaded.slice(-max);
    } catch {
      // ingen historikk ennå
    }
  }

  add(valueSol: number, at = new Date()) {
    if (!Number.isFinite(valueSol)) return;
    this.points.push([at.toISOString(), Number(valueSol.toFixed(6))]);
    if (this.points.length > this.max) this.points.splice(0, this.points.length - this.max);
    if (!this.file) return;
    try {
      mkdirSync(dirname(this.file), { recursive: true });
      writeFileSync(this.file, JSON.stringify(this.points));
    } catch {
      // grafen er ikke viktig nok til å stoppe boten
    }
  }
}
