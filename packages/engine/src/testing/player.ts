import type { Frame, LandmarkSequence } from "@gymspot/shared";

export interface PlayOptions {
  /** Drop frames to simulate a slower device (keeps a frame once ≥ 1000/fps ms passed). */
  fps?: number;
}

/** Feeds a sequence's frames, in order, to an engine stage and collects its outputs. */
export function playSequence<T>(seq: LandmarkSequence, consume: (frame: Frame) => T[], o: PlayOptions = {}): T[] {
  const minGap = o.fps ? 1000 / o.fps - 1e-6 : 0;
  const out: T[] = [];
  let last = -Infinity;
  for (const frame of seq.frames) {
    if (frame.t - last < minGap) continue;
    last = frame.t;
    out.push(...consume(frame));
  }
  return out;
}
