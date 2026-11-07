import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { type Frame, LANDMARK_NAMES, type LandmarkName } from "@gymspot/shared";
import { describe, expect, test } from "vitest";
import { chooseNearSide, createMetricComputer, loadRulePack, resolveLandmark } from "../src/index";
import { pressFrame, pushupFrame, squatFrame, squatSequence } from "../src/testing/index";

const pack = (id: string) =>
  loadRulePack(JSON.parse(readFileSync(fileURLToPath(new URL(`../../../exercises/${id}.json`, import.meta.url)), "utf8"))).pack;

/** Overrides image coordinates of some landmarks on a copy of a frame. */
function withImage(base: Frame, points: Partial<Record<LandmarkName, { x: number; y: number }>>): Frame {
  const image = base.image.map((p) => ({ ...p }));
  for (const [name, xy] of Object.entries(points)) {
    Object.assign(image[LANDMARK_NAMES.indexOf(name as LandmarkName)]!, xy);
  }
  return { ...base, image };
}

describe("resolveLandmark", () => {
  test("near_/far_ map to the chosen side", () => {
    expect(resolveLandmark("near_hip", "left")).toBe("left_hip");
    expect(resolveLandmark("far_hip", "left")).toBe("right_hip");
    expect(resolveLandmark("near_foot_index", "right")).toBe("right_foot_index");
    expect(resolveLandmark("far_foot_index", "right")).toBe("left_foot_index");
    expect(resolveLandmark("nose", "right")).toBe("nose");
  });
});

describe("metric functions", () => {
  test("angle uses world coordinates", () => {
    const c = createMetricComputer({ k: { angle: ["left_hip", "left_knee", "left_ankle"] } });
    for (const view of ["front", "side"] as const) {
      expect(c.compute(squatFrame({ kneeAngle: 105 }, { view }), "left").k).toBeCloseTo(105, 1);
    }
  });

  test("near_/far_ follow the near side", () => {
    const c = createMetricComputer({ near: { angle: ["near_hip", "near_knee", "near_ankle"] } });
    const f = squatFrame({ kneeAngle: 120 }, { view: "side" });
    expect(c.compute(f, "left").near).toBeCloseTo(120, 1);
    expect(c.compute(f, "right").near).toBeCloseTo(120, 1);
  });

  test("avg and absDiff combine metrics", () => {
    const c = createMetricComputer({
      l: { angle: ["left_shoulder", "left_elbow", "left_wrist"] },
      r: { angle: ["right_shoulder", "right_elbow", "right_wrist"] },
      mean: { avg: ["l", "r"] },
      diff: { absDiff: ["l", "r"] },
    });
    const v = c.compute(pressFrame({ elbowAngle: 160, elbowAngleRight: 120 }, { view: "front" }), "left");
    expect(v.mean).toBeCloseTo(140, 1);
    expect(v.diff).toBeCloseTo(40, 1);
  });

  test("max takes the larger metric, or the one that can be computed (04, either-side techniques)", () => {
    const f = squatFrame({ kneeAngle: 120 }, { view: "front" });
    const mc = createMetricComputer({
      l: { angle: ["left_hip", "left_knee", "left_ankle"] },
      r: { angle: ["right_hip", "right_knee", "right_ankle"] },
      m: { max: ["l", "straight"] },
      straight: { angleFromVertical: ["left_hip", "left_shoulder"] },
      broken: { angleFromVertical: ["left_hip", "left_hip"] }, // NaN
      either: { max: ["broken", "l"] },
      none: { max: ["broken", "broken"] },
    });
    const v = mc.compute(f, "left");
    expect(v.m).toBeCloseTo(Math.max(v.l!, v.straight!), 6);
    expect(v.either).toBeCloseTo(v.l!, 6);
    expect(v.none).toBeNaN();
  });

  test("metrics may depend on metrics defined later", () => {
    const c = createMetricComputer({
      mean: { avg: ["l", "r"] },
      l: { angle: ["left_hip", "left_knee", "left_ankle"] },
      r: { angle: ["right_hip", "right_knee", "right_ankle"] },
    });
    expect(c.compute(squatFrame({ kneeAngle: 100 }, { view: "front" }), "left").mean).toBeCloseTo(100, 1);
  });

  test("diffY is a's height above b normalized by torso length (image)", () => {
    const base = squatFrame({ kneeAngle: 170 }, { view: "front" });
    // shoulders at y=0.3, hips at y=0.5 -> torso length 0.2
    const f = withImage(base, {
      left_shoulder: { x: 0.45, y: 0.3 },
      right_shoulder: { x: 0.55, y: 0.3 },
      left_hip: { x: 0.47, y: 0.5 },
      right_hip: { x: 0.53, y: 0.5 },
      left_wrist: { x: 0.45, y: 0.25 },
    });
    const c = createMetricComputer({ up: { diffY: ["left_wrist", "left_shoulder"] }, down: { diffY: ["left_shoulder", "left_wrist"] } });
    const v = c.compute(f, "left");
    expect(v.up).toBeCloseTo(0.05 / 0.2);
    expect(v.down).toBeCloseTo(-0.05 / 0.2);
  });

  test("angleFromVertical: 0 straight up, 90 horizontal, 180 straight down", () => {
    const base = squatFrame({ kneeAngle: 170 }, { view: "side" });
    const c = createMetricComputer({ lean: { angleFromVertical: ["left_hip", "left_shoulder"] } });
    const at = (x: number, y: number) => c.compute(withImage(base, { left_hip: { x: 0.5, y: 0.5 }, left_shoulder: { x, y } }), "left").lean;
    expect(at(0.5, 0.3)).toBeCloseTo(0);
    expect(at(0.7, 0.5)).toBeCloseTo(90);
    expect(at(0.3, 0.5)).toBeCloseTo(90);
    expect(at(0.5, 0.7)).toBeCloseTo(180);
    expect(at(0.6, 0.4)).toBeCloseTo(45);
  });

  test("angleFromVertical reproduces synthetic torso lean in side view", () => {
    const c = createMetricComputer({ lean: { angleFromVertical: ["near_hip", "near_shoulder"] } });
    expect(c.compute(squatFrame({ kneeAngle: 100, torsoLean: 40 }, { view: "side" }), "left").lean).toBeCloseTo(40, 1);
  });

  test("kneeInwardRatio: ~0 when aligned, positive inward, negative outward, both legs", () => {
    const c = createMetricComputer({
      l: { kneeInwardRatio: ["left_hip", "left_knee", "left_ankle"] },
      r: { kneeInwardRatio: ["right_hip", "right_knee", "right_ankle"] },
    });
    const aligned = c.compute(squatFrame({ kneeAngle: 120 }, { view: "front" }), "left");
    expect(aligned.l).toBeCloseTo(0, 3);
    expect(aligned.r).toBeCloseTo(0, 3);
    const inward = c.compute(squatFrame({ kneeAngle: 120, valgus: 0.1 }, { view: "front" }), "left");
    expect(inward.l).toBeGreaterThan(0.05);
    expect(inward.r).toBeCloseTo(inward.l!, 6);
    const outward = c.compute(squatFrame({ kneeAngle: 120, valgus: -0.1 }, { view: "front" }), "left");
    expect(outward.l).toBeLessThan(-0.05);
  });

  test("kneeInwardRatio equals the valgus fraction when the leg is straight", () => {
    const c = createMetricComputer({ l: { kneeInwardRatio: ["left_hip", "left_knee", "left_ankle"] } });
    expect(c.compute(squatFrame({ kneeAngle: 180, valgus: 0.1 }, { view: "front" }), "left").l).toBeCloseTo(0.1, 2);
  });

  test("signedOffset reproduces the push-up hip offset (+ = up)", () => {
    const c = createMetricComputer({ hip: { signedOffset: ["near_shoulder", "near_hip", "near_ankle"] } });
    for (const facing of ["left", "right"] as const) {
      const near = facing === "right" ? "left" : "right";
      for (const hipOffset of [0, 0.08, -0.06]) {
        const v = c.compute(pushupFrame({ elbowAngle: 150, hipOffset }, { view: "side", facing }), near).hip;
        expect(v, `${facing} ${hipOffset}`).toBeCloseTo(hipOffset, 3);
      }
    }
  });

  test("degenerate geometry yields NaN", () => {
    const base = squatFrame({ kneeAngle: 170 }, { view: "front" });
    const f = withImage(base, { left_hip: { x: 0.5, y: 0.5 }, left_shoulder: { x: 0.5, y: 0.5 } });
    const c = createMetricComputer({ lean: { angleFromVertical: ["left_hip", "left_shoulder"] } });
    expect(c.compute(f, "left").lean).toBeNaN();
  });
});

describe("landmarksOf", () => {
  test("returns the resolved landmarks a metric depends on, transitively", () => {
    const c = createMetricComputer({
      l: { angle: ["near_hip", "near_knee", "near_ankle"] },
      r: { angle: ["far_hip", "far_knee", "far_ankle"] },
      mean: { avg: ["l", "r"] },
    });
    expect([...c.landmarksOf("l", "left")].sort()).toEqual(["left_ankle", "left_hip", "left_knee"]);
    expect([...c.landmarksOf("mean", "right")].sort()).toEqual(
      ["left_ankle", "left_hip", "left_knee", "right_ankle", "right_hip", "right_knee"].sort(),
    );
  });
});

describe("real rule packs on synthetic frames", () => {
  test("squat pack metrics match the synthetic pose", () => {
    const c = createMetricComputer(pack("squat").metrics);
    const v = c.compute(squatFrame({ kneeAngle: 95, torsoLean: 35 }, { view: "side" }), "left");
    expect(v.knee_angle_near).toBeCloseTo(95, 1);
    expect(v.torso_lean).toBeCloseTo(35, 1);
  });

  test("pushup and press packs produce finite values for every metric", () => {
    for (const [id, frame, near] of [
      ["pushup", pushupFrame({ elbowAngle: 100, hipOffset: -0.05 }, { view: "side" }), "left"],
      ["shoulder_press", pressFrame({ elbowAngle: 150 }, { view: "front" }), "left"],
    ] as const) {
      const c = createMetricComputer(pack(id).metrics);
      const v = c.compute(frame, near);
      expect(Object.keys(v).sort()).toEqual(Object.keys(pack(id).metrics).sort());
      for (const [k, x] of Object.entries(v)) expect(Number.isFinite(x), `${id}.${k}`).toBe(true);
    }
  });
});

describe("chooseNearSide", () => {
  test("picks the more visible side", () => {
    expect(chooseNearSide(squatSequence({ view: "side", facing: "right", reps: [{ kneeAngle: 90 }] }).frames)).toBe("left");
    expect(chooseNearSide(squatSequence({ view: "side", facing: "left", reps: [{ kneeAngle: 90 }] }).frames)).toBe("right");
  });

  test("ties go to the left side", () => {
    expect(chooseNearSide([squatFrame({ kneeAngle: 170 }, { view: "front" })])).toBe("left");
  });
});
