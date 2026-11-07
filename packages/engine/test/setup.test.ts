import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { type Frame, LANDMARK_NAMES, type LandmarkName } from "@gymspot/shared";
import { describe, expect, test } from "vitest";
import { assessSetup, faultLandmarks, loadRulePack, selectPerson } from "../src/index";
import { pressFrame, pushupFrame, squatFrame } from "../src/testing/index";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const raw = (id: string): any => JSON.parse(readFileSync(fileURLToPath(new URL(`../../../exercises/${id}.json`, import.meta.url)), "utf8"));
const pack = (id: string) => loadRulePack(raw(id)).pack;

/** Scales image coordinates around (cx, cy) and moves them by (dx, dy). */
function transform(f: Frame, k: number, dx = 0, dy = 0, cx = 0.5, cy = 0.55): Frame {
  return { ...f, image: f.image.map((p) => ({ ...p, x: cx + (p.x - cx) * k + dx, y: cy + (p.y - cy) * k + dy })) };
}
function setVisibility(f: Frame, names: LandmarkName[], v: number): Frame {
  return { ...f, image: f.image.map((p, i) => (names.includes(LANDMARK_NAMES[i]!) ? { ...p, visibility: v } : p)) };
}
const second = (frames: Frame[]) => frames.map((f) => ({ frame: f, ambiguous: false }));
const oneSecond = (make: (t: number) => Frame) => Array.from({ length: 30 }, (_, i) => make((i * 1000) / 30));

describe("selectPerson (specs/07)", () => {
  const center = squatFrame({ kneeAngle: 170 }, { view: "front" });
  const smallSide = transform(center, 0.6, 0.3);

  test("a single person is selected", () => {
    const s = selectPerson([center]);
    expect(s.frame).toBe(center);
    expect(s.ambiguous).toBe(false);
    expect(s.track).toBeDefined();
  });

  test("the larger, more central person wins", () => {
    expect(selectPerson([smallSide, center]).frame).toBe(center);
  });

  test("two similar candidates without a track are ambiguous", () => {
    const left = transform(center, 1, -0.05);
    const right = transform(center, 1, 0.05);
    const s = selectPerson([left, right]);
    expect(s.ambiguous).toBe(true);
    expect(s.frame).toBeNull();
    expect(s.track).toBeUndefined();
  });

  test("an existing track is kept even if someone more central appears", () => {
    const first = selectPerson([smallSide]);
    const next = selectPerson([center, transform(smallSide, 1, 0.02)], first.track);
    expect(next.frame).not.toBe(center);
    expect(next.ambiguous).toBe(false);
  });

  test("when the tracked person is gone, selection starts over", () => {
    const first = selectPerson([smallSide]);
    expect(selectPerson([center], first.track).frame).toBe(center);
  });

  test("no candidates: no frame, track kept", () => {
    const first = selectPerson([center]);
    const s = selectPerson([], first.track);
    expect(s.frame).toBeNull();
    expect(s.track).toEqual(first.track);
  });
});

describe("assessSetup (specs/08 A3)", () => {
  const standing = (t: number) => squatFrame({ kneeAngle: 172 }, { view: "front", t });

  test("front view squat: ready, active checks for front", () => {
    const r = assessSetup(second(oneSecond(standing)), pack("squat"));
    expect(r).toMatchObject({ ready: true, view: "front", hints: [] });
    expect(r.activeFaults).toEqual(["insufficient_depth", "knee_valgus"]);
  });

  test("side view squat: near side and side checks", () => {
    const r = assessSetup(second(oneSecond((t) => squatFrame({ kneeAngle: 172 }, { view: "side", facing: "left", t }))), pack("squat"));
    expect(r).toMatchObject({ ready: true, view: "side", nearSide: "right" });
    expect(r.activeFaults).toEqual(["insufficient_depth", "excessive_forward_lean"]);
  });

  test("AC-8.5: push-up (side only) seen from the front is not ready and asks to turn sideways", () => {
    const r = assessSetup(second(oneSecond((t) => pushupFrame({ elbowAngle: 165 }, { view: "front", t }))), pack("pushup"));
    expect(r.ready).toBe(false);
    expect(r.hints).toContain("setup.hint.turn_side");
  });

  test("push-up from the side is ready (horizontal body is not 'too far')", () => {
    const r = assessSetup(second(oneSecond((t) => pushupFrame({ elbowAngle: 165 }, { view: "side", t }))), pack("pushup"));
    expect(r).toMatchObject({ ready: true, view: "side", hints: [] });
  });

  test("a front-only exercise seen from the side asks to face the camera", () => {
    const p = raw("shoulder_press");
    p.camera.views = ["front"];
    p.faults.forEach((f: { views?: string[] }) => delete f.views);
    const r = assessSetup(second(oneSecond((t) => pressFrame({ elbowAngle: 85 }, { view: "side", t }))), loadRulePack(p).pack);
    expect(r.ready).toBe(false);
    expect(r.hints).toContain("setup.hint.face_camera");
  });

  test("an ambiguous view asks to adjust the angle", () => {
    const squeezed = (t: number) => {
      const f = standing(t);
      const [li, ri] = [LANDMARK_NAMES.indexOf("left_shoulder"), LANDMARK_NAMES.indexOf("right_shoulder")];
      const image = f.image.map((p) => ({ ...p }));
      const mid = (image[li]!.x + image[ri]!.x) / 2;
      image[li]!.x = mid + (image[li]!.x - mid) * 0.45;
      image[ri]!.x = mid + (image[ri]!.x - mid) * 0.45;
      return { ...f, image };
    };
    const r = assessSetup(second(oneSecond(squeezed)), pack("squat"));
    expect(r.ready).toBe(false);
    expect(r.view).toBe("ambiguous");
    expect(r.hints).toContain("setup.hint.adjust_angle");
  });

  test("too far away asks to move closer", () => {
    const r = assessSetup(second(oneSecond((t) => transform(standing(t), 0.4))), pack("squat"));
    expect(r.ready).toBe(false);
    expect(r.hints).toContain("setup.hint.move_closer");
  });

  test("feet outside the frame asks to step back", () => {
    const r = assessSetup(second(oneSecond((t) => transform(standing(t), 1.6, 0, 0.1))), pack("squat"));
    expect(r.ready).toBe(false);
    expect(r.hints).toContain("setup.hint.step_back");
  });

  test("hidden legs ask to show the full body", () => {
    // both sides: hiding one leg just moves the near side to the other leg (near_* landmarks)
    const hidden = (t: number) => setVisibility(standing(t), ["left_knee", "right_knee"], 0.2);
    const r = assessSetup(second(oneSecond(hidden)), pack("squat"));
    expect(r.ready).toBe(false);
    expect(r.hints).toContain("setup.hint.show_full_body");
  });

  test("ambiguous person selection in ≥ 20% of frames blocks setup", () => {
    const samples = oneSecond(standing).map((f, i) => ({ frame: i % 4 === 0 ? null : f, ambiguous: i % 4 === 0 }));
    const r = assessSetup(samples, pack("squat"));
    expect(r.ready).toBe(false);
    expect(r.hints).toContain("setup.hint.multiple_people");
  });

  test("ready when at least 80% of frames pass", () => {
    const samples = oneSecond(standing).map((f, i) => ({
      frame: i % 7 === 0 ? setVisibility(f, ["left_knee", "right_knee"], 0.1) : f, // ~14% bad
      ambiguous: false,
    }));
    expect(assessSetup(samples, pack("squat")).ready).toBe(true);
  });

  test("no frames: not ready, show the full body", () => {
    expect(assessSetup([], pack("squat"))).toMatchObject({ ready: false, hints: ["setup.hint.show_full_body"] });
  });
});

describe("assessSetup: never stuck without a hint", () => {
  test("mixed failures below each hint's own limit still name the most frequent one", () => {
    const ok = squatFrame({ kneeAngle: 170 }, { view: "front" });
    const hidden = setVisibility(ok, ["left_ankle", "right_ankle"], 0.1); // show_full_body
    const edge = transform(ok, 1, 0, 0.5); // pushed off the bottom: step_back
    // 30 samples: 21 pass (70 % < 80 %), 5 + 4 failures, each ≤ the 20 % limit (6)
    const frames = [...Array<Frame>(21).fill(ok), ...Array<Frame>(5).fill(hidden), ...Array<Frame>(4).fill(edge)];
    const a = assessSetup(second(frames), pack("squat"));
    expect(a.ready).toBe(false);
    expect(a.hints[0]).toBe("setup.hint.show_full_body");
  });

  test("lists the required landmark indices for the overlay", () => {
    const a = assessSetup(second(oneSecond(() => squatFrame({ kneeAngle: 170 }, { view: "front" }))), pack("squat"));
    expect(a.requiredLandmarks.length).toBe(pack("squat").camera.minVisibleLandmarks.length);
    expect(a.requiredLandmarks.every((i) => i >= 0 && i < LANDMARK_NAMES.length)).toBe(true);
  });
});

describe("faultLandmarks (A5 highlight)", () => {
  const at = (n: LandmarkName) => LANDMARK_NAMES.indexOf(n);
  test("follows the check's metrics down to landmarks, both sides when the check uses both", () => {
    expect(faultLandmarks(pack("squat"), "knee_valgus", "left").sort((a, b) => a - b)).toEqual(
      [at("left_hip"), at("left_knee"), at("left_ankle"), at("right_hip"), at("right_knee"), at("right_ankle")].sort((a, b) => a - b),
    );
  });
  test("near_/far_ references resolve with the near side", () => {
    expect(faultLandmarks(pack("pushup"), "hip_sag", "right")).toEqual(expect.arrayContaining([at("right_hip")]));
    expect(faultLandmarks(pack("pushup"), "hip_sag", "right")).not.toContain(at("left_hip"));
  });
  test("an unknown fault has no landmarks", () => {
    expect(faultLandmarks(pack("squat"), "nope", "left")).toEqual([]);
  });
});

describe("assessSetup: problem edges (A3 guidance)", () => {
  const ok = squatFrame({ kneeAngle: 170 }, { view: "front" });
  test("feet below the picture → bottom edge", () => {
    const a = assessSetup(second(oneSecond(() => transform(ok, 1, 0, 0.3))), pack("squat"));
    expect(a.edges).toContain("bottom");
    expect(a.edges).not.toContain("top");
  });
  test("a well placed person has no problem edges", () => {
    expect(assessSetup(second(oneSecond(() => ok)), pack("squat")).edges).toEqual([]);
  });
});
