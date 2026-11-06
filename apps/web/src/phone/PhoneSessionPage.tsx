import { type ExerciseSetup, type ProgramCommand, type ProgramState, deserializeProgram, serializeProgram } from "@gymspot/engine";
import type { SignedDelegation } from "@gymspot/shared";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import type { MemberProgram } from "../api/client";
import { RULE_PACKS } from "../rules";
import { useServices } from "../services";
import { LiveSession } from "../session/LiveSession";
import { ManualSession } from "../session/ManualSession";
import { SessionRunner } from "../session/runner";
import type { ShowCommand } from "../session/SessionView";
import { SetupWizard } from "../setup/SetupWizard";
import { HandoffPanel } from "./HandoffPanel";
import { ensureDelegation, phoneKeys } from "./phone-keys";

// The member's phone owns the session (specs/03): runs blocks itself or hands
// them to a station tablet by QR; state survives reloads (AC-3.5).

const packs = Object.fromEntries(Object.entries(RULE_PACKS).map(([k, v]) => [k, v.pack]));
const PROGRAM_KEY = "gymspot.member.program";
const SESSION_KEY = "gymspot.member.session";
const MANUAL_KEY = "gymspot.member.manualSession";
const TERMINAL = new Set(["SESSION_DONE", "ABORTED", "ABANDONED"]);

interface Loaded {
  program: MemberProgram;
  consent: boolean;
  keys: { secretKey: Uint8Array; publicKeyB64: string };
  delegation: SignedDelegation | null;
  restored: ProgramState | null;
}

export function PhoneSessionPage() {
  const { t } = useTranslation();
  const services = useServices();
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [error, setError] = useState<"signedOut" | "noProgram" | null>(null);

  useEffect(() => {
    if (!services.store.get("member")) return setError("signedOut");
    let cancelled = false;
    void (async () => {
      const { storage, api } = services;
      const { program, consent } = await (async () => {
        try {
          const fresh = await api.memberProgram();
          storage.setItem(PROGRAM_KEY, JSON.stringify(fresh));
          const camera = (await api.me()).cameraConsent;
          storage.setItem("gymspot.member.consent", String(camera));
          return { program: fresh, consent: camera };
        } catch {
          const cached = storage.getItem(PROGRAM_KEY); // offline: last known program
          return { program: cached ? (JSON.parse(cached) as MemberProgram) : null, consent: storage.getItem("gymspot.member.consent") === "true" };
        }
      })();
      if (cancelled) return;
      if (!program || program.days.length === 0) return setError("noProgram");
      const keys = await phoneKeys(storage);
      const delegation = await ensureDelegation(storage, api, keys.publicKeyB64, services.now());
      const restored = restoreSession(storage.getItem(SESSION_KEY));
      if (!cancelled) setLoaded({ program, consent, keys, delegation, restored });
    })();
    return () => {
      cancelled = true;
    };
  }, [services]);

  if (error === "signedOut") {
    return (
      <section data-screen="B1">
        <p role="alert">{t("phone.signedOut")}</p>
        <Link to="/member/login">{t("screens.B1")}</Link>
      </section>
    );
  }
  if (error === "noProgram") return <p role="alert">{t("phone.noProgram")}</p>;
  if (!loaded) return <p role="status">{t("phone.loading")}</p>;
  return <OwnerSession loaded={loaded} />;
}

/** Saved session state, unless missing, unreadable or already finished. */
function restoreSession(saved: string | null): ProgramState | null {
  if (!saved) return null;
  try {
    const s = deserializeProgram(saved);
    return TERMINAL.has(s.status) ? null : s;
  } catch {
    return null;
  }
}

function OwnerSession({ loaded }: { loaded: Loaded }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language === "en" ? "en" : "tr";
  const services = useServices();
  const sync = useMemo(() => services.createSync("member"), [services]);
  const handlers = useRef<{ speak(key: string): void; show(c: ShowCommand): void }>({ speak: () => undefined, show: () => undefined });
  const [setups, setSetups] = useState<Record<number, ExerciseSetup>>({});
  // camera-less for the rest of the session once chosen (no consent / no camera)
  const [manual, setManual] = useState(() => services.storage.getItem(MANUAL_KEY) === loaded.restored?.config.sessionId && !!loaded.restored);
  const { program } = loaded;
  const dayIndex = loaded.restored?.config.workoutDayIndex ?? program.nextDayIndex;
  const workout = program.days.find((d) => d.id.endsWith(`:${dayIndex}`)) ?? program.days[0]!;

  const runner = useMemo(
    () =>
      new SessionRunner(
        {
          packs: RULE_PACKS,
          program: {
            role: "owner",
            workout,
            sessionId: loaded.restored?.config.sessionId ?? services.newId(),
            memberId: loaded.delegation?.delegation.mid ?? "unknown",
            memberProgramId: program.memberProgramId,
            workoutDayIndex: dayIndex,
            deviceId: "phone",
            faults: Object.fromEntries(Object.entries(packs).map(([id, p]) => [id, p.faults])),
          },
          setup: { view: "front", nearSide: "left" },
          engine: { safetyPause: program.safetyPause ?? true },
          now: services.now,
          newId: services.newId,
          onCommand: (c: ProgramCommand) => {
            if (c.type === "SPEAK") handlers.current.speak(c.key);
            else if (c.type === "SHOW") handlers.current.show(c);
            else if (c.type === "PERSIST_EVENT") void sync.push(c.record);
          },
        },
        loaded.restored ?? undefined,
      ),
    [loaded, program, workout, dayIndex, services, sync],
  );
  const [state, setState] = useState(runner.state);
  useEffect(
    () =>
      runner.subscribe((s) => {
        setState(s);
        services.storage.setItem(SESSION_KEY, serializeProgram(s)); // AC-3.5
      }),
    [runner, services],
  );
  const bind = useCallback((h: typeof handlers.current) => void (handlers.current = h), []);

  const block = workout.blocks[state.cursor.blockIndex];
  const needsSetup = !manual && block && !setups[state.cursor.blockIndex] && !["IDLE", "TRANSFER", ...TERMINAL].includes(state.status);

  if (state.status === "IDLE") {
    return (
      <section data-screen="A4">
        <h1>{t("screens.A4")}</h1>
        <ol>
          {workout.blocks.map((b, i) => (
            <li key={i}>
              {packs[b.exerciseId]?.name[lang] ?? b.exerciseId} · {b.sets} × {b.reps ?? `${b.durationSec}s`}
              {b.stationHint && ` · ${b.stationHint}`}
            </li>
          ))}
        </ol>
        <button onClick={() => runner.act("START")}>{t("setup.start")}</button>
      </section>
    );
  }
  if (state.status === "TRANSFER") {
    return loaded.delegation ? (
      <HandoffPanel
        state={state}
        phoneSecretKey={loaded.keys.secretKey}
        delegation={loaded.delegation}
        onRunHere={() => runner.act("START")}
        onReturned={() => runner.returned()}
      />
    ) : (
      <section data-screen="A7">
        <h1>{t("screens.A7")}</h1>
        <p role="alert">{t("phone.noDelegation")}</p>
        <button onClick={() => runner.act("START")}>{t("phone.runHere")}</button>
      </section>
    );
  }
  if (TERMINAL.has(state.status)) {
    return (
      <section data-screen="A8">
        <h1>{t("session.done")}</h1>
        <Link to="/member">{t("app.home")}</Link>
      </section>
    );
  }
  if (needsSetup) {
    return (
      <PhoneSetup
        exerciseId={block.exerciseId}
        consent={loaded.consent}
        onReady={(s) => {
          runner.setSetup(s);
          setSetups((m) => ({ ...m, [state.cursor.blockIndex]: s }));
        }}
        onManualEntry={() => {
          services.storage.setItem(MANUAL_KEY, state.config.sessionId);
          setManual(true);
        }}
      />
    );
  }
  if (manual) return <ManualSession runner={runner} packs={packs} bindCommands={bind} />;
  return <LiveSession runner={runner} packs={packs} bindCommands={bind} />;
}

function PhoneSetup({ exerciseId, consent, onReady, onManualEntry }: { exerciseId: string; consent: boolean; onReady(s: ExerciseSetup): void; onManualEntry(): void }) {
  const services = useServices();
  const source = useMemo(() => services.createPoseSource(), [services]);
  return (
    <SetupWizard pack={packs[exerciseId]!} consent={consent} source={source} requestCamera={services.requestCamera} onReady={onReady} onManualEntry={onManualEntry} />
  );
}
