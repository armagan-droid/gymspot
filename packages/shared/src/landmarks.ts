import { z } from "zod";

/** MediaPipe Pose landmark names, in model index order (0–32). */
export const LANDMARK_NAMES = [
  "nose",
  "left_eye_inner",
  "left_eye",
  "left_eye_outer",
  "right_eye_inner",
  "right_eye",
  "right_eye_outer",
  "left_ear",
  "right_ear",
  "mouth_left",
  "mouth_right",
  "left_shoulder",
  "right_shoulder",
  "left_elbow",
  "right_elbow",
  "left_wrist",
  "right_wrist",
  "left_pinky",
  "right_pinky",
  "left_index",
  "right_index",
  "left_thumb",
  "right_thumb",
  "left_hip",
  "right_hip",
  "left_knee",
  "right_knee",
  "left_ankle",
  "right_ankle",
  "left_heel",
  "right_heel",
  "left_foot_index",
  "right_foot_index",
] as const;

export type LandmarkName = (typeof LANDMARK_NAMES)[number];

/** Joints that exist on both sides, e.g. "hip" for left_hip/right_hip. */
export type BilateralJoint = LandmarkName extends infer N ? (N extends `left_${infer J}` ? J : never) : never;

/** A landmark name or a virtual near_/far_ landmark (specs/04 "Sanal noktalar"). */
export type LandmarkRef = LandmarkName | `near_${BilateralJoint}` | `far_${BilateralJoint}`;

export const BILATERAL_JOINTS = LANDMARK_NAMES.flatMap((n) =>
  n.startsWith("left_") && (LANDMARK_NAMES as readonly string[]).includes(`right_${n.slice(5)}`) ? [n.slice(5)] : [],
) as BilateralJoint[];

export const LANDMARK_REFS = [
  ...LANDMARK_NAMES,
  ...BILATERAL_JOINTS.map((j) => `near_${j}` as const),
  ...BILATERAL_JOINTS.map((j) => `far_${j}` as const),
] as [LandmarkRef, ...LandmarkRef[]];

export const LandmarkRefSchema = z.enum(LANDMARK_REFS);
