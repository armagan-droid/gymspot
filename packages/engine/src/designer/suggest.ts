import type { Frame, MetricDefinition, RulePack } from "@gymspot/shared";
import { type Side, createMetricComputer } from "../metrics/compute";
import { createMetricSmoother } from "../metrics/smoothing";

// Suggestions from demonstrations (specs/11 "Öneri algoritması"). Pure: the
// caller records frames in memory, these functions only measure them.

export type View = "front" | "side";

/** Ready-made candidate measures per camera view, besides the pack's own (specs/11). */
export const CANDIDATE_METRICS: Record<View, Record<string, MetricDefinition>> = {
  side: {
    knee_angle: { angle: ["near_hip", "near_knee", "near_ankle"] },
    hip_angle: { angle: ["near_shoulder", "near_hip", "near_knee"] },
    elbow_angle: { angle: ["near_shoulder", "near_elbow", "near_wrist"] },
    shoulder_angle: { angle: ["near_elbow", "near_shoulder", "near_hip"] },
    torso_tilt: { angleFromVertical: ["near_hip", "near_shoulder"] },
    shin_tilt: { angleFromVertical: ["near_ankle", "near_knee"] },
    wrist_height: { diffY: ["near_wrist", "near_shoulder"] },
  },
  front: {
    knee_angle_l: { angle: ["left_hip", "left_knee", "left_ankle"] },
    knee_angle_r: { angle: ["right_hip", "right_knee", "right_ankle"] },
    elbow_angle_l: { angle: ["left_shoulder", "left_elbow", "left_wrist"] },
    elbow_angle_r: { angle: ["right_shoulder", "right_elbow", "right_wrist"] },
    shoulder_angle_l: { angle: ["left_elbow", "left_shoulder", "left_hip"] },
    shoulder_angle_r: { angle: ["right_elbow", "right_shoulder", "right_hip"] },
    head_lean_left: { lateralLean: ["nose", "left_hip"] },
    head_lean_right: { lateralLean: ["right_hip", "nose"] },
    head_height: { chainHeight: ["nose", "left_shoulder", "left_hip", "left_knee", "left_ankle"] },
    wrist_height_l: { diffY: ["left_wrist", "left_shoulder"] },
    wrist_height_r: { diffY: ["right_wrist", "right_shoulder"] },
  },
};

/** Smallest swing that can be a movement: degrees for angles, a ratio otherwise. */
function minSwing(name: string, metrics: Record<string, MetricDefinition>): number {
  const def = metrics[name];
  if (!def) return 0.05;
  if ("angle" in def || "angleFromVertical" in def) return 15;
  if ("avg" in def) return minSwing(def.avg[0], metrics);
  if ("max" in def) return minSwing(def.max[0], metrics);
  if ("absDiff" in def) return minSwing(def.absDiff[0], metrics);
  return 0.05;
}

/** Front-plane functions mean nothing in a side view. */
function frontOnly(name: string, metrics: Record<string, MetricDefinition>): boolean {
  const def = metrics[name];
  if (!def) return false;
  if ("kneeInwardRatio" in def || "lateralLean" in def) return true;
  const deps = "avg" in def ? def.avg : "max" in def ? def.max : "absDiff" in def ? def.absDiff : [];
  return deps.some((d) => frontOnly(d, metrics));
}

export interface MetricSeries {
  view: View;
  t: number[];
  values: Record<string, number[]>;
  /** Definitions of every measured series (pack measures and candidates). */
  metrics: Record<string, MetricDefinition>;
}

/**
 * Pack measures plus the view's candidates (a candidate equal to a pack
 * measure is dropped), computed and smoothed like the engine does.
 */
export function measureDemonstration(frames: readonly Frame[], pack: Pick<RulePack, "metrics" | "smoothing">, view: View, nearSide: Side): MetricSeries {
  const metrics: Record<string, MetricDefinition> = {};
  for (const [n, d] of Object.entries(pack.metrics)) if (view === "front" || !frontOnly(n, pack.metrics)) metrics[n] = d;  // (a measure built on a front-only one is front-only too, so nothing it needs is dropped)
  const known = new Set(Object.values(pack.metrics).map((d) => JSON.stringify(d)));
  for (const [name, def] of Object.entries(CANDIDATE_METRICS[view])) {
    if (known.has(JSON.stringify(def))) continue;
    let n = name;
    while (n in metrics) n = `${n}_c`;
    metrics[n] = def;
  }
  const computer = createMetricComputer(metrics);
  const smooth = createMetricSmoother(Object.keys(metrics), pack.smoothing);
  const values: Record<string, number[]> = Object.fromEntries(Object.keys(metrics).map((n) => [n, []]));
  const t: number[] = [];
  for (const f of frames) {
    const v = smooth(computer.compute(f, nearSide), f.t);
    t.push(f.t);
    for (const n of Object.keys(metrics)) values[n]!.push(v[n] ?? NaN);
  }
  return { view, t, values, metrics };
}

// ------------------------------------------------------------------ cycles

const median = (xs: readonly number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};
const mean = (xs: readonly number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const std = (xs: readonly number[]) => {
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / xs.length);
};
const quantile = (sorted: readonly number[], q: number) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.round(q * (sorted.length - 1))))]!;

export interface Cycle {
  startT: number;
  endT: number;
  /** Index of the turning point (furthest from rest). */
  turn: number;
  /** Value at the turning point. */
  peak: number;
}

/**
 * Splits a series into movements away from `rest` toward `far` and back:
 * a cycle starts when the normalized value leaves `low`, counts once it
 * passes `high`, ends when it is back below `low`.
 */
export function findCycles(t: readonly number[], v: readonly number[], rest: number, far: number, high = 0.6, low = 0.25): Cycle[] {
  const span = far - rest;
  const cycles: Cycle[] = [];
  let start = -1;
  let turn = -1;
  let passed = false;
  for (let i = 0; i < v.length; i++) {
    const x = v[i]!;
    if (!Number.isFinite(x)) continue;
    const s = (x - rest) / span;
    if (start < 0) {
      if (s > low) {
        start = i;
        turn = i;
        passed = s >= high;
      }
      continue;
    }
    if ((x - rest) / span > (v[turn]! - rest) / span) turn = i;
    if (s >= high) passed = true;
    if (s < low) {
      if (passed) cycles.push({ startT: t[start]!, endT: t[i]!, turn, peak: v[turn]! });
      start = -1;
      passed = false;
    }
  }
  return cycles;
}

export interface RepSuggestion {
  metric: string;
  /** The measure's definition (add it to the pack when it is a candidate). */
  definition: MetricDefinition;
  direction: "down" | "up";
  cycles: number;
  rest: number;
  peak: number;
  score: number;
  rep: RulePack["rep"];
}

/** Rounding step a twentieth of the swing wide, so the zones stay apart. */
function rounder(amplitude: number) {
  const step = 10 ** Math.floor(Math.log10(amplitude / 20));
  const digits = Math.max(0, -Math.floor(Math.log10(step)));
  return (x: number) => Number((Math.round(x / step) * step).toFixed(digits));
}

/** Rest and far end of a series: where it spends most time, and the other extreme. */
function restAndFar(v: readonly number[]): { rest: number; far: number } | null {
  const finite = v.filter(Number.isFinite).sort((a, b) => a - b);
  if (finite.length < 10) return null;
  const lo = quantile(finite, 0.05);
  const hi = quantile(finite, 0.95);
  const m = median(finite);
  return m - lo > hi - m ? { rest: hi, far: lo } : { rest: lo, far: hi };
}

/** Scores every measure as the repetition measure and suggests zones for the best (specs/11). */
export function rankRepMetrics(series: MetricSeries): RepSuggestion[] {
  const out: RepSuggestion[] = [];
  for (const [name, v] of Object.entries(series.values)) {
    const ends = restAndFar(v);
    if (!ends || Math.abs(ends.far - ends.rest) < minSwing(name, series.metrics)) continue;
    const cycles = findCycles(series.t, v, ends.rest, ends.far);
    if (cycles.length < 2) continue;
    // rest: the median outside the cycles; far end: the median turning point
    const inside = new Set<number>();
    for (const c of cycles) series.t.forEach((t, i) => t >= c.startT && t <= c.endT && inside.add(i));
    const outside = v.filter((x, i) => !inside.has(i) && Number.isFinite(x));
    const r = outside.length ? median(outside) : ends.rest;
    const p = median(cycles.map((c) => c.peak));
    const amplitude = Math.abs(p - r);
    if (amplitude < minSwing(name, series.metrics)) continue;
    const amps = cycles.map((c) => Math.abs(c.peak - r));
    const coverage = v.filter(Number.isFinite).length / v.length;
    // regular, large (for its kind) and seen all along
    const score = (median(amps) / (std(amps) + 0.05 * median(amps))) * (amplitude / minSwing(name, series.metrics)) * coverage;
    const dir = Math.sign(p - r);
    const round = rounder(amplitude);
    const at = (k: number) => round(r + dir * k * amplitude);
    const durations = cycles.map((c) => c.endT - c.startT);
    const minDurationMs = Math.max(200, Math.round(Math.min(...durations) / 2 / 50) * 50);
    const maxDurationMs = Math.min(10000, Math.max(minDurationMs + 100, Math.round((Math.max(...durations) * 2) / 50) * 50));
    out.push({
      metric: name,
      definition: series.metrics[name]!,
      direction: dir < 0 ? "down" : "up",
      cycles: cycles.length,
      rest: r,
      peak: p,
      score,
      rep: {
        metric: name,
        start: { enter: at(0.25), exit: at(0.35) },
        target: { enter: at(0.75), exit: at(0.65) },
        attemptMinExcursion: Math.max(round(0.2 * amplitude), 10 ** Math.floor(Math.log10(amplitude / 20))),
        minDurationMs,
        maxDurationMs,
      },
    });
  }
  return out.sort((a, b) => b.score - a.score);
}

export const suggestRep = (series: MetricSeries): RepSuggestion | null => rankRepMetrics(series)[0] ?? null;

// ------------------------------------------------------------------ faults

export interface FaultSuggestion {
  metric: string;
  definition: MetricDefinition;
  op: ">" | "<";
  threshold: number;
  /** Gap between the two groups over their spread; > 0 means they do not overlap. */
  separation: number;
  good: number[];
  bad: number[];
  /** `at_turn: <metric> <op> <threshold>` */
  check: string;
}

/** Values of every measure at each turning point of the rep measure. */
function atTurns(series: MetricSeries, rep: RepSuggestion): Record<string, number[]> | null {
  const v = series.values[rep.metric];
  if (!v) return null;
  // attempts: anything that leaves rest by a quarter of the swing (a shallow rep too)
  const cycles = findCycles(series.t, v, rep.rest, rep.peak, 0.3, 0.15);
  if (cycles.length < 2) return null;
  return Object.fromEntries(Object.entries(series.values).map(([n, xs]) => [n, cycles.map((c) => xs[c.turn]!).filter(Number.isFinite)]));
}

/**
 * The measure that best tells the faulty demonstration from the correct one
 * at the turning point; null when every measure overlaps (specs/11).
 */
export function suggestFault(good: MetricSeries, bad: MetricSeries, rep: RepSuggestion): FaultSuggestion | null {
  const g = atTurns(good, rep);
  const b = atTurns(bad, rep);
  if (!g || !b) return null;
  let best: FaultSuggestion | null = null;
  for (const name of Object.keys(g)) {
    const G = g[name]!;
    const B = b[name] ?? [];
    if (G.length < 2 || B.length < 2) continue;
    const higher = mean(B) > mean(G);
    const gap = higher ? Math.min(...B) - Math.max(...G) : Math.min(...G) - Math.max(...B);
    // apart, and by more than noise: a third of the smallest movement of its kind
    if (!(gap > 0) || Math.abs(mean(B) - mean(G)) < minSwing(name, good.metrics) / 3) continue;
    const spread = (std(G) + std(B)) / 2;
    const scale = Math.max(Math.abs(mean(G) - mean(B)), 1e-9);
    const separation = gap / (spread + 0.01 * scale);
    if (best && separation <= best.separation) continue;
    const edge = higher ? (Math.max(...G) + Math.min(...B)) / 2 : (Math.min(...G) + Math.max(...B)) / 2;
    const round = rounder(Math.max(gap, scale / 10));
    const threshold = round(edge);
    const op = higher ? ">" : "<";
    best = { metric: name, definition: good.metrics[name]!, op, threshold, separation, good: G, bad: B, check: `at_turn: ${name} ${op} ${threshold}` };
  }
  return best;
}
