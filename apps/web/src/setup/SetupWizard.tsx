import { type ExerciseSetup, type PersonTrack, SETUP_CHECKS, type SetupAssessment, type SetupSample, assessSetup, selectPerson } from "@gymspot/engine";
import type { RulePack } from "@gymspot/shared";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { type CameraFailure, type CameraResult, requestCamera as defaultRequestCamera } from "../camera";
import { paintOverlay } from "../pose/overlay";
import type { PoseSource } from "../pose/source";
import { createSetupVoice } from "./voice";

// A3 camera setup (specs/08): consent gate (AC-7.4), camera errors with manual
// entry (AC-8.3), live checks over the last second, start only when ready (AC-8.5).

const WINDOW_MS = 1000;

export interface SetupWizardProps {
  pack: RulePack;
  /** Member's camera consent (specs/07). Without it the camera is never requested. */
  consent: boolean;
  source: PoseSource;
  requestCamera?: () => Promise<CameraResult>;
  onReady(setup: ExerciseSetup): void;
  onManualEntry(): void;
  /** Speaks a message key (cue player); hints are read out (specs/08 A3). */
  speak?(key: string): void;
}

type Phase = { kind: "starting" } | { kind: "error"; reason: CameraFailure } | { kind: "running" };

/** A floor exercise filmed in portrait: ask to turn the phone first (specs/08 A3). */
function withRotateHint(a: SetupAssessment, pack: RulePack, video: HTMLVideoElement | null): SetupAssessment {
  const portrait = !!video && video.videoHeight > video.videoWidth;
  if (a.ready || pack.camera.posture !== "horizontal" || !portrait) return a;
  return { ...a, hints: ["setup.hint.rotate_phone" as SetupAssessment["hints"][number], ...a.hints] };
}

export function SetupWizard({ pack, consent, source, requestCamera = defaultRequestCamera, onReady, onManualEntry, speak }: SetupWizardProps) {
  const { t, i18n } = useTranslation();
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [phase, setPhase] = useState<Phase>({ kind: "starting" });
  const [assessment, setAssessment] = useState<SetupAssessment | null>(null);
  // Latest callbacks without restarting the camera on every render.
  const deps = useRef({ source, requestCamera, pack, speak });
  deps.current = { source, requestCamera, pack, speak };

  useEffect(() => {
    if (!consent) return;
    const { source, requestCamera } = deps.current;
    let cancelled = false;
    let stream: MediaStream | undefined;
    const samples: (SetupSample & { t: number })[] = [];
    let track: PersonTrack | undefined;
    const voice = createSetupVoice((key) => deps.current.speak?.(key));

    void (async () => {
      const cam = await requestCamera();
      if (cancelled) return;
      if (!cam.ok) return setPhase({ kind: "error", reason: cam.reason });
      stream = cam.stream;
      const video = videoRef.current;
      if (video) {
        video.srcObject = stream;
        try {
          await video.play?.();
        } catch {
          // autoplay may need a gesture; the stream still feeds the pose model
        }
      }
      setPhase({ kind: "running" });
      // guidance before the pose model has loaded (it can take seconds on a phone)
      const paintIdle = () =>
        canvasRef.current &&
        video &&
        paintOverlay(canvasRef.current, video, null, {
          minVisibility: 1,
          guide: { margin: SETUP_CHECKS.edgeMargin, ready: false },
          target: deps.current.pack.camera.posture,
        });
      video?.addEventListener?.("loadedmetadata", paintIdle);
      paintIdle();
      await source.start(video, (candidates, now) => {
        const sel = selectPerson(candidates, track);
        track = sel.track;
        samples.push({ frame: sel.frame, ambiguous: sel.ambiguous, t: now });
        while (samples.length > 0 && now - samples[0]!.t > WINDOW_MS) samples.shift();
        const a = withRotateHint(assessSetup(samples, deps.current.pack), deps.current.pack, video);
        setAssessment(a);
        voice(a, now);
        if (canvasRef.current && video) {
          paintOverlay(canvasRef.current, video, sel.frame, {
            minVisibility: deps.current.pack.camera.minVisibility,
            required: a.requiredLandmarks,
            guide: { margin: SETUP_CHECKS.edgeMargin, ready: a.ready },
            target: deps.current.pack.camera.posture,
            edges: a.edges,
          });
        }
      });
    })();

    return () => {
      cancelled = true;
      source.stop();
      stream?.getTracks?.().forEach((tr) => tr.stop());
    };
  }, [consent]);

  const lang = i18n.language === "en" ? "en" : "tr";

  if (!consent) {
    return (
      <section data-screen="A3">
        <h1>{t("screens.A3")}</h1>
        <p role="alert">{t("camera.consentRequired")}</p>
        <button onClick={onManualEntry}>{t("camera.manualEntry")}</button>
      </section>
    );
  }

  if (phase.kind === "error") {
    return (
      <section data-screen="A9">
        <h1>{t("screens.A9")}</h1>
        <p role="alert">{t(`camera.${phase.reason}`)}</p>
        <button onClick={onManualEntry}>{t("camera.manualEntry")}</button>
      </section>
    );
  }

  const active = new Set(assessment?.activeFaults ?? []);
  return (
    <section data-screen="A3">
      <h1>{t("screens.A3")}</h1>
      <p>{pack.camera.setupHint[lang]}</p>
      <div className="camera-stage">
        <video ref={videoRef} muted playsInline autoPlay className="camera-preview" />
        <canvas ref={canvasRef} className="pose-overlay" aria-hidden="true" data-testid="pose-overlay" />
        {assessment && (
          // large enough to read from the exercise spot (specs/08 A3 görsel yönlendirme)
          <p className={`setup-banner ${assessment.ready ? "status-ready" : "status-wait"}`} role="status">
            {t(assessment.ready ? "setup.ready" : (assessment.hints[0] ?? "setup.notReady"))}
          </p>
        )}
        {!assessment && phase.kind === "running" && (
          <p className="setup-banner status-wait" role="status">
            {t("setup.notReady")}
          </p>
        )}
      </div>
      {assessment && (
        <>
          <p>
            {t("setup.viewLabel")}: <span>{t(`setup.view.${assessment.view}`)}</span>
          </p>
          {assessment.hints.length > 1 && (
            <ul className="hints">
              {assessment.hints.slice(1).map((h) => (
                <li key={h}>{t(h)}</li>
              ))}
            </ul>
          )}
          <h2>{t("setup.activeChecks")}</h2>
          <ul>
            {pack.faults
              .filter((f) => active.has(f.id))
              .map((f) => (
                <li key={f.id}>{f.name[lang]}</li>
              ))}
          </ul>
        </>
      )}
      <button
        disabled={!assessment?.ready}
        onClick={() => assessment && onReady({ view: assessment.view, nearSide: assessment.nearSide })}
      >
        {t("setup.start")}
      </button>
    </section>
  );
}
