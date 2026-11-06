import type { Frame, LandmarkSequence, RepLabel } from "@gymspot/shared";
import { type Body, type BodyPoint, type CoreJoint, type FrameOptions, SEGMENT, completeBody, toFrame } from "./body";
import { createRandom } from "./random";
import { repTimeline } from "./timeline";

const rad = (deg: number) => (deg * Math.PI) / 180;
const lerp = (a: number, b: number, s: number) => a + (b - a) * s;
const SIDES = [
  ["left", 1],
  ["right", -1],
] as const;

// ---------------------------------------------------------------- squat

export interface SquatParams {
  /** Hip–knee–ankle angle, 180 = straight. */
  kneeAngle: number;
  /** Hip→shoulder lean from vertical, degrees forward. */
  torsoLean?: number;
  /** Knee shift toward the midline, as a fraction of leg length (kneeInwardRatio). */
  valgus?: number;
}

export function squatBody({ kneeAngle, torsoLean = 0, valgus = 0 }: SquatParams): Body {
  const a = rad((180 - kneeAngle) / 2);
  const lean = rad(torsoLean);
  const legLat = 0.11;
  const j: Partial<Record<CoreJoint, BodyPoint>> = {};
  for (const [s, g] of SIDES) {
    const ankle = { f: 0, u: 0.08, lat: g * legLat };
    const knee = {
      f: ankle.f + SEGMENT.shin * Math.sin(a),
      u: ankle.u + SEGMENT.shin * Math.cos(a),
      lat: g * (legLat - valgus * (SEGMENT.shin + SEGMENT.thigh)),
    };
    const hip = { f: knee.f - SEGMENT.thigh * Math.sin(a), u: knee.u + SEGMENT.thigh * Math.cos(a), lat: g * legLat };
    const shoulder = { f: hip.f + SEGMENT.torso * Math.sin(lean), u: hip.u + SEGMENT.torso * Math.cos(lean), lat: g * 0.19 };
    const elbow = { ...shoulder, f: shoulder.f + SEGMENT.upperArm };
    const wrist = { ...elbow, f: elbow.f + SEGMENT.forearm };
    Object.assign(j, { [`${s}_ankle`]: ankle, [`${s}_knee`]: knee, [`${s}_hip`]: hip, [`${s}_shoulder`]: shoulder, [`${s}_elbow`]: elbow, [`${s}_wrist`]: wrist });
  }
  const sh = j.left_shoulder!;
  j.nose = { f: sh.f + SEGMENT.neck * Math.sin(lean), u: sh.u + SEGMENT.neck * Math.cos(lean), lat: 0 };
  return completeBody(j as Record<CoreJoint, BodyPoint>);
}

export const squatFrame = (p: SquatParams, o: FrameOptions): Frame => toFrame(squatBody(p), o);

// ---------------------------------------------------------------- push-up

export interface PushupParams {
  /** Shoulder–elbow–wrist angle. */
  elbowAngle: number;
  /** Hip offset from the shoulder–ankle line as a fraction of that line (signedOffset), + = up. */
  hipOffset?: number;
}

export function pushupBody({ elbowAngle, hipOffset = 0 }: PushupParams): Body {
  const { upperArm: a, forearm: b } = SEGMENT;
  const d = Math.sqrt(a * a + b * b - 2 * a * b * Math.cos(rad(elbowAngle)));
  // elbow: circle intersection, bending toward the feet (−f)
  const y0 = (b * b - a * a + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(0, b * b - y0 * y0));
  const L = SEGMENT.torso + SEGMENT.thigh + SEGMENT.shin;
  const ankleF = -Math.sqrt(L * L - (d - 0.08) ** 2);
  const e = { f: ankleF / L, u: (0.08 - d) / L }; // shoulder → ankle unit vector
  const n = { f: e.u, u: -e.f }; // perpendicular, pointing up
  // Equal widths keep each side planar so angles stay exact.
  const lat = 0.17;
  const j: Partial<Record<CoreJoint, BodyPoint>> = {};
  for (const [s, g] of SIDES) {
    const shoulder = { f: 0, u: d, lat: g * lat };
    const hip = {
      f: e.f * SEGMENT.torso + n.f * hipOffset * L,
      u: d + e.u * SEGMENT.torso + n.u * hipOffset * L,
      lat: g * lat,
    };
    const ankle = { f: ankleF, u: 0.08, lat: g * lat };
    const k = SEGMENT.thigh / (SEGMENT.thigh + SEGMENT.shin);
    Object.assign(j, {
      [`${s}_shoulder`]: shoulder,
      [`${s}_elbow`]: { f: -h, u: y0, lat: g * lat },
      [`${s}_wrist`]: { f: 0, u: 0, lat: g * lat },
      [`${s}_hip`]: hip,
      [`${s}_knee`]: { f: lerp(hip.f, ankle.f, k), u: lerp(hip.u, ankle.u, k), lat: g * lat },
      [`${s}_ankle`]: ankle,
    });
  }
  j.nose = { f: SEGMENT.neck, u: d + 0.02, lat: 0 };
  return completeBody(j as Record<CoreJoint, BodyPoint>);
}

export const pushupFrame = (p: PushupParams, o: FrameOptions): Frame => toFrame(pushupBody(p), o);

// ---------------------------------------------------------------- shoulder press

export interface PressParams {
  /** Left (or both) shoulder–elbow–wrist angle. */
  elbowAngle: number;
  elbowAngleRight?: number;
  /** Backward lean of the torso from vertical, degrees. */
  torsoLean?: number;
}

export function pressBody({ elbowAngle, elbowAngleRight = elbowAngle, torsoLean = 0 }: PressParams): Body {
  const lean = rad(torsoLean);
  const j: Partial<Record<CoreJoint, BodyPoint>> = {};
  for (const [s, g] of SIDES) {
    const theta = rad(s === "left" ? elbowAngle : elbowAngleRight);
    const hip = { f: 0, u: 0.95, lat: g * 0.11 };
    const shoulder = { f: -SEGMENT.torso * Math.sin(lean), u: hip.u + SEGMENT.torso * Math.cos(lean), lat: g * 0.19 };
    // forearm vertical; upper arm sets the elbow angle in the frontal plane
    const elbow = {
      f: shoulder.f,
      u: shoulder.u - SEGMENT.upperArm * Math.cos(theta),
      lat: shoulder.lat + g * SEGMENT.upperArm * Math.sin(theta),
    };
    Object.assign(j, {
      [`${s}_hip`]: hip,
      [`${s}_knee`]: { f: 0, u: 0.52, lat: g * 0.11 },
      [`${s}_ankle`]: { f: 0, u: 0.08, lat: g * 0.11 },
      [`${s}_shoulder`]: shoulder,
      [`${s}_elbow`]: elbow,
      [`${s}_wrist`]: { ...elbow, u: elbow.u + SEGMENT.forearm },
    });
  }
  const sh = j.left_shoulder!;
  j.nose = { f: sh.f - SEGMENT.neck * Math.sin(lean), u: sh.u + SEGMENT.neck * Math.cos(lean), lat: 0 };
  return completeBody(j as Record<CoreJoint, BodyPoint>);
}

export const pressFrame = (p: PressParams, o: FrameOptions): Frame => toFrame(pressBody(p), o);

// ---------------------------------------------------------------- sequences

export interface SequenceOptions<P> {
  reps: (P & { durationMs?: number; label?: RepLabel })[];
  facing?: "left" | "right";
  fps?: number;
  noise?: number;
  seed?: number;
  leadInMs?: number;
  restMs?: number;
  leadOutMs?: number;
  farSideVisibility?: number;
}

function buildSequence<P extends object>(
  exerciseId: string,
  view: "front" | "side",
  o: SequenceOptions<P>,
  start: Required<P>,
  bodyOf: (p: Required<P>) => Body,
): LandmarkSequence {
  const fps = o.fps ?? 30;
  const rng = createRandom(o.seed ?? 1);
  const timeline = repTimeline({
    fps,
    reps: o.reps.map((r) => ({ durationMs: r.durationMs ?? 2000 })),
    leadInMs: o.leadInMs ?? 2000,
    restMs: o.restMs ?? 800,
    leadOutMs: o.leadOutMs ?? 1000,
  });
  const frames = timeline.map((pt) => {
    const params = { ...start };
    if (pt.repIndex !== null) {
      const target = o.reps[pt.repIndex]!;
      for (const k of Object.keys(start) as (keyof P)[]) {
        const to = (target[k] as number | undefined) ?? (start[k] as number);
        (params[k] as number) = lerp(start[k] as number, to, pt.progress);
      }
    }
    return toFrame(bodyOf(params), {
      view,
      facing: o.facing,
      t: pt.t,
      noise: o.noise ?? 0,
      rng,
      farSideVisibility: o.farSideVisibility,
    });
  });
  const labels = o.reps.every((r) => r.label) ? { reps: o.reps.map((r) => r.label!) } : undefined;
  return { formatVersion: 1, exerciseId, source: "synthetic", view, fps, ...(labels && { labels }), frames };
}

export function squatSequence(o: SequenceOptions<SquatParams> & { view: "front" | "side"; start?: Partial<SquatParams> }) {
  const start = { kneeAngle: 172, torsoLean: 5, valgus: 0, ...o.start };
  // Unless a rep says otherwise, the torso leans further as the squat deepens.
  const reps = o.reps.map((r) => ({ torsoLean: 30, ...r }));
  return buildSequence<SquatParams>("squat", o.view, { ...o, reps }, start, squatBody);
}

export function pushupSequence(o: SequenceOptions<PushupParams> & { start?: Partial<PushupParams> }) {
  const start = { elbowAngle: 168, hipOffset: 0, ...o.start };
  return buildSequence<PushupParams>("pushup", "side", o, start, pushupBody);
}

export function pressSequence(o: SequenceOptions<PressParams> & { view: "front" | "side"; start?: Partial<PressParams> }) {
  const start = { elbowAngle: 85, elbowAngleRight: 85, torsoLean: 0, ...o.start };
  // elbowAngleRight follows elbowAngle unless set explicitly.
  const reps = o.reps.map((r) => ({ ...r, elbowAngleRight: r.elbowAngleRight ?? r.elbowAngle }));
  return buildSequence<PressParams>("shoulder_press", o.view, { ...o, reps }, start, pressBody);
}
