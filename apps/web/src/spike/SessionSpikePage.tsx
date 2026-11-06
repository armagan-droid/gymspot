import type { ExerciseSetup, ProgramCommand } from "@gymspot/engine";
import { useCallback, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router";
import { RULE_PACKS, rulePack } from "../rules";
import { useServices } from "../services";
import { LiveSession } from "../session/LiveSession";
import { SessionRunner } from "../session/runner";
import type { ShowCommand } from "../session/SessionView";
import { SetupWizard } from "../setup/SetupWizard";

// Development-only harness: A3 setup, then a 3×10 set with the real camera,
// engine, program and spoken cues (`/spike/session?exercise=squat`).
// Records are only counted here; nothing leaves the device.

const packs = Object.fromEntries(Object.entries(RULE_PACKS).map(([k, v]) => [k, v.pack]));

export function SessionSpikePage() {
  const [params] = useSearchParams();
  const id = params.get("exercise") ?? "squat";
  const services = useServices();
  const setupSource = useMemo(() => services.createPoseSource(), [services]);
  const [setup, setSetup] = useState<ExerciseSetup | null>(null);
  if (!RULE_PACKS[id]) return <p role="alert">Unknown exercise: {id}</p>;
  if (!setup) {
    return (
      <SetupWizard
        pack={rulePack(id)}
        consent
        source={setupSource}
        requestCamera={services.requestCamera}
        onReady={(s) => {
          unlockAudio();
          setSetup(s);
        }}
        onManualEntry={() => undefined}
      />
    );
  }
  return <SpikeSession exerciseId={id} setup={setup} />;
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

function SpikeSession({ exerciseId, setup }: { exerciseId: string; setup: ExerciseSetup }) {
  const services = useServices();
  const [records, setRecords] = useState(0);
  const handlers = useRef<{ speak(key: string): void; show(c: ShowCommand): void }>({ speak: () => undefined, show: () => undefined });
  const runner = useMemo(() => {
    const r = new SessionRunner({
      packs: RULE_PACKS,
      program: {
        role: "owner",
        workout: { id: "spike", name: "Spike", blocks: [{ exerciseId, exerciseVersion: 1, sets: 3, reps: 10, restSec: 45, mode: "strict" }] },
        sessionId: services.newId(),
        memberId: "spike",
        memberProgramId: "spike",
        workoutDayIndex: 0,
        deviceId: "spike",
        faults: { [exerciseId]: rulePack(exerciseId).faults },
      },
      setup,
      now: services.now,
      newId: services.newId,
      onCommand: (c: ProgramCommand) => {
        if (c.type === "SPEAK") handlers.current.speak(c.key);
        else if (c.type === "SHOW") handlers.current.show(c);
        else if (c.type === "PERSIST_EVENT") setRecords((n) => n + 1);
      },
    });
    r.act("START");
    return r;
  }, [exerciseId, setup, services]);
  const bind = useCallback((h: typeof handlers.current) => void (handlers.current = h), []);
  return (
    <main>
      <LiveSession runner={runner} packs={packs} bindCommands={bind} />
      <p>
        <small>records (not sent): {records}</small>
      </p>
    </main>
  );
}
