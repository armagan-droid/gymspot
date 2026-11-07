import type { ProgramState } from "@gymspot/engine";
import type { RulePack } from "@gymspot/shared";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useServices } from "../services";
import { createCuePlayer } from "./audio";
import type { SessionRunner } from "./runner";
import { type ShowCommand, SessionView } from "./SessionView";

// Camera + pose source feeding a SessionRunner, with the session screens on top.
// The runner's commands reach this component through `bindCommands`.

export interface LiveSessionProps {
  runner: SessionRunner;
  packs: Readonly<Record<string, RulePack>>;
  /** The caller wires runner commands here (SPEAK/SHOW); PERSIST goes to the sync queue. */
  bindCommands(handlers: { speak(key: string): void; show(c: ShowCommand): void }): void;
  onState?(state: ProgramState): void;
}

export function LiveSession({ runner, packs, bindCommands, onState }: LiveSessionProps) {
  const { i18n } = useTranslation();
  const services = useServices();
  const videoRef = useRef<HTMLVideoElement>(null);
  const mutedRef = useRef(false);
  const [muted, setMuted] = useState(false);
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
  useEffect(() => bindCommands({ speak, show: setLastShow }), [bindCommands, speak]);
  useEffect(
    () =>
      runner.subscribe((s) => {
        setState(s);
        onStateRef.current?.(s);
      }, rendered.current),
    [runner],
  );

  useEffect(() => {
    let stream: MediaStream | undefined;
    let lock: { release(): Promise<void> } | undefined;
    let cancelled = false;
    const source = services.createPoseSource();
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
      await source.start(video, (candidates, t) => runner.pushCandidates(candidates, t));
    })();
    return () => {
      cancelled = true;
      clearInterval(timer);
      source.stop();
      stream?.getTracks?.().forEach((tr) => tr.stop());
      void lock?.release();
    };
  }, [runner, services]);

  return (
    <div className="live-session">
      <video ref={videoRef} muted playsInline autoPlay className="camera-preview" />
      <SessionView
        state={state}
        packs={packs}
        lastShow={lastShow}
        muted={muted}
        onAction={(k) => runner.act(k)}
        onToggleMute={() => {
          mutedRef.current = !mutedRef.current;
          setMuted(mutedRef.current);
        }}
      />
    </div>
  );
}
