import type { ExerciseSetup } from "@gymspot/engine";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router";
import { requestCamera } from "../camera";
import { createMediaPipeSource } from "../pose/mediapipe";
import { RULE_PACKS, rulePack } from "../rules";
import { browserCueDeps, createCuePlayer } from "../session/audio";
import { SessionRunner } from "../session/runner";
import { type ShowCommand, SessionView } from "../session/SessionView";
import { SetupWizard } from "../setup/SetupWizard";

// Development-only harness: A3 setup, then a 3×10 set with the real camera,
// engine, program and spoken cues (`/spike/session?exercise=squat`).
// Records are only counted here; nothing leaves the device (API comes in T3.4).

const packsByExercise = Object.fromEntries(Object.entries(RULE_PACKS).map(([k, v]) => [k, v.pack]));

export function SessionSpikePage() {
  const [params] = useSearchParams();
  const id = params.get("exercise") ?? "squat";
  const [setup, setSetup] = useState<ExerciseSetup | null>(null);
  const setupSource = useMemo(() => createMediaPipeSource("lite"), []);
  if (!RULE_PACKS[id]) return <p role="alert">Unknown exercise: {id}</p>;
  if (!setup) {
    return (
      <SetupWizard
        pack={rulePack(id)}
        consent
        source={setupSource}
        onReady={(s) => {
          unlockAudio();
          setSetup(s);
        }}
        onManualEntry={() => undefined}
      />
    );
  }
  return <LiveSession exerciseId={id} setup={setup} />;
}

/** Audio must be started from a user gesture (specs/02 "Platform riskleri"). */
function unlockAudio() {
  try {
    void new AudioContext().resume();
    globalThis.speechSynthesis?.speak(new SpeechSynthesisUtterance(""));
  } catch {
    // no audio support: cues stay on screen
  }
}

function LiveSession({ exerciseId, setup }: { exerciseId: string; setup: ExerciseSetup }) {
  const { i18n } = useTranslation();
  const videoRef = useRef<HTMLVideoElement>(null);
  const mutedRef = useRef(false);
  const [muted, setMuted] = useState(false);
  const [lastShow, setLastShow] = useState<ShowCommand | null>(null);
  const [records, setRecords] = useState(0);

  const runner = useMemo(() => {
    const speak = createCuePlayer({ ...browserCueDeps(), packs: packsByExercise, i18n, muted: () => mutedRef.current });
    return new SessionRunner({
      packs: RULE_PACKS,
      program: {
        role: "owner",
        workout: { id: "spike", name: "Spike", blocks: [{ exerciseId, exerciseVersion: 1, sets: 3, reps: 10, restSec: 45, mode: "strict" }] },
        sessionId: crypto.randomUUID(),
        memberId: "spike",
        memberProgramId: "spike",
        workoutDayIndex: 0,
        deviceId: "spike",
        faults: { [exerciseId]: rulePack(exerciseId).faults },
      },
      setup,
      now: () => Date.now(),
      newId: () => crypto.randomUUID(),
      onCommand: (c) => {
        if (c.type === "SPEAK") speak(c.key);
        else if (c.type === "SHOW") setLastShow(c);
        else if (c.type === "PERSIST_EVENT") setRecords((n) => n + 1);
      },
    });
  }, [exerciseId, setup, i18n]);

  const [state, setState] = useState(runner.state);
  useEffect(() => runner.subscribe(setState), [runner]);

  useEffect(() => {
    let stream: MediaStream | undefined;
    let lock: { release(): Promise<void> } | undefined;
    const source = createMediaPipeSource("lite");
    const timer = setInterval(() => runner.tick(), 250); // timers keep running without frames
    void (async () => {
      const cam = await requestCamera();
      if (!cam.ok || !videoRef.current) return;
      stream = cam.stream;
      videoRef.current.srcObject = stream;
      await videoRef.current.play().catch(() => undefined);
      lock = await (navigator as Navigator & { wakeLock?: { request(t: "screen"): Promise<{ release(): Promise<void> }> } }).wakeLock
        ?.request("screen")
        .catch(() => undefined);
      await source.start(videoRef.current, (candidates, t) => runner.pushCandidates(candidates, t));
    })();
    runner.act("START");
    return () => {
      clearInterval(timer);
      source.stop();
      stream?.getTracks().forEach((tr) => tr.stop());
      void lock?.release();
    };
  }, [runner]);

  return (
    <main>
      <video ref={videoRef} muted playsInline autoPlay className="camera-preview" />
      <SessionView
        state={state}
        packs={packsByExercise}
        lastShow={lastShow}
        muted={muted}
        onAction={(k) => runner.act(k)}
        onToggleMute={() => {
          mutedRef.current = !mutedRef.current;
          setMuted(mutedRef.current);
        }}
      />
      <p>
        <small>records (not sent): {records}</small>
      </p>
    </main>
  );
}
