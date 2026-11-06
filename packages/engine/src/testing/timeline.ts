import { createRandom } from "./random";

export interface TimelineOptions {
  fps: number;
  reps: { durationMs: number }[];
  /** Still time before the first rep (e.g. to satisfy readyPose). */
  leadInMs: number;
  /** Still time between reps. */
  restMs: number;
  leadOutMs: number;
}

export interface TimelinePoint {
  t: number;
  /** Index of the rep in progress, or null while resting. */
  repIndex: number | null;
  /** 0 at the start position, 1 at the turn point (mid-rep), back to 0. */
  progress: number;
}

/** Frame times with a smooth (raised cosine) 0→1→0 progress per rep. */
export function repTimeline(o: TimelineOptions): TimelinePoint[] {
  const windows: { start: number; end: number }[] = [];
  let cursor = o.leadInMs;
  o.reps.forEach((rep, i) => {
    if (i > 0) cursor += o.restMs;
    windows.push({ start: cursor, end: cursor + rep.durationMs });
    cursor += rep.durationMs;
  });
  const total = cursor + o.leadOutMs;
  const step = 1000 / o.fps;
  const points: TimelinePoint[] = [];
  for (let i = 0; i * step <= total + 1e-9; i++) {
    const t = i * step;
    const repIndex = windows.findIndex((w) => t >= w.start && t < w.end);
    if (repIndex === -1) {
      points.push({ t, repIndex: null, progress: 0 });
    } else {
      const w = windows[repIndex]!;
      const p = (t - w.start) / (w.end - w.start);
      points.push({ t, repIndex, progress: (1 - Math.cos(2 * Math.PI * p)) / 2 });
    }
  }
  return points;
}

export interface ScalarSignalOptions {
  fps: number;
  /** Value at the start position (e.g. standing knee angle). */
  from: number;
  reps: { to: number; durationMs?: number }[];
  leadInMs?: number;
  restMs?: number;
  leadOutMs?: number;
  /** Gaussian noise sigma, in the signal's units. */
  noise?: number;
  seed?: number;
}

/** A metric-level signal (e.g. knee_angle_avg over time) for rep counter tests. */
export function scalarSignal(o: ScalarSignalOptions): (TimelinePoint & { value: number })[] {
  const rng = createRandom(o.seed ?? 1);
  const noise = o.noise ?? 0;
  return repTimeline({
    fps: o.fps,
    reps: o.reps.map((r) => ({ durationMs: r.durationMs ?? 2000 })),
    leadInMs: o.leadInMs ?? 1000,
    restMs: o.restMs ?? 800,
    leadOutMs: o.leadOutMs ?? 1000,
  }).map((p) => {
    const target = p.repIndex === null ? o.from : o.reps[p.repIndex]!.to;
    const clean = o.from + (target - o.from) * p.progress;
    return { ...p, value: noise > 0 ? clean + rng.gaussian(noise) : clean };
  });
}
