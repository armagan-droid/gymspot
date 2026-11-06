// One Euro filter (Casiez et al., 2012) applied to metric values (specs/04 "Yumuşatma").

export interface OneEuroParams {
  minCutoff: number;
  beta: number;
  /** Cutoff for the derivative filter, Hz. */
  dCutoff?: number;
}

const alpha = (cutoff: number, dt: number) => 1 / (1 + 1 / (2 * Math.PI * cutoff) / dt);

export class OneEuroFilter {
  private x: number | undefined;
  private dx = 0;
  private t = 0;

  constructor(private readonly p: OneEuroParams) {}

  /** @param tMs timestamp in milliseconds */
  filter(value: number, tMs: number): number {
    if (Number.isNaN(value)) return NaN;
    if (this.x === undefined) {
      this.x = value;
      this.t = tMs;
      return value;
    }
    const dt = (tMs - this.t) / 1000;
    if (dt <= 0) return this.x;
    const aD = alpha(this.p.dCutoff ?? 1, dt);
    this.dx = aD * ((value - this.x) / dt) + (1 - aD) * this.dx;
    const a = alpha(this.p.minCutoff + this.p.beta * Math.abs(this.dx), dt);
    this.x = a * value + (1 - a) * this.x;
    this.t = tMs;
    return this.x;
  }
}

/** One filter per metric; returns smoothed values for each frame. */
export function createMetricSmoother(names: readonly string[], p: OneEuroParams) {
  const filters = new Map(names.map((n) => [n, new OneEuroFilter(p)]));
  return (values: Readonly<Record<string, number>>, tMs: number): Record<string, number> => {
    const out: Record<string, number> = {};
    for (const [name, f] of filters) out[name] = f.filter(values[name] ?? NaN, tMs);
    return out;
  };
}
