import { type Frame, type Landmark, LANDMARK_NAMES, type LandmarkName } from "@gymspot/shared";
import type { Random } from "./random";

// Minimal kinematic body model for synthetic fixtures (specs/04).
// Body space: f = forward (direction the person faces), u = up from the floor,
// lat = lateral (positive = the person's left). Meters.

export interface BodyPoint {
  f: number;
  u: number;
  lat: number;
}

export type Body = Record<LandmarkName, BodyPoint>;

/** The joints exercise builders must provide; the rest is derived. */
export type CoreJoint =
  | "nose"
  | `${"left" | "right"}_${"shoulder" | "elbow" | "wrist" | "hip" | "knee" | "ankle"}`;

export const SEGMENT = { shin: 0.43, thigh: 0.45, torso: 0.52, upperArm: 0.3, forearm: 0.27, neck: 0.25 } as const;

const side = (name: string): "left" | "right" | null =>
  /(^|_)left(_|$)/.test(name) ? "left" : /(^|_)right(_|$)/.test(name) ? "right" : null;

const add = (p: BodyPoint, f: number, u: number, lat: number): BodyPoint => ({ f: p.f + f, u: p.u + u, lat: p.lat + lat });

/** Fills face, hand and foot landmarks from the core joints. */
export function completeBody(core: Record<CoreJoint, BodyPoint>): Body {
  const n = core.nose;
  const hand = (s: "left" | "right", k: number, dl: number) => {
    const w = core[`${s}_wrist`];
    const e = core[`${s}_elbow`];
    // continue a little along the forearm direction
    return { f: w.f + (w.f - e.f) * k, u: w.u + (w.u - e.u) * k, lat: w.lat + (w.lat - e.lat) * k + dl };
  };
  const sign = { left: 1, right: -1 } as const;
  const body: Partial<Body> = { ...core };
  for (const s of ["left", "right"] as const) {
    const g = sign[s];
    body[`${s}_eye_inner`] = add(n, -0.02, 0.03, g * 0.015);
    body[`${s}_eye`] = add(n, -0.025, 0.03, g * 0.03);
    body[`${s}_eye_outer`] = add(n, -0.03, 0.03, g * 0.045);
    body[`${s}_ear`] = add(n, -0.1, 0.01, g * 0.07);
    body[`mouth_${s}`] = add(n, -0.01, -0.04, g * 0.025);
    body[`${s}_pinky`] = hand(s, 0.3, g * 0.02);
    body[`${s}_index`] = hand(s, 0.35, 0);
    body[`${s}_thumb`] = hand(s, 0.2, -g * 0.02);
    body[`${s}_heel`] = add(core[`${s}_ankle`], -0.06, -0.06, 0);
    body[`${s}_foot_index`] = add(core[`${s}_ankle`], 0.15, -0.07, 0);
  }
  return body as Body;
}

export interface FrameOptions {
  view: "front" | "side";
  /** Side view only: which way the person faces in the image. */
  facing?: "left" | "right";
  t?: number;
  /** Image-space gaussian noise sigma (normalized units); world noise is scaled to meters. */
  noise?: number;
  rng?: Random;
  nearVisibility?: number;
  farSideVisibility?: number;
  /** Meters covered by the full image width/height (orthographic camera). */
  scale?: number;
}

/**
 * Projects a body into a MediaPipe-like Frame. World: hip-centered meters,
 * x right, y down, z away from the camera. Image: normalized [0,1].
 */
export function toFrame(body: Body, o: FrameOptions): Frame {
  const scale = o.scale ?? 2.5;
  const facing = o.facing ?? "right";
  const noise = o.noise ?? 0;
  const near = o.nearVisibility ?? 0.95;
  const far = o.farSideVisibility ?? 0.4;
  const farSide = o.view === "side" ? (facing === "right" ? "right" : "left") : null;

  const toWorld = (p: BodyPoint) => {
    if (o.view === "front") return { x: p.lat, y: -p.u, z: -p.f };
    return facing === "right" ? { x: p.f, y: -p.u, z: -p.lat } : { x: -p.f, y: -p.u, z: p.lat };
  };
  const raw = LANDMARK_NAMES.map((n) => toWorld(body[n]));
  const lh = raw[LANDMARK_NAMES.indexOf("left_hip")]!;
  const rh = raw[LANDMARK_NAMES.indexOf("right_hip")]!;
  const c = { x: (lh.x + rh.x) / 2, y: (lh.y + rh.y) / 2, z: (lh.z + rh.z) / 2 };

  const jitter = (sigma: number) => (sigma > 0 && o.rng ? o.rng.gaussian(sigma) : 0);
  const world: Landmark[] = [];
  const image: Landmark[] = [];
  raw.forEach((p, i) => {
    const visibility = farSide !== null && side(LANDMARK_NAMES[i]!) === farSide ? far : near;
    const w = { x: p.x - c.x, y: p.y - c.y, z: p.z - c.z };
    world.push({ x: w.x + jitter(noise * scale), y: w.y + jitter(noise * scale), z: w.z + jitter(noise * scale), visibility });
    image.push({ x: 0.5 + w.x / scale + jitter(noise), y: 0.55 + w.y / scale + jitter(noise), z: w.z / scale, visibility });
  });
  return { t: o.t ?? 0, image, world };
}

const MIRROR_INDEX = LANDMARK_NAMES.map((n) => {
  const s = side(n);
  if (!s) return LANDMARK_NAMES.indexOf(n);
  const other = n.replace(s, s === "left" ? "right" : "left") as LandmarkName;
  return LANDMARK_NAMES.indexOf(other);
});

/** Horizontal mirror: left/right landmarks swap, image x → 1 − x, world x → −x. */
export function mirrorFrame(frame: Frame): Frame {
  return {
    t: frame.t,
    image: MIRROR_INDEX.map((j) => ({ ...frame.image[j]!, x: 1 - frame.image[j]!.x })),
    world: MIRROR_INDEX.map((j) => ({ ...frame.world[j]!, x: -frame.world[j]!.x })),
  };
}
