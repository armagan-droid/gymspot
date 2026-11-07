import { type Frame, LANDMARK_NAMES, type RulePack, type View } from "@gymspot/shared";
import { faultEnabledInView } from "../exercise/exercise-engine";
import { type Side, chooseNearSide, resolveLandmark } from "../metrics/compute";
import { detectView, dominantView } from "../metrics/view";

// A3 camera setup checks — specs/08 "A3 kurulum kontrolleri".

export type SetupHint =
  | "setup.hint.multiple_people"
  | "setup.hint.show_full_body"
  | "setup.hint.step_back"
  | "setup.hint.move_closer"
  | "setup.hint.turn_side"
  | "setup.hint.face_camera"
  | "setup.hint.adjust_angle";

export interface SetupSample {
  /** Selected person's frame, or null (nobody / ambiguous selection). */
  frame: Frame | null;
  ambiguous: boolean;
}

export interface SetupAssessment {
  ready: boolean;
  view: View;
  nearSide: Side;
  hints: SetupHint[];
  /** Fault ids evaluated in the detected view, in rule pack order. */
  activeFaults: string[];
  /** Landmark indices that must be visible (for the A3 overlay). */
  requiredLandmarks: number[];
}

export const SETUP_CHECKS = { passRatio: 0.8, edgeMargin: 0.02, minSpread: 0.45 } as const;

const HINT_ORDER: SetupHint[] = [
  "setup.hint.multiple_people",
  "setup.hint.show_full_body",
  "setup.hint.step_back",
  "setup.hint.move_closer",
];

/** Assesses the last ~1 s of samples for the given rule pack. */
export function assessSetup(samples: readonly SetupSample[], pack: RulePack): SetupAssessment {
  const frames = samples.flatMap((s) => (s.frame ? [s.frame] : []));
  const nearSide = chooseNearSide(frames);
  const view = frames.length > 0 ? dominantView(frames.map((f) => detectView(f))) : "ambiguous";
  const required = pack.camera.minVisibleLandmarks.map((r) => LANDMARK_NAMES.indexOf(resolveLandmark(r, nearSide)));
  const { edgeMargin: m, minSpread } = SETUP_CHECKS;
  const minVis = pack.camera.minVisibility;

  const failures = new Map<SetupHint, number>();
  let passed = 0;
  for (const s of samples) {
    const hints = new Set<SetupHint>();
    if (!s.frame) {
      hints.add(s.ambiguous ? "setup.hint.multiple_people" : "setup.hint.show_full_body");
    } else {
      const img = s.frame.image;
      for (const i of required) {
        const p = img[i]!;
        if (p.visibility < minVis) hints.add("setup.hint.show_full_body");
        else if (p.x < m || p.x > 1 - m || p.y < m || p.y > 1 - m) hints.add("setup.hint.step_back");
      }
      // long side of the visible box: horizontal exercises (push-up) are short vertically
      const vis = img.filter((p) => p.visibility >= minVis);
      const span = (vals: number[]) => Math.max(...vals) - Math.min(...vals);
      if (vis.length < 2 || Math.max(span(vis.map((p) => p.x)), span(vis.map((p) => p.y))) < minSpread) {
        hints.add("setup.hint.move_closer");
      }
    }
    if (hints.size === 0) passed++;
    for (const h of hints) failures.set(h, (failures.get(h) ?? 0) + 1);
  }

  const framesOk = samples.length > 0 && passed / samples.length >= SETUP_CHECKS.passRatio;
  const views = pack.camera.views;
  const viewOk = view !== "ambiguous" && views.includes(view);

  const hints: SetupHint[] = [];
  if (!framesOk) {
    // hints that block the pass ratio, most important first
    const limit = samples.length * (1 - SETUP_CHECKS.passRatio);
    for (const h of HINT_ORDER) if ((failures.get(h) ?? 0) > limit || samples.length === 0) hints.push(h);
    if (samples.length === 0) hints.splice(0, hints.length, "setup.hint.show_full_body");
    // mixed causes can fail the ratio while each stays under its own limit: name the most frequent
    if (hints.length === 0) hints.push(HINT_ORDER.reduce((best, h) => ((failures.get(h) ?? 0) > (failures.get(best) ?? 0) ? h : best)));
  }
  if (frames.length > 0 && !viewOk) {
    if (view === "ambiguous") hints.push("setup.hint.adjust_angle");
    else hints.push(views.includes("side") ? "setup.hint.turn_side" : "setup.hint.face_camera");
  }

  return {
    ready: framesOk && viewOk,
    view,
    nearSide,
    hints,
    activeFaults: pack.faults.filter((f) => faultEnabledInView(f.views ?? views, view)).map((f) => f.id),
    requiredLandmarks: required,
  };
}
