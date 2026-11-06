import type { Frame } from "@gymspot/shared";

/**
 * Produces pose candidates (one Frame per detected person) from a video
 * element. MediaPipe in the app, a scripted source in tests.
 */
export interface PoseSource {
  start(video: HTMLVideoElement | null, onResult: (candidates: Frame[], t: number) => void): Promise<void>;
  stop(): void;
}
