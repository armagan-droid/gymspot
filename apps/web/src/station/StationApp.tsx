import type { ExerciseSetup, ProgramCommand } from "@gymspot/engine";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { DeviceCredentials } from "../api/client";
import { RULE_PACKS } from "../rules";
import { useServices } from "../services";
import { LiveSession } from "../session/LiveSession";
import { SessionRunner } from "../session/runner";
import type { ShowCommand } from "../session/SessionView";
import { SetupWizard } from "../setup/SetupWizard";
import { type CheckinResult, OfflineCheckins, checkIn } from "./checkin";

// Station tablet (specs/08 A1–A9): pair → wait for a member's QR → camera
// setup → run the delegated block → "continue on your phone" → wait again.

type CheckedIn = Extract<CheckinResult, { ok: true }>;
type Phase =
  | { kind: "pair" }
  | { kind: "scan"; message?: string }
  | { kind: "noConsent" }
  | { kind: "setup"; checkin: CheckedIn }
  | { kind: "session"; checkin: CheckedIn; setup: ExerciseSetup }
  | { kind: "return" };

const packs = Object.fromEntries(Object.entries(RULE_PACKS).map(([k, v]) => [k, v.pack]));

export function StationApp({ returnDelayMs = 5000 }: { returnDelayMs?: number }) {
  const { t } = useTranslation();
  const services = useServices();
  const offline = useMemo(() => new OfflineCheckins(services.storage), [services]);
  const [phase, setPhase] = useState<Phase>(() => ({ kind: services.store.get<DeviceCredentials>("device") ? "scan" : "pair" }));

  // keep the tenant QR key fresh and redeem offline check-ins whenever online
  useEffect(() => {
    if (phase.kind !== "scan" || !services.online()) return;
    void services.api
      .qrPublicKey()
      .then((k) => (offline.tenantKey = k))
      .catch(() => undefined);
    void offline.flush((qr) => services.api.redeemQr(qr));
  }, [phase.kind, services, offline]);

  useEffect(() => {
    if (phase.kind !== "return" && phase.kind !== "noConsent") return;
    const h = setTimeout(() => setPhase({ kind: "scan" }), returnDelayMs);
    return () => clearTimeout(h);
  }, [phase.kind, returnDelayMs]);

  const onCode = useCallback(
    async (qr: string) => {
      const r = await checkIn(qr, { api: services.api, offline, now: services.now, online: services.online });
      if (!r.ok) return setPhase({ kind: "scan", message: t(`station.checkin.${r.reason}`) });
      if (!RULE_PACKS[r.block.exerciseId]) return setPhase({ kind: "scan", message: t("station.checkin.invalid") });
      setPhase(r.cameraConsent ? { kind: "setup", checkin: r } : { kind: "noConsent" });
    },
    [services, offline, t],
  );

  switch (phase.kind) {
    case "pair":
      return <PairScreen onPaired={() => setPhase({ kind: "scan" })} />;
    case "scan":
      return <ScanScreen message={phase.message} onCode={onCode} />;
    case "noConsent":
      return (
        <section data-screen="A9">
          <h1>{t("screens.A9")}</h1>
          <p role="alert">{t("station.noConsent")}</p>
        </section>
      );
    case "setup":
      return (
        <StationSetup
          exerciseId={phase.checkin.block.exerciseId}
          onReady={(setup) => setPhase({ kind: "session", checkin: phase.checkin, setup })}
          onCancel={() => setPhase({ kind: "scan" })}
        />
      );
    case "session":
      return <ExecutorSession checkin={phase.checkin} setup={phase.setup} onDone={() => setPhase({ kind: "return" })} />;
    case "return":
      return (
        <section data-screen="A8">
          <h1>{t("handoff.return_to_phone")}</h1>
        </section>
      );
  }
}

function StationSetup({ exerciseId, onReady, onCancel }: { exerciseId: string; onReady(s: ExerciseSetup): void; onCancel(): void }) {
  const services = useServices();
  const source = useMemo(() => services.createPoseSource(), [services]);
  // consent was checked from the server-signed certificate (AC-7.4)
  return <SetupWizard pack={packs[exerciseId]!} consent source={source} requestCamera={services.requestCamera} onReady={onReady} onManualEntry={onCancel} />;
}

function PairScreen({ onPaired }: { onPaired(): void }) {
  const { t } = useTranslation();
  const { api } = useServices();
  const [code, setCode] = useState("");
  const [error, setError] = useState(false);
  return (
    <section data-screen="A1">
      <h1>{t("screens.A1")}</h1>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          try {
            await api.pairDevice(code.trim());
            onPaired();
          } catch {
            setError(true);
          }
        }}
      >
        <label>
          {t("station.pairCode")}
          <input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} autoComplete="off" maxLength={16} />
        </label>
        <button type="submit" disabled={code.trim().length < 4}>
          {t("station.pair")}
        </button>
      </form>
      {error && <p role="alert">{t("station.pairFailed")}</p>}
    </section>
  );
}

function ScanScreen({ message, onCode }: { message?: string; onCode(qr: string): void }) {
  const { t } = useTranslation();
  const services = useServices();
  const videoRef = useRef<HTMLVideoElement>(null);
  const onCodeRef = useRef(onCode);
  onCodeRef.current = onCode;

  useEffect(() => {
    let stream: MediaStream | undefined;
    let cancelled = false;
    const scanner = services.createScanner();
    void (async () => {
      const cam = await services.requestCamera();
      if (cancelled || !cam.ok) return;
      stream = cam.stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play?.()?.catch?.(() => undefined);
      }
      scanner.start(videoRef.current, (text) => onCodeRef.current(text));
    })();
    return () => {
      cancelled = true;
      scanner.stop();
      stream?.getTracks?.().forEach((tr) => tr.stop());
    };
  }, [services]);

  return (
    <section data-screen="A2">
      <h1>{t("screens.A2")}</h1>
      <video ref={videoRef} muted playsInline autoPlay className="camera-preview" />
      {!services.online() && <p role="status">{t("station.offline")}</p>}
      {message && <p role="alert">{message}</p>}
    </section>
  );
}

/** Runs the delegated block as the program engine's executor (specs/03). */
function ExecutorSession({ checkin, setup, onDone }: { checkin: CheckedIn; setup: ExerciseSetup; onDone(): void }) {
  const services = useServices();
  const sync = useMemo(() => services.createSync("device"), [services]);
  const handlers = useRef<{ speak(key: string): void; show(c: ShowCommand): void }>({ speak: () => undefined, show: () => undefined });
  const device = services.store.get<DeviceCredentials>("device");

  const runner = useMemo(() => {
    const blocks = Array.from({ length: checkin.cursor.blockIndex + 1 }, () => checkin.block);
    const r = new SessionRunner({
      packs: RULE_PACKS,
      program: {
        role: "executor",
        workout: { id: `handoff:${checkin.cursor.sessionId}`, name: "handoff", blocks },
        sessionId: checkin.cursor.sessionId,
        memberId: checkin.memberId,
        memberProgramId: "handoff",
        workoutDayIndex: 0,
        deviceId: device?.deviceId ?? "station",
        ...(device?.stationId && { stationId: device.stationId }),
      },
      setup,
      now: services.now,
      newId: services.newId,
      onCommand: (c: ProgramCommand) => {
        if (c.type === "SPEAK") handlers.current.speak(c.key);
        else if (c.type === "SHOW") handlers.current.show(c);
        else if (c.type === "PERSIST_EVENT") void sync.push(c.record);
      },
    });
    r.accept(checkin.cursor);
    return r;
  }, [checkin, setup, services, sync, device?.deviceId, device?.stationId]);

  const bind = useCallback((h: typeof handlers.current) => void (handlers.current = h), []);
  return <LiveSession runner={runner} packs={packs} bindCommands={bind} onState={(s) => s.status === "IDLE" && onDone()} />;
}
