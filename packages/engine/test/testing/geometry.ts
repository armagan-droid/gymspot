// Independent reference math for checking synthetic poses (deliberately not
// shared with the engine's metric implementation in T1.3).
import { LANDMARK_NAMES, type Frame, type LandmarkName } from "@gymspot/shared";

export const idx = (n: LandmarkName) => LANDMARK_NAMES.indexOf(n);

type P = { x: number; y: number; z: number };

export function angle3(a: P, b: P, c: P): number {
  const u = { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
  const v = { x: c.x - b.x, y: c.y - b.y, z: c.z - b.z };
  const dot = u.x * v.x + u.y * v.y + u.z * v.z;
  const nu = Math.hypot(u.x, u.y, u.z);
  const nv = Math.hypot(v.x, v.y, v.z);
  return (Math.acos(Math.max(-1, Math.min(1, dot / (nu * nv)))) * 180) / Math.PI;
}

export function worldAngle(f: Frame, a: LandmarkName, b: LandmarkName, c: LandmarkName): number {
  return angle3(f.world[idx(a)]!, f.world[idx(b)]!, f.world[idx(c)]!);
}

export function image(f: Frame, n: LandmarkName) {
  return f.image[idx(n)]!;
}

export function world(f: Frame, n: LandmarkName) {
  return f.world[idx(n)]!;
}
