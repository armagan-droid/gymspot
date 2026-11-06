import { z } from "zod";
import { LANDMARK_NAMES } from "./landmarks";

const LandmarkSchema = z.strictObject({
  x: z.number(),
  y: z.number(),
  z: z.number(),
  visibility: z.number().min(0).max(1),
});
export type Landmark = z.infer<typeof LandmarkSchema>;

const landmarks = z.array(LandmarkSchema).length(LANDMARK_NAMES.length);

/**
 * One processed camera frame (specs/02). Lives in memory only and never
 * leaves the device (specs/07); this schema exists for fixtures and tests.
 */
export const FrameSchema = z.strictObject({
  /** Monotonic timestamp in ms. */
  t: z.number().nonnegative(),
  /** Normalized [0,1] image coordinates. */
  image: landmarks,
  /** MediaPipe worldLandmarks: meters, hip-centered. */
  world: landmarks,
});
export type Frame = z.infer<typeof FrameSchema>;
