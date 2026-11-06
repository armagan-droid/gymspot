export interface Random {
  /** Uniform in [0, 1). */
  next(): number;
  /** Normal distribution with mean 0 and the given standard deviation. */
  gaussian(sigma: number): number;
}

/** Seeded PRNG (mulberry32) so synthetic fixtures are reproducible. */
export function createRandom(seed: number): Random {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    gaussian(sigma) {
      // Box–Muller; 1 - next() keeps the log argument in (0, 1].
      const u = 1 - next();
      const v = next();
      return sigma * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    },
  };
}
