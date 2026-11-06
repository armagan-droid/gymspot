import { LANDMARK_NAMES, FrameSchema, LandmarkSequenceSchema } from "@gymspot/shared";
import { describe, expect, test } from "vitest";
import {
  mirrorFrame,
  playSequence,
  pressFrame,
  pressSequence,
  pushupFrame,
  pushupSequence,
  squatFrame,
  squatSequence,
} from "../../src/testing/index";
import { image, world, worldAngle } from "./geometry";

describe("squat poses", () => {
  test.each([170, 130, 90])("knee angle %i° is reproduced in world coordinates (both views)", (kneeAngle) => {
    for (const view of ["front", "side"] as const) {
      const f = squatFrame({ kneeAngle, torsoLean: 20 }, { view });
      expect(worldAngle(f, "left_hip", "left_knee", "left_ankle")).toBeCloseTo(kneeAngle, 1);
      expect(worldAngle(f, "right_hip", "right_knee", "right_ankle")).toBeCloseTo(kneeAngle, 1);
    }
  });

  test("frames are valid Frame objects with 33 landmarks", () => {
    const f = squatFrame({ kneeAngle: 120 }, { view: "front" });
    expect(FrameSchema.safeParse(f).success).toBe(true);
  });

  test("world coordinates are hip-centered", () => {
    const f = squatFrame({ kneeAngle: 120 }, { view: "side" });
    const l = world(f, "left_hip");
    const r = world(f, "right_hip");
    expect((l.x + r.x) / 2).toBeCloseTo(0);
    expect((l.y + r.y) / 2).toBeCloseTo(0);
    expect((l.z + r.z) / 2).toBeCloseTo(0);
  });

  test("y points down: shoulders above hips above ankles in the image", () => {
    const f = squatFrame({ kneeAngle: 170 }, { view: "front" });
    expect(image(f, "left_shoulder").y).toBeLessThan(image(f, "left_hip").y);
    expect(image(f, "left_hip").y).toBeLessThan(image(f, "left_ankle").y);
  });

  test("front view: person's left side appears on the image right", () => {
    const f = squatFrame({ kneeAngle: 170 }, { view: "front" });
    expect(image(f, "left_shoulder").x).toBeGreaterThan(image(f, "right_shoulder").x);
  });

  test("side view: the side facing the camera is near (smaller z) and more visible", () => {
    const right = squatFrame({ kneeAngle: 120 }, { view: "side", facing: "right" });
    expect(world(right, "left_hip").z).toBeLessThan(world(right, "right_hip").z);
    expect(image(right, "left_knee").visibility).toBeGreaterThan(image(right, "right_knee").visibility);
    const left = squatFrame({ kneeAngle: 120 }, { view: "side", facing: "left" });
    expect(world(left, "right_hip").z).toBeLessThan(world(left, "left_hip").z);
    expect(image(left, "right_knee").visibility).toBeGreaterThan(image(left, "left_knee").visibility);
  });

  test("side view: torso lean shows as the hip→shoulder angle from vertical in the image", () => {
    const f = squatFrame({ kneeAngle: 100, torsoLean: 40 }, { view: "side" });
    const h = image(f, "left_hip");
    const s = image(f, "left_shoulder");
    const fromVertical = (Math.atan2(Math.abs(s.x - h.x), h.y - s.y) * 180) / Math.PI;
    expect(fromVertical).toBeCloseTo(40, 0);
  });

  test("front view: valgus moves knees toward the midline", () => {
    const straight = squatFrame({ kneeAngle: 110, valgus: 0 }, { view: "front" });
    const valgus = squatFrame({ kneeAngle: 110, valgus: 0.2 }, { view: "front" });
    const width = (f: typeof straight) => image(f, "left_knee").x - image(f, "right_knee").x;
    expect(width(valgus)).toBeLessThan(width(straight));
  });
});

describe("pushup poses", () => {
  test.each([165, 120, 90])("elbow angle %i° is reproduced", (elbowAngle) => {
    const f = pushupFrame({ elbowAngle }, { view: "side" });
    expect(worldAngle(f, "left_shoulder", "left_elbow", "left_wrist")).toBeCloseTo(elbowAngle, 1);
  });

  test("straight body line by default, hip offset bends it", () => {
    const straight = pushupFrame({ elbowAngle: 150 }, { view: "side" });
    expect(worldAngle(straight, "left_shoulder", "left_hip", "left_ankle")).toBeCloseTo(180, 0);
    const sag = pushupFrame({ elbowAngle: 150, hipOffset: -0.1 }, { view: "side" });
    expect(worldAngle(sag, "left_shoulder", "left_hip", "left_ankle")).toBeLessThan(170);
    // Sagging hips sit below the shoulder–ankle line (larger image y), piked hips above it.
    // (Frames are hip-centered, so compare against the line, not across frames.)
    const belowLine = (f: typeof straight) => {
      const s = image(f, "left_shoulder");
      const a = image(f, "left_ankle");
      const h = image(f, "left_hip");
      return h.y - (s.y + ((a.y - s.y) * (h.x - s.x)) / (a.x - s.x));
    };
    expect(belowLine(straight)).toBeCloseTo(0, 6);
    expect(belowLine(sag)).toBeGreaterThan(0.01);
    expect(belowLine(pushupFrame({ elbowAngle: 150, hipOffset: 0.1 }, { view: "side" }))).toBeLessThan(-0.01);
  });
});

describe("shoulder press poses", () => {
  test.each([90, 130, 170])("elbow angle %i° is reproduced on both arms", (elbowAngle) => {
    const f = pressFrame({ elbowAngle }, { view: "front" });
    expect(worldAngle(f, "left_shoulder", "left_elbow", "left_wrist")).toBeCloseTo(elbowAngle, 1);
    expect(worldAngle(f, "right_shoulder", "right_elbow", "right_wrist")).toBeCloseTo(elbowAngle, 1);
  });

  test("arms can differ (asymmetry)", () => {
    const f = pressFrame({ elbowAngle: 160, elbowAngleRight: 120 }, { view: "front" });
    expect(worldAngle(f, "left_shoulder", "left_elbow", "left_wrist")).toBeCloseTo(160, 1);
    expect(worldAngle(f, "right_shoulder", "right_elbow", "right_wrist")).toBeCloseTo(120, 1);
  });

  test("wrists end up above the head at lockout", () => {
    const f = pressFrame({ elbowAngle: 175 }, { view: "front" });
    expect(image(f, "left_wrist").y).toBeLessThan(image(f, "nose").y);
  });
});

describe("mirrorFrame", () => {
  test("swaps left/right landmarks and flips x", () => {
    const f = squatFrame({ kneeAngle: 120, valgus: 0.1 }, { view: "side", facing: "right" });
    const m = mirrorFrame(f);
    const li = LANDMARK_NAMES.indexOf("left_knee");
    const ri = LANDMARK_NAMES.indexOf("right_knee");
    expect(m.image[ri]!.x).toBeCloseTo(1 - f.image[li]!.x);
    expect(m.image[ri]!.y).toBeCloseTo(f.image[li]!.y);
    expect(m.world[ri]!.x).toBeCloseTo(-f.world[li]!.x);
    expect(m.image[ri]!.visibility).toBe(f.image[li]!.visibility);
    expect(m.image[0]!.x).toBeCloseTo(1 - f.image[0]!.x); // nose stays nose
  });

  test("mirroring twice is the identity", () => {
    const f = squatFrame({ kneeAngle: 120 }, { view: "front" });
    const twice = mirrorFrame(mirrorFrame(f));
    twice.image.forEach((p, i) => expect(p.x).toBeCloseTo(f.image[i]!.x));
  });

  test("a right-facing side view mirrors into a left-facing one", () => {
    const right = squatFrame({ kneeAngle: 120 }, { view: "side", facing: "right" });
    const left = squatFrame({ kneeAngle: 120 }, { view: "side", facing: "left" });
    mirrorFrame(right).image.forEach((p, i) => {
      expect(p.x).toBeCloseTo(left.image[i]!.x, 6);
      expect(p.y).toBeCloseTo(left.image[i]!.y, 6);
    });
  });
});

describe("sequences", () => {
  test("squatSequence produces a valid labeled LandmarkSequence", () => {
    const seq = squatSequence({
      view: "front",
      reps: [
        { kneeAngle: 90, label: { outcome: "valid", faults: [] } },
        { kneeAngle: 125, label: { outcome: "faulty", faults: ["insufficient_depth"] } },
      ],
      seed: 3,
    });
    expect(LandmarkSequenceSchema.safeParse(seq).success).toBe(true);
    expect(seq.exerciseId).toBe("squat");
    expect(seq.source).toBe("synthetic");
    expect(seq.labels?.reps).toHaveLength(2);
  });

  test("squat sequence knee angle dips to each rep's depth and returns to standing", () => {
    const seq = squatSequence({ view: "side", reps: [{ kneeAngle: 90 }, { kneeAngle: 125 }], noise: 0 });
    const knee = seq.frames.map((f) => worldAngle(f, "left_hip", "left_knee", "left_ankle"));
    expect(knee[0]).toBeCloseTo(172, 0);
    expect(Math.min(...knee)).toBeCloseTo(90, 0);
    expect(knee.at(-1)).toBeCloseTo(172, 0);
  });

  test("noise is seeded", () => {
    const a = squatSequence({ view: "front", reps: [{ kneeAngle: 90 }], noise: 0.004, seed: 9 });
    const b = squatSequence({ view: "front", reps: [{ kneeAngle: 90 }], noise: 0.004, seed: 9 });
    const clean = squatSequence({ view: "front", reps: [{ kneeAngle: 90 }], noise: 0 });
    expect(a).toEqual(b);
    expect(a.frames[5]!.image[0]!.x).not.toBe(clean.frames[5]!.image[0]!.x);
  });

  test("pushup and press sequences are valid", () => {
    const p = pushupSequence({ reps: [{ elbowAngle: 85 }] });
    const s = pressSequence({ view: "front", reps: [{ elbowAngle: 172 }] });
    expect(LandmarkSequenceSchema.safeParse(p).success).toBe(true);
    expect(LandmarkSequenceSchema.safeParse(s).success).toBe(true);
    expect(p.view).toBe("side");
  });
});

describe("playSequence", () => {
  test("feeds every frame in order and collects outputs", () => {
    const seq = squatSequence({ view: "front", reps: [{ kneeAngle: 90 }] });
    const ts = playSequence(seq, (f) => [f.t]);
    expect(ts).toEqual(seq.frames.map((f) => f.t));
  });

  test("can downsample to a lower fps", () => {
    const seq = squatSequence({ view: "front", reps: [{ kneeAngle: 90 }], fps: 30 });
    const ts = playSequence(seq, (f) => [f.t], { fps: 15 });
    expect(ts.length).toBeLessThanOrEqual(Math.ceil(seq.frames.length / 2) + 1);
    expect(ts.length).toBeGreaterThanOrEqual(Math.floor(seq.frames.length / 2) - 1);
    ts.slice(1).forEach((t, i) => expect(t - ts[i]!).toBeGreaterThanOrEqual(1000 / 15 - 1e-6));
  });
});
