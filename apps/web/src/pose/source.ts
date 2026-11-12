import type { Frame } from "@gymspot/shared";

/**
 * Produces pose candidates (one Frame per detected person) from a video
 * element. MediaPipe in the app, a scripted source in tests.
 */
export interface PoseSource {
  start(video: HTMLVideoElement | null, onResult: (candidates: Frame[], t: number) => void): Promise<void>;
  stop(): void;
  /** Live numbers for the diagnostics panel (specs/08 A5), when the source has them. */
  stats?(): PoseSourceStats;
}

export interface PoseSourceStats {
  model: string;
  /** "GPU" or "CPU" once the model is loaded. */
  delegate?: string;
  /** Pose model time of the latest frame. */
  inferenceMs?: number;
}
