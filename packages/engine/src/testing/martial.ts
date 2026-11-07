import type { Frame } from "@gymspot/shared";
import { type Body, type BodyPoint, type CoreJoint, type FrameOptions, SEGMENT, completeBody, toFrame } from "./body";

// Fighting stance for martial-arts techniques (specs/00 "Dövüş sporları", 04).
// Every limb moves in its own sagittal plane, so world angles are exact.

const rad = (deg: number) => (deg * Math.PI) / 180;
const lerp = (a: number, b: number, s: number) => a + (b - a) * s;
const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

export interface FighterParams {
  /** Leg that kicks or strikes with the knee. */
  kickSide?: "left" | "right";
  /** Thigh angle forward from straight down, degrees (0 = standing, 90 = thigh horizontal). */
  hipFlex?: number;
  /** Kicking leg hip–knee–ankle angle (180 = straight). */
  kneeAngle?: number;
  /** Arm that punches. */
  punchSide?: "left" | "right";
  /** Punching arm shoulder–elbow–wrist angle: 35 = guard, 175 = fully extended. */
  punchElbow?: number;
  /** Non-punching hands: 0 = guard (hands at the chin), 1 = dropped to the sides. */
  guardDrop?: number;
  /** Backward lean of the torso from vertical, degrees. */
  torsoLean?: number;
}

/** Guard: upper arm slightly forward, forearm up. Extension swings the upper arm to horizontal. */
function arm(shoulder: BodyPoint, elbowAngle: number, shoulderFlex: number) {
  const a = rad(shoulderFlex);
  const elbow = { f: shoulder.f + SEGMENT.upperArm * Math.sin(a), u: shoulder.u - SEGMENT.upperArm * Math.cos(a), lat: shoulder.lat };
  const b = a + rad(180 - elbowAngle);
  const wrist = { f: elbow.f + SEGMENT.forearm * Math.sin(b), u: elbow.u - SEGMENT.forearm * Math.cos(b), lat: shoulder.lat };
  return { elbow, wrist };
}

export function fighterBody({
  kickSide = "right",
  hipFlex = 0,
  kneeAngle = 180,
  punchSide = "right",
  punchElbow = 35,
  guardDrop = 0,
  torsoLean = 0,
}: FighterParams = {}): Body {
  const lean = rad(torsoLean);
  const j: Partial<Record<CoreJoint, BodyPoint>> = {};
  for (const [s, g] of [
    ["left", 1],
    ["right", -1],
  ] as const) {
    const lat = g * 0.12;
    const hip = { f: 0, u: 0.08 + SEGMENT.shin + SEGMENT.thigh, lat };
    let knee = { f: 0, u: hip.u - SEGMENT.thigh, lat };
    let ankle = { f: 0, u: 0.08, lat };
    if (s === kickSide) {
      const th = rad(hipFlex);
      knee = { f: hip.f + SEGMENT.thigh * Math.sin(th), u: hip.u - SEGMENT.thigh * Math.cos(th), lat };
      const ph = th - rad(180 - kneeAngle);
      ankle = { f: knee.f + SEGMENT.shin * Math.sin(ph), u: knee.u - SEGMENT.shin * Math.cos(ph), lat };
    }
    const shoulder = { f: -SEGMENT.torso * Math.sin(lean), u: hip.u + SEGMENT.torso * Math.cos(lean), lat: g * 0.19 };
    const punching = s === punchSide;
    const ext = clamp01((punchElbow - 35) / 140);
    const { elbow, wrist } = punching
      ? arm(shoulder, punchElbow, lerp(25, 85, ext))
      : arm(shoulder, lerp(35, 175, guardDrop), lerp(25, 5, guardDrop));
    Object.assign(j, { [`${s}_hip`]: hip, [`${s}_knee`]: knee, [`${s}_ankle`]: ankle, [`${s}_shoulder`]: shoulder, [`${s}_elbow`]: elbow, [`${s}_wrist`]: wrist });
  }
  const sh = j.left_shoulder!;
  j.nose = { f: sh.f + 0.05 - SEGMENT.neck * Math.sin(lean), u: sh.u + SEGMENT.neck * Math.cos(lean), lat: 0 };
  return completeBody(j as Record<CoreJoint, BodyPoint>);
}

export const fighterFrame = (p: FighterParams, o: FrameOptions): Frame => toFrame(fighterBody(p), o);
