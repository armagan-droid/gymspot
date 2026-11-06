import { LANDMARK_NAMES, type Frame } from "@gymspot/shared";
import { describe, expect, test } from "vitest";
import { DEFAULT_VIEW_THRESHOLDS, detectView, dominantView } from "../src/index";
import { pressFrame, pushupFrame, squatFrame } from "../src/testing/index";

/** Scales the horizontal shoulder distance around its midpoint. */
function squeezeShoulders(f: Frame, k: number): Frame {
  const li = LANDMARK_NAMES.indexOf("left_shoulder");
  const ri = LANDMARK_NAMES.indexOf("right_shoulder");
  const image = f.image.map((p) => ({ ...p }));
  const mid = (image[li]!.x + image[ri]!.x) / 2;
  image[li]!.x = mid + (image[li]!.x - mid) * k;
  image[ri]!.x = mid + (image[ri]!.x - mid) * k;
  return { ...f, image };
}

describe("detectView (specs/04 Görünüm)", () => {
  test("front and side synthetic frames", () => {
    expect(detectView(squatFrame({ kneeAngle: 170 }, { view: "front" }))).toBe("front");
    expect(detectView(squatFrame({ kneeAngle: 100, torsoLean: 30 }, { view: "side" }))).toBe("side");
    expect(detectView(squatFrame({ kneeAngle: 100 }, { view: "front" }))).toBe("front");
    expect(detectView(pushupFrame({ elbowAngle: 120 }, { view: "side" }))).toBe("side");
    expect(detectView(pressFrame({ elbowAngle: 120 }, { view: "front" }))).toBe("front");
  });

  test("in-between shoulder width is ambiguous", () => {
    // front ratio is 0.38 / 0.52 ≈ 0.73; squeezing to ~0.45 of that lands between the thresholds
    expect(detectView(squeezeShoulders(squatFrame({ kneeAngle: 170 }, { view: "front" }), 0.45))).toBe("ambiguous");
  });

  test("thresholds are configurable", () => {
    const f = squeezeShoulders(squatFrame({ kneeAngle: 170 }, { view: "front" }), 0.45);
    expect(detectView(f, { front: 0.3, side: 0.2 })).toBe("front");
    expect(DEFAULT_VIEW_THRESHOLDS).toEqual({ front: 0.45, side: 0.2 });
  });
});

describe("dominantView", () => {
  test("most frequent view wins", () => {
    expect(dominantView(["front", "front", "side", "ambiguous", "front"])).toBe("front");
    expect(dominantView(["side", "ambiguous", "side"])).toBe("side");
  });

  test("ties and empty input are ambiguous", () => {
    expect(dominantView(["front", "side"])).toBe("ambiguous");
    expect(dominantView([])).toBe("ambiguous");
  });
});
