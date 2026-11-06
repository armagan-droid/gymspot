import type { Frame } from "@gymspot/shared";
import type { PoseLandmarker } from "@mediapipe/tasks-vision";
import type { PoseSource } from "./source";
import { poseResultToFrame } from "./toFrame";

// MediaPipe Pose source (specs/02). numPoses = 2 for person selection (specs/07).
// WASM and model are loaded from CDNs for now; self-hosting is a pending
// decision after the T2.2 spike (specs/02 "Spike sonrası karar verilecekler").

export type PoseModelVariant = "lite" | "full" | "heavy";

const WASM_BASE = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.2.2/wasm";
const modelUrl = (v: PoseModelVariant) =>
  `https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_${v}/float16/latest/pose_landmarker_${v}.task`;

type VideoWithFrameCallback = HTMLVideoElement & {
  requestVideoFrameCallback?: (cb: (now: number) => void) => number;
};

export function createMediaPipeSource(variant: PoseModelVariant = "lite"): PoseSource {
  let landmarker: PoseLandmarker | undefined;
  let stopped = false;

  return {
    async start(video, onResult) {
      if (!video) throw new Error("MediaPipe source needs a video element");
      stopped = false;
      const { FilesetResolver, PoseLandmarker } = await import("@mediapipe/tasks-vision");
      const fileset = await FilesetResolver.forVisionTasks(WASM_BASE);
      for (const delegate of ["GPU", "CPU"] as const) {
        try {
          landmarker = await PoseLandmarker.createFromOptions(fileset, {
            baseOptions: { modelAssetPath: modelUrl(variant), delegate },
            runningMode: "VIDEO",
            numPoses: 2,
          });
          break;
        } catch (e) {
          if (delegate === "CPU") throw e;
        }
      }
      const v = video as VideoWithFrameCallback;
      let last = -1;
      const loop = () => {
        if (stopped || !landmarker) return;
        if (video.readyState >= 2 && video.currentTime !== last) {
          last = video.currentTime;
          const t = performance.now();
          const result = landmarker.detectForVideo(video, t);
          const candidates = result.landmarks.flatMap((_, i) => poseResultToFrame(result, t, i) ?? []) as Frame[];
          onResult(candidates, t);
        }
        if (v.requestVideoFrameCallback) v.requestVideoFrameCallback(loop);
        else requestAnimationFrame(loop);
      };
      loop();
    },
    stop() {
      stopped = true;
      landmarker?.close();
      landmarker = undefined;
    },
  };
}
