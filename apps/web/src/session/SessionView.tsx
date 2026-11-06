import type { ProgramCommand, ProgramState } from "@gymspot/engine";
import type { RulePack, UserActionKind } from "@gymspot/shared";
import { useTranslation } from "react-i18next";

// Session screens driven by the program state (specs/08): READY, countdown,
// A5 active set (+ "set done?"), A6 rest, paused. A4/A7/A8 in full come with T4.1.

export type ShowCommand = Extract<ProgramCommand, { type: "SHOW" }>;

export interface SessionViewProps {
  state: ProgramState;
  packs: Readonly<Record<string, RulePack>>;
  /** Most recent SHOW command (cue, prompt, summary, safety). */
  lastShow: ShowCommand | null;
  muted: boolean;
  onAction(kind: UserActionKind): void;
  onToggleMute(): void;
}

const secondsLeft = (until: number | undefined, now: number) => Math.max(0, Math.ceil(((until ?? now) - now) / 1000));

export function SessionView({ state, packs, lastShow, muted, onAction, onToggleMute }: SessionViewProps) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language === "en" ? "en" : "tr";
  const block = state.config.workout.blocks[state.cursor.blockIndex];
  const pack = block ? packs[block.exerciseId] : undefined;
  const exerciseName = pack?.name[lang] ?? block?.exerciseId ?? "";
  const setLabel = block ? t("session.setLabel", { current: Math.min(state.cursor.setIndex + 1, block.sets), total: block.sets }) : "";

  const cueText = (() => {
    if (!lastShow?.key.startsWith("cue.")) return null;
    const [, ex = "", fault = ""] = lastShow.key.split(".");
    return packs[ex]?.faults.find((f) => f.id === fault)?.cue[lang] ?? null;
  })();

  switch (state.status) {
    case "READY":
      return (
        <section data-screen="A4">
          <h1>{exerciseName}</h1>
          <p>{setLabel}</p>
          <p>{t("session.readyHint")}</p>
          <button onClick={() => onAction("START")}>{t("setup.start")}</button>
        </section>
      );
    case "COUNTDOWN":
      return (
        <section data-screen="A5" className="countdown">
          <h1>{exerciseName}</h1>
          <p className="rep-counter" aria-live="assertive">
            {secondsLeft(state.countdownEndsAt, state.now)}
          </p>
          <p>{t("countdown.start")}</p>
        </section>
      );
    case "SET_ACTIVE":
    case "SET_CONFIRM": {
      const target = block?.reps;
      return (
        <section data-screen="A5" className="active-set">
          <h1>{exerciseName}</h1>
          <p className="rep-counter" aria-label={t("session.repsLabel")} aria-live="polite">
            {state.set?.counted ?? 0}
            {target !== undefined && <span className="rep-target"> / {target}</span>}
          </p>
          <p>{setLabel}</p>
          <p className="cue-band" role="status" aria-live="assertive">
            {cueText ?? " "}
          </p>
          {state.status === "SET_CONFIRM" && (
            <div role="dialog" aria-label={t("prompt.set_done")}>
              <p>{t("prompt.set_done")}</p>
              <button onClick={() => onAction("CONTINUE_SET")}>{t("session.continue")}</button>
              <button onClick={() => onAction("END_SET")}>{t("session.endSet")}</button>
            </div>
          )}
          <div className="controls">
            <button onClick={onToggleMute} aria-pressed={muted}>
              {t(muted ? "session.soundOff" : "session.soundOn")}
            </button>
            <button onClick={() => onAction("PAUSE")}>{t("session.pause")}</button>
            <button onClick={() => onAction("END_SET")}>{t("session.endSet")}</button>
          </div>
        </section>
      );
    }
    case "REST": {
      const summary = lastShow?.key === "summary.set" ? lastShow.params : undefined;
      return (
        <section data-screen="A6">
          <h1>{t("screens.A6")}</h1>
          <p className="rep-counter" aria-live="polite">
            {secondsLeft(state.restEndsAt, state.now)}
          </p>
          {summary && <p>{t("summary.set", summary)}</p>}
          <p>
            {exerciseName} · {setLabel}
          </p>
          <button onClick={() => onAction("READY")}>{t("session.readyNow")}</button>
        </section>
      );
    }
    case "PAUSED":
      return (
        <section data-screen="A5" className="paused">
          <h1>{t("session.paused")}</h1>
          {lastShow?.key === "safety.stop" && <p role="alert">{t("safety.stop")}</p>}
          <button onClick={() => onAction("RESUME")}>{t("session.resume")}</button>
        </section>
      );
    case "TRANSFER":
      return (
        <section data-screen="A7">
          <h1>{t("screens.A7")}</h1>
          <p>{block?.stationHint}</p>
        </section>
      );
    case "SESSION_DONE":
      return (
        <section data-screen="A8">
          <h1>{t("session.done")}</h1>
        </section>
      );
    default:
      return (
        <section data-screen="A2">
          <h1>{t("screens.A2")}</h1>
        </section>
      );
  }
}
