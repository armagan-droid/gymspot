import { type ExerciseSetup, type PersonTrack, type SetupAssessment, type SetupSample, assessSetup, selectPerson } from "@gymspot/engine";
import type { RulePack } from "@gymspot/shared";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { type CameraFailure, type CameraResult, requestCamera as defaultRequestCamera } from "../camera";
import type { PoseSource } from "../pose/source";

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
}

type Phase = { kind: "starting" } | { kind: "error"; reason: CameraFailure } | { kind: "running" };

export function SetupWizard({ pack, consent, source, requestCamera = defaultRequestCamera, onReady, onManualEntry }: SetupWizardProps) {
  const { t, i18n } = useTranslation();
  const videoRef = useRef<HTMLVideoElement>(null);
  const [phase, setPhase] = useState<Phase>({ kind: "starting" });
  const [assessment, setAssessment] = useState<SetupAssessment | null>(null);

  useEffect(() => {
    if (!consent) return;
    let cancelled = false;
    let stream: MediaStream | undefined;
    const samples: (SetupSample & { t: number })[] = [];
    let track: PersonTrack | undefined;

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
      await source.start(video, (candidates, now) => {
        const sel = selectPerson(candidates, track);
        track = sel.track;
        samples.push({ frame: sel.frame, ambiguous: sel.ambiguous, t: now });
        while (samples.length > 0 && now - samples[0]!.t > WINDOW_MS) samples.shift();
        setAssessment(assessSetup(samples, pack));
      });
    })();

    return () => {
      cancelled = true;
      source.stop();
      stream?.getTracks?.().forEach((tr) => tr.stop());
    };
  }, [consent, pack, source, requestCamera]);

  const lang = i18n.language === "en" ? "en" : "tr";

  if (!consent) {
    return (
      <section data-screen="A3">
        <h1>{t("screens.A3")}</h1>
        <p role="alert">{t("camera.consentRequired")}</p>
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
      <video ref={videoRef} muted playsInline autoPlay className="camera-preview" />
      {assessment && (
        <>
          <p className={assessment.ready ? "status-ready" : "status-wait"} role="status">
            {t(assessment.ready ? "setup.ready" : "setup.notReady")}
          </p>
          <p>
            {t("setup.viewLabel")}: <span>{t(`setup.view.${assessment.view}`)}</span>
          </p>
          {assessment.hints.length > 0 && (
            <ul className="hints">
              {assessment.hints.map((h) => (
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
