import { ExerciseEngine, type PersonTrack, chooseNearSide, detectView, dominantView, selectPerson } from "@gymspot/engine";
import type { Frame, LandmarkSequence, RepLabel, RepOutcome } from "@gymspot/shared";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { type CameraResult, requestCamera as defaultRequestCamera } from "../camera";
import type { PoseSource } from "../pose/source";
import { RULE_PACKS } from "../rules";

// C10 calibration recording — specs/07 "Kalibrasyon modu", specs/08 C10.
// Landmarks only (never images), staff only, separate versioned consent.
// Attempts are segmented by the engine afterwards and offered as label suggestions.

export const CALIBRATION_CONSENT_VERSION = "2026-11-v1";
const STAFF_ROLES = new Set(["manager", "owner"]);

export interface CalibrationConsent {
  participantRef: string;
  consentVersion: string;
  consentedAt: string;
}

export interface CalibrationSave {
  consent: CalibrationConsent;
  sequence: LandmarkSequence;
}

export interface CalibrationPageProps {
  role: "owner" | "manager" | "trainer";
  source: PoseSource;
  requestCamera?: () => Promise<CameraResult>;
  onSave(save: CalibrationSave): void;
  now?: () => number;
}

type Phase = "consent" | "recording" | "labeling";
interface Label {
  outcome: RepOutcome;
  faults: string[];
}

/** Keeps only coordinates and visibility (no other fields can ride along). */
const clean = (f: Frame): Frame => ({
  t: f.t,
  image: f.image.map(({ x, y, z, visibility }) => ({ x, y, z, visibility })),
  world: f.world.map(({ x, y, z, visibility }) => ({ x, y, z, visibility })),
});

export function CalibrationPage({ role, source, requestCamera = defaultRequestCamera, onSave, now = Date.now }: CalibrationPageProps) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language === "en" ? "en" : "tr";
  const videoRef = useRef<HTMLVideoElement>(null);
  const framesRef = useRef<Frame[]>([]);
  const streamRef = useRef<MediaStream | undefined>(undefined);
  const [phase, setPhase] = useState<Phase>("consent");
  const [participantRef, setParticipantRef] = useState("");
  const [consented, setConsented] = useState(false);
  const [consentedAt, setConsentedAt] = useState<string | null>(null);
  const [exerciseId, setExerciseId] = useState(Object.keys(RULE_PACKS)[0] ?? "squat");
  const [frameCount, setFrameCount] = useState(0);
  const [view, setView] = useState<"front" | "side">("front");
  const [labels, setLabels] = useState<Label[]>([]);
  const loaded = RULE_PACKS[exerciseId]!;
  // Callers may pass new function instances on every render; keep the latest
  // in refs so re-renders (one per recorded frame) never restart the camera.
  const deps = useRef({ source, requestCamera });
  deps.current = { source, requestCamera };

  useEffect(() => {
    if (phase !== "recording") return;
    let cancelled = false;
    let track: PersonTrack | undefined;
    framesRef.current = [];
    const { source, requestCamera } = deps.current;
    void (async () => {
      const cam = await requestCamera();
      if (cancelled || !cam.ok) return;
      streamRef.current = cam.stream;
      if (videoRef.current) {
        videoRef.current.srcObject = cam.stream;
        await videoRef.current.play?.()?.catch?.(() => undefined);
      }
      await source.start(videoRef.current, (candidates) => {
        const sel = selectPerson(candidates, track);
        track = sel.track;
        if (!sel.frame) return;
        const last = framesRef.current.at(-1);
        if (last && sel.frame.t <= last.t) return;
        framesRef.current.push(clean(sel.frame));
        setFrameCount(framesRef.current.length);
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [phase]);

  if (!STAFF_ROLES.has(role)) {
    return (
      <section data-screen="C10">
        <h1>{t("screens.C10")}</h1>
        <p role="alert">{t("calibration.staffOnly")}</p>
      </section>
    );
  }

  const start = () => {
    setConsentedAt(new Date(now()).toISOString());
    setPhase("recording");
  };

  const stop = () => {
    source.stop();
    streamRef.current?.getTracks?.().forEach((tr) => tr.stop());
    const frames = framesRef.current;
    const detected = dominantView(frames.map((f) => detectView(f)));
    const seqView = detected === "ambiguous" ? (loaded.pack.camera.views[0] ?? "front") : detected;
    const engine = new ExerciseEngine(loaded, { view: seqView, nearSide: chooseNearSide(frames.slice(0, 30)) }, { safetyPause: false });
    engine.setCuesEnabled(false);
    const suggestions: Label[] = [];
    for (const f of frames) {
      for (const e of engine.push(f)) if (e.type === "REP_COMPLETED") suggestions.push({ outcome: e.outcome, faults: [...e.faults] });
    }
    setView(seqView);
    setLabels(suggestions);
    setPhase("labeling");
  };

  const save = () => {
    const frames = framesRef.current;
    const span = frames.length > 1 ? frames.at(-1)!.t - frames[0]!.t : 0;
    const reps: RepLabel[] = labels.map((l) => ({ outcome: l.outcome, faults: loaded.pack.faults.map((f) => f.id).filter((id) => l.faults.includes(id)) }));
    onSave({
      consent: { participantRef: participantRef.trim(), consentVersion: CALIBRATION_CONSENT_VERSION, consentedAt: consentedAt! },
      sequence: {
        formatVersion: 1,
        exerciseId,
        source: "calibration",
        view,
        fps: span > 0 ? Math.round(((frames.length - 1) * 1000) / span) : 30,
        labels: { reps },
        frames,
      },
    });
  };

  const setLabel = (i: number, change: (l: Label) => Label) => setLabels((ls) => ls.map((l, j) => (j === i ? change(l) : l)));

  return (
    <section data-screen="C10">
      <h1>{t("screens.C10")}</h1>
      {phase === "consent" && (
        <>
          <label>
            {t("calibration.exercise")}
            <select value={exerciseId} onChange={(e) => setExerciseId(e.target.value)}>
              {Object.values(RULE_PACKS).map((p) => (
                <option key={p.pack.id} value={p.pack.id}>
                  {p.pack.name[lang]}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t("calibration.participantRef")}
            <input value={participantRef} onChange={(e) => setParticipantRef(e.target.value)} autoComplete="off" />
          </label>
          <p>{t("calibration.consentText")}</p>
          <label>
            <input type="checkbox" checked={consented} onChange={(e) => setConsented(e.target.checked)} />
            {t("calibration.consentCheckbox")}
          </label>
          <button disabled={!consented || participantRef.trim() === ""} onClick={start}>
            {t("calibration.start")}
          </button>
        </>
      )}
      {phase === "recording" && (
        <>
          <p role="status" className="recording-indicator">
            {t("calibration.recording")}
          </p>
          <video ref={videoRef} muted playsInline autoPlay className="camera-preview" />
          <p>{t("calibration.frames", { count: frameCount })}</p>
          <button onClick={stop}>{t("calibration.stop")}</button>
        </>
      )}
      {phase === "labeling" && (
        <>
          {labels.map((l, i) => (
            <fieldset key={i}>
              <legend>{t("calibration.rep", { n: i + 1 })}</legend>
              <label>
                {t("calibration.outcome")}
                <select value={l.outcome} onChange={(e) => setLabel(i, (x) => ({ ...x, outcome: e.target.value as RepOutcome }))}>
                  {(["valid", "faulty", "incomplete"] as const).map((o) => (
                    <option key={o} value={o}>
                      {t(`calibration.outcomes.${o}`)}
                    </option>
                  ))}
                </select>
              </label>
              {loaded.pack.faults.map((f) => (
                <label key={f.id}>
                  <input
                    type="checkbox"
                    checked={l.faults.includes(f.id)}
                    onChange={(e) =>
                      setLabel(i, (x) => ({ ...x, faults: e.target.checked ? [...x.faults, f.id] : x.faults.filter((id) => id !== f.id) }))
                    }
                  />
                  {f.name[lang]}
                </label>
              ))}
            </fieldset>
          ))}
          <button onClick={save}>{t("calibration.save")}</button>
        </>
      )}
    </section>
  );
}
