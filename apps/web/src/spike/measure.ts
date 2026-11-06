// Measurement helpers for the T2.2 pose spike (specs/02 "Performans bütçesi").

/** Frames per second over a sliding time window. */
export class FpsMeter {
  private times: number[] = [];

  constructor(private readonly windowMs = 2000) {}

  tick(now: number): void {
    this.times.push(now);
    while (this.times.length > 0 && now - this.times[0]! > this.windowMs) this.times.shift();
  }

  get fps(): number {
    if (this.times.length < 2) return 0;
    const span = this.times.at(-1)! - this.times[0]!;
    return span > 0 ? ((this.times.length - 1) * 1000) / span : 0;
  }
}

/** Nearest-rank percentile (p in 0..100) of a non-empty list. */
export function percentile(values: readonly number[], p: number): number {
  if (values.length === 0) return NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(sorted.length, Math.max(1, rank)) - 1]!;
}

/** Keeps the last N samples. */
export class SampleBuffer {
  private values: number[] = [];

  constructor(private readonly max = 600) {}

  add(v: number): void {
    if (!Number.isFinite(v)) return;
    this.values.push(v);
    if (this.values.length > this.max) this.values.shift();
  }

  get samples(): readonly number[] {
    return this.values;
  }

  stats() {
    return { n: this.values.length, p50: percentile(this.values, 50), p95: percentile(this.values, 95) };
  }
}

export interface SpikeReport {
  device: { userAgent: string; cores: number | null; screen: string; standalone: boolean };
  model: string;
  delegate: string;
  fps: number;
  inferenceMs: { n: number; p50: number; p95: number };
  /** Camera capture → result, when the browser exposes captureTime. */
  latencyMs: { n: number; p50: number; p95: number } | null;
  /** |world 3D knee angle − image 2D knee angle| samples, to judge view dependence. */
  kneeAngleGapDeg: { n: number; p50: number; p95: number };
  wakeLock: "active" | "unsupported" | "denied" | "off";
  audio: "unlocked" | "locked" | "untested";
  /** Meets the specs/02 budget: ≥ 15 FPS and p95 latency (or inference) ≤ 250 ms. */
  meetsBudget: boolean;
}

export function meetsBudget(fps: number, p95LatencyMs: number): boolean {
  return fps >= 15 && p95LatencyMs <= 250;
}
