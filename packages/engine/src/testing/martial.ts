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

export interface EvaderParams {
  /** Sideways lean of the torso and head from the hips, degrees; positive = toward the person's left. */
  slip?: number;
  /** Hip–knee–ankle angle of both legs (180 = straight); lower = deeper duck. */
  kneeAngle?: number;
  /** Forward lean of the torso, degrees (ducks bend at the waist too). */
  torsoLean?: number;
  /** Shoulders stay square while only the neck tilts (a "neck-only" slip), degrees toward the left. */
  neckTilt?: number;
  /** 0 = guard (hands at the chin), 1 = hands dropped. */
  guardDrop?: number;
  /** Which hand drops with guardDrop. */
  dropSide?: "left" | "right" | "both";
}

/** Front-facing boxer in a square stance for head-movement drills (specs/04 "Eskiv"). */
export function evaderBody({
  slip = 0,
  kneeAngle = 165,
  torsoLean = 0,
  neckTilt = 0,
  guardDrop = 0,
  dropSide = "both",
}: EvaderParams = {}): Body {
  const a = rad((180 - kneeAngle) / 2);
  const s = rad(slip);
  const lean = rad(torsoLean);
  const j: Partial<Record<CoreJoint, BodyPoint>> = {};
  const hipMid = { f: 0, u: 0 };
  for (const [side, g] of [
    ["left", 1],
    ["right", -1],
  ] as const) {
    const ankle = { f: 0, u: 0.08, lat: g * 0.2 };
    const knee = { f: SEGMENT.shin * Math.sin(a), u: ankle.u + SEGMENT.shin * Math.cos(a), lat: g * 0.18 };
    const hip = { f: knee.f - SEGMENT.thigh * Math.sin(a), u: knee.u + SEGMENT.thigh * Math.cos(a), lat: g * 0.12 };
    Object.assign(hipMid, { f: hip.f, u: hip.u });
    Object.assign(j, { [`${side}_ankle`]: ankle, [`${side}_knee`]: knee, [`${side}_hip`]: hip });
  }
  // torso: rotate the upright shoulder line about the hip midpoint (lateral tilt, then forward lean)
  const up = { f: Math.sin(lean) * Math.cos(s), u: Math.cos(lean) * Math.cos(s), lat: Math.sin(s) };
  const across = { f: 0, u: -Math.sin(s), lat: Math.cos(s) }; // toward the person's left
  const shMid = { f: hipMid.f + SEGMENT.torso * up.f, u: hipMid.u + SEGMENT.torso * up.u, lat: SEGMENT.torso * up.lat };
  for (const [side, g] of [
    ["left", 1],
    ["right", -1],
  ] as const) {
    const shoulder = { f: shMid.f + g * 0.19 * across.f, u: shMid.u + g * 0.19 * across.u, lat: shMid.lat + g * 0.19 * across.lat };
    const dropped = dropSide === "both" || dropSide === side ? guardDrop : 0;
    const elbow = { f: shoulder.f + lerp(0.15, 0, dropped), u: shoulder.u - SEGMENT.upperArm * lerp(0.85, 1, dropped), lat: shoulder.lat - g * 0.04 };
    const wrist = { f: elbow.f + lerp(0.08, 0, dropped), u: elbow.u + SEGMENT.forearm * lerp(0.95, -1, dropped), lat: shoulder.lat - g * 0.12 };
    Object.assign(j, { [`${side}_shoulder`]: shoulder, [`${side}_elbow`]: elbow, [`${side}_wrist`]: wrist });
  }
  const n = rad(neckTilt);
  const neckUp = { f: up.f, u: up.u, lat: up.lat + Math.sin(n) };
  const len = Math.hypot(neckUp.f, neckUp.u, neckUp.lat);
  j.nose = {
    f: shMid.f + SEGMENT.neck * (neckUp.f / len) + 0.05,
    u: shMid.u + SEGMENT.neck * (neckUp.u / len),
    lat: shMid.lat + SEGMENT.neck * (neckUp.lat / len),
  };
  return completeBody(j as Record<CoreJoint, BodyPoint>);
}

export const evaderFrame = (p: EvaderParams, o: FrameOptions): Frame => toFrame(evaderBody(p), o);
