import type { ProgramState } from "@gymspot/engine";
import type { RulePack } from "@gymspot/shared";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useServices } from "../services";
import { createCuePlayer } from "./audio";
import type { SessionRunner } from "./runner";
import { type ShowCommand, SessionView } from "./SessionView";

// A5-e: camera-less session (specs/08, specs/03 rule 14). The camera is never
// opened here; each set is logged by hand, rest and block flow stay the same.

export interface ManualSessionProps {
  runner: SessionRunner;
  packs: Readonly<Record<string, RulePack>>;
  bindCommands(handlers: { speak(key: string): void; show(c: ShowCommand): void }): void;
  onState?(state: ProgramState): void;
}

export function ManualSession({ runner, packs, bindCommands, onState }: ManualSessionProps) {
  const { t, i18n } = useTranslation();
  const services = useServices();
  const [state, setState] = useState(runner.state);
  const [lastShow, setLastShow] = useState<ShowCommand | null>(null);
  const onStateRef = useRef(onState);
  onStateRef.current = onState;
  const speak = useMemo(() => createCuePlayer({ ...services.cueDeps(), packs, i18n }), [services, packs, i18n]);
  useEffect(() => bindCommands({ speak, show: setLastShow }), [bindCommands, speak]);
  useEffect(
    () =>
      runner.subscribe((s) => {
        setState(s);
        onStateRef.current?.(s);
      }),
    [runner],
  );
  useEffect(() => {
    const h = setInterval(() => runner.tick(), 250); // rest countdown without camera frames
    return () => clearInterval(h);
  }, [runner]);

  const block = state.config.workout.blocks[state.cursor.blockIndex];
  const [reps, setReps] = useState<number>(block?.reps ?? 0);
  useEffect(() => setReps(block?.reps ?? 0), [block, state.cursor.setIndex]);

  if (state.status !== "READY" || !block) {
    return <SessionView state={state} packs={packs} lastShow={lastShow} muted={false} onAction={(k) => runner.act(k)} onToggleMute={() => undefined} />;
  }
  const lang = i18n.language === "en" ? "en" : "tr";
  return (
    <section data-screen="A5" className="manual-set">
      <h1>{packs[block.exerciseId]?.name[lang] ?? block.exerciseId}</h1>
      <p>{t("session.setLabel", { current: state.cursor.setIndex + 1, total: block.sets })}</p>
      <p>{t("manual.hint")}</p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          runner.manualSet(reps);
        }}
      >
        <label>
          {block.reps !== undefined ? t("manual.reps", { target: block.reps }) : t("manual.repsTimed")}
          <input type="number" min={0} max={500} value={reps} onChange={(e) => setReps(Math.max(0, Math.min(500, Number(e.target.value) || 0)))} />
        </label>
        <button type="submit">{t("manual.save")}</button>
      </form>
      <button onClick={() => runner.act("SKIP_BLOCK")}>{t("manual.skip")}</button>
    </section>
  );
}
