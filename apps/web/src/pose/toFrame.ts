import { type Frame, LANDMARK_NAMES } from "@gymspot/shared";

/** The parts of a MediaPipe PoseLandmarkerResult we use (structurally typed for tests). */
export interface PoseResultLike {
  landmarks: { x: number; y: number; z: number; visibility?: number }[][];
  worldLandmarks: { x: number; y: number; z: number; visibility?: number }[][];
}

/**
 * Converts the first detected pose into an engine Frame (specs/02). Returns
 * null when no complete pose was found. The result stays in memory only (specs/07).
 */
export function poseResultToFrame(result: PoseResultLike, t: number, pose = 0): Frame | null {
  const image = result.landmarks[pose];
  const world = result.worldLandmarks[pose];
  if (!image || !world || image.length !== LANDMARK_NAMES.length || world.length !== LANDMARK_NAMES.length) return null;
  const vis = (v: number | undefined) => Math.min(1, Math.max(0, v ?? 0));
  return {
    t,
    image: image.map((p) => ({ x: p.x, y: p.y, z: p.z, visibility: vis(p.visibility) })),
    // world landmarks may omit visibility; fall back to the image landmark's
    world: world.map((p, i) => ({ x: p.x, y: p.y, z: p.z, visibility: vis(p.visibility ?? image[i]!.visibility) })),
  };
}
