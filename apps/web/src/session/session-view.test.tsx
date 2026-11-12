import { PROGRAM_TIMING, type ProgramState, createProgram, step } from "@gymspot/engine";
import type { ProgramInput } from "@gymspot/shared";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { afterEach, describe, expect, test, vi } from "vitest";
import { createI18n } from "../i18n";
import { rulePack } from "../rules";
import type { TrackingProblem } from "./runner";
import { type ShowCommand, SessionView } from "./SessionView";

afterEach(cleanup);

const T0 = Date.UTC(2026, 10, 6, 9);
const packs = { squat: rulePack("squat") };

/** Drives the real program engine to the wanted state. */
function stateAfter(inputs: ProgramInput[]): ProgramState {
  let s = createProgram(
    {
      role: "owner",
      workout: { id: "w", name: "A", blocks: [{ exerciseId: "squat", exerciseVersion: 1, sets: 3, reps: 10, restSec: 60, mode: "strict" }] },
      sessionId: "11111111-1111-4111-8111-111111111111",
      memberId: "m",
      memberProgramId: "p",
      workoutDayIndex: 0,
      deviceId: "d",
    },
    T0,
  );
  let n = 0;
  for (const i of inputs) s = step(s, i, { newId: () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}` }).state;
  return s;
}

const ua = (kind: string) => ({ type: "USER_ACTION", kind }) as ProgramInput;
const rep = { type: "REP_COMPLETED", outcome: "valid", faults: [], durationMs: 1500 } as ProgramInput;
const toActive: ProgramInput[] = [ua("START"), ua("START"), { type: "TICK", now: T0 + PROGRAM_TIMING.countdownMs }];

function show(state: ProgramState, lastShow: ShowCommand | null = null, muted = false, trackingProblem: TrackingProblem | null = null) {
  const onAction = vi.fn();
  const onToggleMute = vi.fn();
  render(
    <I18nextProvider i18n={createI18n("tr")}>
      <SessionView
        state={state}
        packs={packs}
        lastShow={lastShow}
        muted={muted}
        onAction={onAction}
        onToggleMute={onToggleMute}
        trackingProblem={trackingProblem}
      />
    </I18nextProvider>,
  );
  return { onAction, onToggleMute };
}

describe("A5 active set", () => {
  test("big counter with target, set label and exercise name", () => {
    show(stateAfter([...toActive, rep, rep]));
    expect(document.querySelector(".rep-counter")!.textContent).toBe("2 / 10");
    expect(screen.getByText("Set 1 / 3")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Squat" })).toBeTruthy();
  });

  test("the cue band shows the cue text from the rule pack", () => {
    show(stateAfter(toActive), { type: "SHOW", key: "cue.squat.knee_valgus" });
    expect(screen.getByRole("status").textContent).toBe("Dizlerini dışarı aç");
  });

  test("sound, pause and end-set controls", () => {
    const { onAction, onToggleMute } = show(stateAfter(toActive));
    fireEvent.click(screen.getByRole("button", { name: "Ses açık" }));
    expect(onToggleMute).toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Duraklat" }));
    fireEvent.click(screen.getByRole("button", { name: "Seti bitir" }));
    expect(onAction.mock.calls.map((c) => c[0])).toEqual(["PAUSE", "END_SET"]);
  });

  test("muted state is shown on the sound button", () => {
    show(stateAfter(toActive), null, true);
    expect(screen.getByRole("button", { name: "Ses kapalı" }).getAttribute("aria-pressed")).toBe("true");
  });

  test("'set done?' dialog after inactivity", () => {
    const { onAction } = show(stateAfter([...toActive, { type: "TICK", now: T0 + PROGRAM_TIMING.countdownMs + 10_000 }]));
    const dialog = screen.getByRole("dialog");
    expect(dialog.textContent).toContain("Set bitti mi?");
    fireEvent.click(screen.getByRole("button", { name: "Devam" }));
    expect(onAction).toHaveBeenCalledWith("CONTINUE_SET");
  });
});

describe("other session states", () => {
  test("READY offers start", () => {
    const { onAction } = show(stateAfter([ua("START")]));
    fireEvent.click(screen.getByRole("button", { name: "Başla" }));
    expect(onAction).toHaveBeenCalledWith("START");
  });

  test("countdown shows the seconds left", () => {
    show(stateAfter([ua("START"), ua("START")]));
    expect(document.querySelector(".rep-counter")!.textContent).toBe("3");
  });

  test("A6 rest: time left, set summary and 'I'm ready'", () => {
    const tenReps = Array(10).fill(rep);
    const { onAction } = show(stateAfter([...toActive, ...tenReps]), {
      type: "SHOW",
      key: "summary.set",
      params: { counted: 10, valid: 10, faulty: 0, incomplete: 0, mostFrequentFault: "" },
    });
    expect(document.querySelector(".rep-counter")!.textContent).toBe("60");
    expect(screen.getByText("10 tekrar · 10 temiz")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Hazırım" }));
    expect(onAction).toHaveBeenCalledWith("READY");
  });

  test("paused after a safety stop shows the warning and resume", () => {
    const { onAction } = show(stateAfter([...toActive, { type: "SAFETY_PAUSE", faultId: "knee_valgus" }]), { type: "SHOW", key: "safety.stop" });
    const alert = screen.getByRole("alert");
    expect(alert.className).toContain("alert-danger");
    expect(alert.textContent).toContain("Dur, formunu kontrol et");
    expect(alert.textContent).toContain("Dizlerini dışarı aç"); // the fault's own fix
    expect(alert.textContent).toContain("Başlangıç duruşuna geç");
    fireEvent.click(screen.getByRole("button", { name: "Devam et" }));
    expect(onAction).toHaveBeenCalledWith("RESUME");
  });

  test("form fixed: the countdown carries a green confirmation", () => {
    const paused = [...toActive, { type: "SAFETY_PAUSE", faultId: "knee_valgus" } as ProgramInput];
    show(stateAfter([...paused, { type: "READY_POSE_HELD" }]), { type: "SHOW", key: "safety.resumed" });
    const ok = screen.getByRole("status");
    expect(ok.className).toContain("alert-ok");
    expect(ok.textContent).toBe("Form düzeldi");
  });

  test("a countdown without that confirmation has no green box", () => {
    show(stateAfter([ua("START"), ua("START")]));
    expect(document.querySelector(".alert-ok")).toBeNull();
  });
});

describe("tracking loss says why (specs/08 A5)", () => {
  const lost = { type: "TRACKING_LOST" } as ProgramInput;
  const paused = () => stateAfter([...toActive, lost, { type: "TICK", now: T0 + PROGRAM_TIMING.countdownMs + 6_000 }]);

  test("a body part out of view is named", () => {
    show(paused(), null, false, { cause: "body", landmarks: ["left_ankle", "right_ankle", "left_knee"] });
    expect(screen.getByRole("alert").textContent).toBe("Görünmüyor: ayak bileği, diz. Biraz uzaklaş ya da kamerayı ayarla");
  });

  test("two people in view", () => {
    show(paused(), null, false, { cause: "ambiguous" });
    expect(screen.getByRole("alert").textContent).toContain("birden fazla kişi");
  });

  test("nobody in view", () => {
    show(paused(), null, false, { cause: "absent" });
    expect(screen.getByRole("alert").textContent).toBe("Seni göremiyorum, kadraja geri gel");
  });

  test("the warning shows already during the grace period, before the pause", () => {
    show(stateAfter([...toActive, lost]), null, false, { cause: "body", landmarks: ["left_ankle"] });
    const band = screen.getByRole("status");
    expect(band.className).toContain("cue-warning");
    expect(band.textContent).toContain("ayak bileği");
  });
});
