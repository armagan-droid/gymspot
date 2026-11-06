import { describe, expect, test } from "vitest";
import { OneEuroFilter, createMetricSmoother } from "../src/index";
import { createRandom } from "../src/testing/index";

const params = { minCutoff: 1.0, beta: 0.05 };
const step = 1000 / 30;

describe("OneEuroFilter", () => {
  test("first sample passes through unchanged", () => {
    expect(new OneEuroFilter(params).filter(42, 0)).toBe(42);
  });

  test("a constant signal stays constant", () => {
    const f = new OneEuroFilter(params);
    for (let i = 0; i < 30; i++) expect(f.filter(10, i * step)).toBeCloseTo(10);
  });

  test("reduces jitter on a noisy constant signal", () => {
    const f = new OneEuroFilter(params);
    const rng = createRandom(5);
    const raw: number[] = [];
    const out: number[] = [];
    for (let i = 0; i < 300; i++) {
      const x = 120 + rng.gaussian(2);
      raw.push(x);
      out.push(f.filter(x, i * step));
    }
    const sd = (xs: number[]) => {
      const m = xs.reduce((s, x) => s + x, 0) / xs.length;
      return Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / xs.length);
    };
    expect(sd(out.slice(30))).toBeLessThan(sd(raw.slice(30)) * 0.6);
  });

  test("converges after a step", () => {
    const f = new OneEuroFilter(params);
    f.filter(0, 0);
    let y = 0;
    for (let i = 1; i <= 60; i++) y = f.filter(100, i * step);
    expect(y).toBeGreaterThan(99);
  });

  test("higher beta lags less on a fast ramp", () => {
    const slow = new OneEuroFilter({ minCutoff: 1, beta: 0 });
    const fast = new OneEuroFilter({ minCutoff: 1, beta: 0.5 });
    let ys = 0;
    let yf = 0;
    for (let i = 0; i < 15; i++) {
      const x = i * 5; // 150°/s
      ys = slow.filter(x, i * step);
      yf = fast.filter(x, i * step);
    }
    expect(70 - yf).toBeLessThan(70 - ys);
  });

  test("NaN passes through as NaN without resetting the state", () => {
    const f = new OneEuroFilter(params);
    for (let i = 0; i < 10; i++) f.filter(50, i * step);
    expect(f.filter(NaN, 10 * step)).toBeNaN();
    expect(f.filter(50, 11 * step)).toBeCloseTo(50);
  });

  test("non-increasing timestamps do not produce NaN or Infinity", () => {
    const f = new OneEuroFilter(params);
    f.filter(1, 100);
    expect(Number.isFinite(f.filter(2, 100))).toBe(true);
    expect(Number.isFinite(f.filter(3, 50))).toBe(true);
  });
});

describe("createMetricSmoother", () => {
  test("smooths each metric independently", () => {
    const smooth = createMetricSmoother(["a", "b"], params);
    smooth({ a: 0, b: 100 }, 0);
    const out = smooth({ a: 10, b: 100 }, step);
    expect(out.b).toBeCloseTo(100);
    expect(out.a).toBeGreaterThan(0);
    expect(out.a).toBeLessThan(10);
  });
});
