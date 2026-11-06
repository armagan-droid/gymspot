import { describe, expect, test } from "vitest";
import { LandmarkSequenceSchema } from "../src/index";

const lm = { x: 0.5, y: 0.5, z: 0, visibility: 0.9 };
const frame = (t: number) => ({ t, image: Array(33).fill(lm), world: Array(33).fill(lm) });

const seq = {
  formatVersion: 1,
  exerciseId: "squat",
  source: "synthetic",
  view: "front",
  fps: 30,
  labels: { reps: [{ outcome: "valid", faults: [] }] },
  frames: [frame(0), frame(33)],
};

describe("LandmarkSequence (specs/04 fixture format)", () => {
  test("valid sequence parses", () => {
    expect(LandmarkSequenceSchema.safeParse(seq).success).toBe(true);
  });

  test("labels are optional", () => {
    const { labels: _l, ...noLabels } = seq;
    expect(LandmarkSequenceSchema.safeParse(noLabels).success).toBe(true);
  });

  test("frame timestamps must be strictly increasing", () => {
    expect(LandmarkSequenceSchema.safeParse({ ...seq, frames: [frame(33), frame(0)] }).success).toBe(false);
    expect(LandmarkSequenceSchema.safeParse({ ...seq, frames: [frame(0), frame(0)] }).success).toBe(false);
  });

  test("view cannot be ambiguous and source must be known", () => {
    expect(LandmarkSequenceSchema.safeParse({ ...seq, view: "ambiguous" }).success).toBe(false);
    expect(LandmarkSequenceSchema.safeParse({ ...seq, source: "video" }).success).toBe(false);
  });

  test("unknown fields are rejected (no image data can ride along, specs/07)", () => {
    expect(LandmarkSequenceSchema.safeParse({ ...seq, video: "data:..." }).success).toBe(false);
  });
});
