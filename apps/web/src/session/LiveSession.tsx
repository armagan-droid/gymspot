import { type ProgramState, chooseNearSide, faultLandmarks } from "@gymspot/engine";
import type { RulePack } from "@gymspot/shared";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useServices } from "../services";
import { LegalStrip } from "../components/Layouts";
import type { PoseModelVariant } from "../pose/mediapipe";
import { HeadTargetTracker, clearOverlay, paintOverlay, trackingGuide } from "../pose/overlay";
import { diagnosticsOn, poseModel, setDiagnosticsOn, setPoseModel } from "../pose/prefs";
import type { PoseSource } from "../pose/source";
import { DiagnosticsPanel, snapshotOf } from "./DiagnosticsPanel";
import { createCuePlayer } from "./audio";
import type { SessionRunner } from "./runner";
import { type ShowCommand, SessionView } from "./SessionView";

// Camera + pose source feeding a SessionRunner, with the session screens on top.
// The runner's commands reach this component through `bindCommands`.

/** How long the joints of a cued fault stay red (specs/08 A5). */
export const FAULT_HIGHLIGHT_MS = 2500;

export interface LiveSessionProps {
  runner: SessionRunner;
  packs: Readonly<Record<string, RulePack>>;
  /** The caller wires runner commands here (SPEAK/SHOW); PERSIST goes to the sync queue. */
  bindCommands(handlers: { speak(key: string): void; show(c: ShowCommand): void }): void;
  onState?(state: ProgramState): void;
  /** Right after camera setup: go straight into the spoken countdown (specs/08 A3). */
  autoStart?: boolean;
}

export function LiveSession({ runner, packs, bindCommands, onState, autoStart }: LiveSessionProps) {
  const { t, i18n } = useTranslation();
  const services = useServices();
  const videoRef = useRef<HTMLVideoElement>(null);
  const mutedRef = useRef(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // skeleton layer: on by default, switchable (specs/08 A5)
  const skeletonRef = useRef(true);
  const [skeleton, setSkeleton] = useState(true);
  const [muted, setMuted] = useState(false);
  // A5 diagnostics and pose model choice, remembered on this device (specs/08)
  const [diag, setDiag] = useState(diagnosticsOn);
  const [model, setModel] = useState<PoseModelVariant>(poseModel);
  const sourceRef = useRef<PoseSource | null>(null);
  const frameTimes = useRef<number[]>([]);
  const readDiagnostics = useCallback(() => {
    const ts = frameTimes.current;
    const fps = ts.length > 1 ? ((ts.length - 1) * 1000) / (ts.at(-1)! - ts[0]!) : 0;
    return snapshotOf(runner, fps, sourceRef.current?.stats?.());
  }, [runner]);
  const [lastShow, setLastShow] = useState<ShowCommand | null>(null);
  const [state, setState] = useState(runner.state);
  const rendered = useRef(state); // input can arrive before the effect subscribes
  rendered.current = state;
  const onStateRef = useRef(onState);
  onStateRef.current = onState;

  const speak = useMemo(
    () => createCuePlayer({ ...services.cueDeps(), packs, i18n, muted: () => mutedRef.current }),
    [services, packs, i18n],
  );
  // A5: joints of the cued fault turn red for a moment (specs/08)
  const highlight = useRef<{ joints: number[]; until: number }>({ joints: [], until: 0 });
  const show = useCallback(
    (c: ShowCommand) => {
      setLastShow(c);
      const [kind, exerciseId = "", faultId = ""] = c.key.split(".");
      const pack = packs[exerciseId];
      if (kind !== "cue" || !pack) return;
      const near = runner.lastFrame ? chooseNearSide([runner.lastFrame]) : "left";
      highlight.current = { joints: faultLandmarks(pack, faultId, near), until: performance.now() + FAULT_HIGHLIGHT_MS };
    },
    [packs, runner],
  );
  useEffect(() => bindCommands({ speak, show }), [bindCommands, speak, show]);
  // after bindCommands, so the first "three" is heard
  const autoStartRef = useRef(autoStart);
  useEffect(() => {
    if (autoStartRef.current && runner.state.status === "READY") runner.act("START");
  }, [runner]);
  useEffect(
    () =>
      runner.subscribe((s) => {
        setState(s);
        // the green "form fixed" belongs to that one countdown only
        if (s.status !== "COUNTDOWN") setLastShow((c) => (c?.key === "safety.resumed" ? null : c));
        onStateRef.current?.(s);
      }, rendered.current),
    [runner],
  );

  useEffect(() => {
    let stream: MediaStream | undefined;
    let lock: { release(): Promise<void> } | undefined;
    let cancelled = false;
    const source = services.createPoseSource();
    sourceRef.current = source;
    let headTarget: { exerciseId: string | undefined; tracker: HeadTargetTracker | null } | undefined;
    const timer = setInterval(() => runner.tick(), 250); // timers run without frames too
    void (async () => {
      const cam = await services.requestCamera();
      if (cancelled || !cam.ok) return;
      stream = cam.stream;
      const video = videoRef.current;
      if (video) {
        video.srcObject = stream;
        await video.play?.()?.catch?.(() => undefined);
      }
      lock = await (navigator as Navigator & { wakeLock?: { request(t: "screen"): Promise<{ release(): Promise<void> }> } }).wakeLock
        ?.request("screen")
        .catch(() => undefined);
      await source.start(video, (candidates, t) => {
        runner.pushCandidates(candidates, t);
        const ts = frameTimes.current;
        ts.push(t);
        while (ts.length > 1 && t - ts[0]! > 1000) ts.shift();
        const canvas = canvasRef.current;
        if (!canvas || !video) return;
        const block = runner.state.config.workout.blocks[runner.state.cursor.blockIndex];
        const pack = block && packs[block.exerciseId];
        // out of view: the setup drawing comes back, even with the skeleton off (specs/08 A5)
        if (pack && runner.trackingProblem) return paintOverlay(canvas, video, runner.lastFrame, trackingGuide(pack, runner.setup, runner.lastFrame));
        // head-movement drills: the target circle, even with the skeleton off (specs/08 A5)
        if (!headTarget || headTarget.exerciseId !== block?.exerciseId) headTarget = { exerciseId: block?.exerciseId, tracker: HeadTargetTracker.for(pack) };
        const target = headTarget.tracker?.update(runner.lastFrame, video.videoWidth / (video.videoHeight || 1));
        if (!skeletonRef.current) {
          if (!target) return clearOverlay(canvas);
          return paintOverlay(canvas, video, runner.lastFrame, { minVisibility: 0.5, headTarget: target, hideSkeleton: true });
        }
        const hi = highlight.current;
        const st = runner.state;
        // a safety pause keeps the joints of its fault red until the form is fixed (specs/08 A5)
        const safety =
          pack && st.status === "PAUSED" && st.pauseReason === "safety" && st.safetyFaultId && runner.lastFrame
            ? faultLandmarks(pack, st.safetyFaultId, chooseNearSide([runner.lastFrame]))
            : undefined;
        paintOverlay(canvas, video, runner.lastFrame, {
          minVisibility: pack?.camera.minVisibility ?? 0.5,
          highlight: safety ?? (performance.now() < hi.until ? hi.joints : undefined),
          headTarget: target,
        });
      });
    })();
    return () => {
      cancelled = true;
      clearInterval(timer);
      source.stop();
      stream?.getTracks?.().forEach((tr) => tr.stop());
      void lock?.release();
    };
  }, [runner, services, model]); // a new model restarts the camera pipeline

  const currentBlock = state.config.workout.blocks[state.cursor.blockIndex];
  const currentPack = currentBlock ? packs[currentBlock.exerciseId] : undefined;

  // red frame while the form is off, green while the set restarts (specs/08 A5)
  const stageAlert =
    state.status === "PAUSED" && state.pauseReason === "safety"
      ? "stage-danger"
      : state.status === "COUNTDOWN" && lastShow?.key === "safety.resumed"
        ? "stage-ok"
        : "";

  return (
    <div className="live-session camera-screen">
      <div className={`camera-stage${stageAlert ? ` ${stageAlert}` : ""}`}>
        <video ref={videoRef} muted playsInline autoPlay className="camera-preview" />
        <canvas ref={canvasRef} className="pose-overlay" aria-hidden="true" data-testid="pose-overlay" />
        <button
          className="skeleton-toggle"
          aria-pressed={skeleton}
          onClick={() => {
            skeletonRef.current = !skeletonRef.current;
            setSkeleton(skeletonRef.current);
          }}
        >
          {t(skeleton ? "session.skeletonOn" : "session.skeletonOff")}
        </button>
        <button
          className="diagnostics-toggle"
          aria-pressed={diag}
          onClick={() => {
            setDiagnosticsOn(!diag);
            setDiag(!diag);
          }}
        >
          {t("diagnostics.toggle")}
        </button>
        {diag && (
          <DiagnosticsPanel
            read={readDiagnostics}
            model={model}
            minVisibility={currentPack?.camera.minVisibility ?? 0.6}
            onModel={(m) => {
              setPoseModel(m);
              setModel(m);
            }}
          />
        )}
      </div>
      <div className="overlay-panel">
        <SessionView
          state={state}
          packs={packs}
          lastShow={lastShow}
          trackingProblem={runner.trackingProblem}
          muted={muted}
          onAction={(k) => runner.act(k)}
          onToggleMute={() => {
            mutedRef.current = !mutedRef.current;
            setMuted(mutedRef.current);
          }}
        />
        <LegalStrip />
      </div>
    </div>
  );
}
