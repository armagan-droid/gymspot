import { describe, expect, test } from "vitest";
import { FrameSchema, LANDMARK_NAMES } from "../src/index";

const lm = { x: 0.5, y: 0.5, z: 0, visibility: 0.9 };
const frame = (n = 33) => ({ t: 0, image: Array(n).fill(lm), world: Array(n).fill(lm) });

describe("Frame (specs/02)", () => {
  test("MediaPipe Pose has 33 named landmarks", () => {
    expect(LANDMARK_NAMES).toHaveLength(33);
    expect(new Set(LANDMARK_NAMES).size).toBe(33);
    expect(LANDMARK_NAMES[0]).toBe("nose");
    expect(LANDMARK_NAMES[23]).toBe("left_hip");
  });

  test("valid frame parses", () => {
    expect(FrameSchema.safeParse(frame()).success).toBe(true);
  });

  test("wrong landmark count is rejected", () => {
    expect(FrameSchema.safeParse(frame(32)).success).toBe(false);
  });

  test("visibility must be within 0..1", () => {
    const f = frame();
    f.image = [...f.image.slice(1), { ...lm, visibility: 1.2 }];
    expect(FrameSchema.safeParse(f).success).toBe(false);
  });
});
