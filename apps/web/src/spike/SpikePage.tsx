import { createMetricComputer, detectView } from "@gymspot/engine";
import type { PoseLandmarker } from "@mediapipe/tasks-vision";
import { useEffect, useRef, useState } from "react";
import { poseResultToFrame } from "../pose/toFrame";
import { FpsMeter, SampleBuffer, type SpikeReport, meetsBudget } from "./measure";

// T2.2 spike (development only): MediaPipe Pose on the device camera.
// Frames stay in memory; nothing is uploaded or stored (specs/07).
// Developer tool → English-only UI, not part of the product screens (specs/08).

type Variant = "lite" | "full" | "heavy";
const WASM_BASE = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.2.2/wasm";
const modelUrl = (v: Variant) =>
  `https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_${v}/float16/latest/pose_landmarker_${v}.task`;

const knee = createMetricComputer({
  world: { angle: ["near_hip", "near_knee", "near_ankle"] },
});

function imageKneeAngle(f: NonNullable<ReturnType<typeof poseResultToFrame>>): number {
  const [h, k, a] = [23, 25, 27].map((i) => f.image[i]!);
  const u = { x: h!.x - k!.x, y: h!.y - k!.y };
  const v = { x: a!.x - k!.x, y: a!.y - k!.y };
  const c = (u.x * v.x + u.y * v.y) / (Math.hypot(u.x, u.y) * Math.hypot(v.x, v.y));
  return (Math.acos(Math.max(-1, Math.min(1, c))) * 180) / Math.PI;
}

async function createLandmarker(variant: Variant): Promise<{ landmarker: PoseLandmarker; delegate: string }> {
  const { FilesetResolver, PoseLandmarker } = await import("@mediapipe/tasks-vision");
  const fileset = await FilesetResolver.forVisionTasks(WASM_BASE);
  for (const delegate of ["GPU", "CPU"] as const) {
    try {
      const landmarker = await PoseLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: modelUrl(variant), delegate },
        runningMode: "VIDEO",
        numPoses: 1,
      });
      return { landmarker, delegate };
    } catch (e) {
      if (delegate === "CPU") throw e;
    }
  }
  throw new Error("unreachable");
}

export function SpikePage() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [variant, setVariant] = useState<Variant>("lite");
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<SpikeReport | null>(null);
  const [live, setLive] = useState({ fps: 0, inference: 0, world: NaN, image: NaN, view: "-" });
  const [wakeLock, setWakeLock] = useState<SpikeReport["wakeLock"]>("off");
  const [audio, setAudio] = useState<SpikeReport["audio"]>("untested");

  useEffect(() => {
    if (!running) return;
    let stop = false;
    let stream: MediaStream | undefined;
    let landmarker: PoseLandmarker | undefined;
    let lock: { release(): Promise<void> } | undefined;
    const fps = new FpsMeter();
    const inference = new SampleBuffer();
    const latency = new SampleBuffer();
    const gap = new SampleBuffer();

    (async () => {
      try {
        const created = await createLandmarker(variant);
        landmarker = created.landmarker;
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment", width: 1280, height: 720 }, audio: false });
        const video = videoRef.current!;
        video.srcObject = stream;
        await video.play();
        try {
          lock = await (navigator as Navigator & { wakeLock?: { request(t: "screen"): Promise<{ release(): Promise<void> }> } }).wakeLock?.request("screen");
          setWakeLock(lock ? "active" : "unsupported");
        } catch {
          setWakeLock("denied");
        }

        let last = 0;
        const onFrame = (now: number, meta?: { captureTime?: number }) => {
          if (stop || !landmarker) return;
          if (now !== last) {
            last = now;
            const t0 = performance.now();
            const result = landmarker.detectForVideo(video, t0);
            const t1 = performance.now();
            fps.tick(t1);
            inference.add(t1 - t0);
            if (meta?.captureTime) latency.add(t1 - meta.captureTime);
            const frame = poseResultToFrame(result, t1);
            if (frame) {
              const w = knee.compute(frame, "left").world!;
              const i = imageKneeAngle(frame);
              gap.add(Math.abs(w - i));
              setLive({ fps: fps.fps, inference: t1 - t0, world: w, image: i, view: detectView(frame) });
            }
            const lat = latency.samples.length > 0 ? latency.stats() : null;
            setReport({
              device: {
                userAgent: navigator.userAgent,
                cores: navigator.hardwareConcurrency ?? null,
                screen: `${screen.width}x${screen.height}@${devicePixelRatio}`,
                standalone: matchMedia("(display-mode: standalone)").matches,
              },
              model: variant,
              delegate: created.delegate,
              fps: Math.round(fps.fps * 10) / 10,
              inferenceMs: inference.stats(),
              latencyMs: lat,
              kneeAngleGapDeg: gap.stats(),
              wakeLock: lock ? "active" : "unsupported",
              audio,
              meetsBudget: meetsBudget(fps.fps, (lat ?? inference.stats()).p95),
            });
          }
          const v = video as HTMLVideoElement & { requestVideoFrameCallback?: (cb: (n: number, m: { captureTime?: number }) => void) => void };
          if (v.requestVideoFrameCallback) v.requestVideoFrameCallback(onFrame);
          else requestAnimationFrame((n) => onFrame(n));
        };
        onFrame(performance.now());
      } catch (e) {
        setError(String(e));
        setRunning(false);
      }
    })();

    return () => {
      stop = true;
      stream?.getTracks().forEach((tr) => tr.stop());
      landmarker?.close();
      void lock?.release();
    };
  }, [running, variant, audio]);

  const testAudio = async () => {
    try {
      const ctx = new AudioContext();
      const osc = ctx.createOscillator();
      osc.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.15);
      speechSynthesis.speak(new SpeechSynthesisUtterance("Test"));
      setAudio(ctx.state === "running" ? "unlocked" : "locked");
    } catch {
      setAudio("locked");
    }
  };

  return (
    <main data-screen="spike">
      <h1>Pose spike (T2.2)</h1>
      <p>Frames are processed on this device only. Nothing is uploaded or stored.</p>
      <label>
        Model{" "}
        <select value={variant} onChange={(e) => setVariant(e.target.value as Variant)} disabled={running}>
          <option value="lite">lite</option>
          <option value="full">full</option>
          <option value="heavy">heavy</option>
        </select>
      </label>
      <button onClick={() => setRunning((r) => !r)}>{running ? "Stop" : "Start camera"}</button>
      <button onClick={() => void testAudio()}>Test audio</button>
      {error && <p role="alert">{error}</p>}
      <video ref={videoRef} muted playsInline style={{ width: "100%", maxHeight: "50vh" }} />
      <dl>
        <dt>FPS</dt>
        <dd>{live.fps.toFixed(1)}</dd>
        <dt>Inference (ms)</dt>
        <dd>{live.inference.toFixed(1)}</dd>
        <dt>Knee angle world / image</dt>
        <dd>
          {live.world.toFixed(0)}° / {live.image.toFixed(0)}°
        </dd>
        <dt>View</dt>
        <dd>{live.view}</dd>
        <dt>Wake lock / audio</dt>
        <dd>
          {wakeLock} / {audio}
        </dd>
      </dl>
      {report && (
        <>
          <button onClick={() => void navigator.clipboard.writeText(JSON.stringify(report, null, 2))}>Copy report JSON</button>
          <pre>{JSON.stringify(report, null, 2)}</pre>
        </>
      )}
    </main>
  );
}
