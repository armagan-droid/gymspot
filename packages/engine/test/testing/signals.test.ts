import { describe, expect, test } from "vitest";
import { createRandom, repTimeline, scalarSignal } from "../../src/testing/index";

describe("createRandom", () => {
  test("is deterministic per seed", () => {
    const a = createRandom(42);
    const b = createRandom(42);
    const c = createRandom(43);
    const seqA = [a.next(), a.next(), a.next()];
    expect([b.next(), b.next(), b.next()]).toEqual(seqA);
    expect(c.next()).not.toBe(seqA[0]);
  });

  test("next() is in [0, 1) and gaussian() has roughly the requested spread", () => {
    const r = createRandom(1);
    const xs = Array.from({ length: 5000 }, () => r.gaussian(2));
    for (let i = 0; i < 100; i++) {
      const u = r.next();
      expect(u).toBeGreaterThanOrEqual(0);
      expect(u).toBeLessThan(1);
    }
    const mean = xs.reduce((s, x) => s + x, 0) / xs.length;
    const sd = Math.sqrt(xs.reduce((s, x) => s + (x - mean) ** 2, 0) / xs.length);
    expect(Math.abs(mean)).toBeLessThan(0.1);
    expect(sd).toBeGreaterThan(1.8);
    expect(sd).toBeLessThan(2.2);
  });
});

describe("repTimeline", () => {
  const tl = repTimeline({ fps: 30, leadInMs: 1000, restMs: 500, leadOutMs: 1000, reps: [{ durationMs: 2000 }, { durationMs: 1000 }] });

  test("timestamps follow fps and cover the whole timeline", () => {
    expect(tl[0]!.t).toBe(0);
    expect(tl[1]!.t).toBeCloseTo(1000 / 30);
    const total = 1000 + 2000 + 500 + 1000 + 1000;
    expect(tl.at(-1)!.t).toBeLessThanOrEqual(total);
    expect(tl.at(-1)!.t).toBeGreaterThan(total - 1000 / 30 - 1e-9);
  });

  test("progress is 0 at rest and reaches 1 mid-rep", () => {
    expect(tl.filter((p) => p.repIndex === null).every((p) => p.progress === 0)).toBe(true);
    for (const rep of [0, 1]) {
      const peak = Math.max(...tl.filter((p) => p.repIndex === rep).map((p) => p.progress));
      expect(peak).toBeGreaterThan(0.99);
    }
  });

  test("rep windows are in order with the requested durations", () => {
    const first = tl.filter((p) => p.repIndex === 0);
    const second = tl.filter((p) => p.repIndex === 1);
    expect(first[0]!.t).toBeGreaterThanOrEqual(1000);
    expect(first.at(-1)!.t).toBeLessThan(3000);
    expect(second[0]!.t).toBeGreaterThanOrEqual(3500);
    expect(second.at(-1)!.t).toBeLessThan(4500);
  });
});

describe("scalarSignal", () => {
  test("goes from start value to each rep's target and back", () => {
    const s = scalarSignal({ fps: 30, from: 170, reps: [{ to: 90 }, { to: 125 }], seed: 1 });
    const values = s.map((p) => p.value);
    expect(values[0]).toBeCloseTo(170);
    expect(values.at(-1)).toBeCloseTo(170);
    expect(Math.min(...values)).toBeCloseTo(90, 0);
    const secondRep = s.filter((p) => p.repIndex === 1).map((p) => p.value);
    expect(Math.min(...secondRep)).toBeCloseTo(125, 0);
  });

  test("noise is seeded and bounded by its sigma", () => {
    const opts = { fps: 30, from: 170, reps: [{ to: 90 }], noise: 2, seed: 7 };
    const a = scalarSignal(opts);
    const b = scalarSignal(opts);
    const clean = scalarSignal({ ...opts, noise: 0 });
    expect(a).toEqual(b);
    const diffs = a.map((p, i) => p.value - clean[i]!.value);
    expect(diffs.some((d) => d !== 0)).toBe(true);
    expect(Math.max(...diffs.map(Math.abs))).toBeLessThan(2 * 5);
  });
});
