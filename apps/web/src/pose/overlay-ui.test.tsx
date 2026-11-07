import { squatFrame } from "@gymspot/engine/testing";
import { LANDMARK_NAMES } from "@gymspot/shared";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from "vitest";
import { createI18n } from "../i18n";
import { RULE_PACKS, rulePack } from "../rules";
import { ServicesProvider } from "../services";
import { LiveSession } from "../session/LiveSession";
import { SessionRunner } from "../session/runner";
import { SetupWizard } from "../setup/SetupWizard";
import { testServices } from "../test-services";

// specs/08: A3 guide frame + skeleton, A5 skeleton layer (on by default, switchable).

afterEach(cleanup);

/** jsdom has no canvas or video size; record what the overlay paints. */
const ctx = { strokes: [] as string[], arcs: 0, lines: 0, strokeColors: [] as string[], arcRadii: [] as number[] };
const fake2d = {
  setTransform: () => undefined,
  save: () => undefined,
  restore: () => undefined,
  fillRect: () => undefined,
  clearRect: () => undefined,
  setLineDash: () => undefined,
  strokeRect: function (this: { strokeStyle: string }) {
    ctx.strokes.push(this.strokeStyle);
  },
  beginPath: () => undefined,
  moveTo: () => undefined,
  lineTo: () => void ctx.lines++,
  stroke: function (this: { strokeStyle: string }) {
    ctx.strokeColors.push(this.strokeStyle);
  },
  arc: (_x: number, _y: number, r: number) => {
    ctx.arcs++;
    ctx.arcRadii.push(r);
  },
  fill: () => undefined,
  strokeStyle: "",
  fillStyle: "",
  lineWidth: 0,
  lineCap: "",
};
const restore: (() => void)[] = [];
beforeAll(() => {
  const getContext = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = (() => fake2d) as never;
  restore.push(() => void (HTMLCanvasElement.prototype.getContext = getContext));
  for (const [k, v] of [["videoWidth", 720], ["videoHeight", 1280]] as const) {
    Object.defineProperty(HTMLVideoElement.prototype, k, { configurable: true, get: () => v });
    restore.push(() => void delete (HTMLVideoElement.prototype as unknown as Record<string, unknown>)[k]);
  }
});
afterAll(() => restore.forEach((r) => r()));

const person = squatFrame({ kneeAngle: 170 }, { view: "front" });

describe("A3 setup overlay", () => {
  test("draws the skeleton and a guide frame that turns green when ready", async () => {
    ctx.strokes = [];
    ctx.lines = 0;
    let emit: ((c: (typeof person)[], t: number) => void) | undefined;
    const speak = vi.fn();
    ctx.strokeColors = [];
    render(
      <I18nextProvider i18n={createI18n("tr")}>
        <SetupWizard
          pack={rulePack("squat")}
          consent
          source={{ start: vi.fn(async (_v, cb) => void (emit = cb)), stop: vi.fn() }}
          requestCamera={vi.fn(async () => ({ ok: true as const, stream: {} as MediaStream }))}
          onReady={vi.fn()}
          onManualEntry={vi.fn()}
          speak={speak}
        />
      </I18nextProvider>,
    );
    expect(await screen.findByTestId("pose-overlay")).toBeTruthy();
    await vi.waitFor(() => expect(emit).toBeDefined());
    const ankles = [LANDMARK_NAMES.indexOf("left_ankle"), LANDMARK_NAMES.indexOf("right_ankle")];
    const noFeet = { ...person, image: person.image.map((p, i) => (ankles.includes(i) ? { ...p, visibility: 0.1 } : p)) };
    await act(async () => {
      for (let i = 0; i < 31; i++) emit!([noFeet], (i * 1000) / 30);
    });
    expect(ctx.lines).toBeGreaterThan(0);
    expect(ctx.arcs).toBeGreaterThan(0);
    expect(ctx.strokes.at(-1)).toBe("#facc15"); // feet out of view: not ready
    expect(ctx.strokeColors).toContain("rgba(255,255,255,0.55)"); // target silhouette
    expect(screen.getByRole("status").textContent).toBe("Tüm vücudun görünsün"); // big banner
    expect(speak).toHaveBeenCalledWith("setup.hint.show_full_body");
    await act(async () => {
      for (let i = 31; i < 93; i++) emit!([person], (i * 1000) / 30); // ready needs the window, then stability
    });
    expect(ctx.strokes.at(-1)).toBe("#4ade80"); // ready after a clean second
    expect(speak).toHaveBeenLastCalledWith("setup.ready");
  });
});


describe("A3 floor exercise in portrait", () => {
  test("asks to turn the phone sideways first, and says so", async () => {
    let emit: ((c: (typeof person)[], t: number) => void) | undefined;
    const speak = vi.fn();
    render(
      <I18nextProvider i18n={createI18n("tr")}>
        <SetupWizard
          pack={rulePack("pushup")}
          consent
          source={{ start: vi.fn(async (_v, cb) => void (emit = cb)), stop: vi.fn() }}
          requestCamera={vi.fn(async () => ({ ok: true as const, stream: {} as MediaStream }))}
          onReady={vi.fn()}
          onManualEntry={vi.fn()}
          speak={speak}
        />
      </I18nextProvider>,
    );
    await vi.waitFor(() => expect(emit).toBeDefined());
    await act(async () => {
      for (let i = 0; i < 31; i++) emit!([person], (i * 1000) / 30); // the jsdom video is 720×1280
    });
    expect(screen.getByRole("status").textContent).toBe("Telefonu yan çevir");
    expect(speak).toHaveBeenCalledWith("setup.hint.rotate_phone");
  });
});

const PACKS = Object.fromEntries(Object.entries(RULE_PACKS).map(([k, v]) => [k, v.pack]));

function makeRunner(t: ReturnType<typeof testServices>) {
  return new SessionRunner({
    packs: RULE_PACKS,
    program: {
      role: "owner",
      workout: { id: "w", name: "A", blocks: [{ exerciseId: "squat", exerciseVersion: 1, sets: 1, reps: 3, restSec: 30, mode: "strict" }] },
      sessionId: "11111111-1111-4111-8111-111111111111",
      memberId: "m",
      memberProgramId: "p",
      workoutDayIndex: 0,
      deviceId: "phone",
    },
    setup: { view: "front", nearSide: "left" },
    now: t.services.now,
    newId: t.services.newId,
    onCommand: () => undefined,
  });
}

describe("A5 skeleton layer", () => {
  test("on by default; the toggle switches it off and back on", async () => {
    const t = testServices();
    const runner = makeRunner(t);
    render(
      <ServicesProvider services={t.services}>
        <I18nextProvider i18n={createI18n("tr")}>
          <LiveSession runner={runner} packs={PACKS} bindCommands={() => undefined} />
        </I18nextProvider>
      </ServicesProvider>,
    );
    const toggle = await screen.findByRole("button", { name: "İskelet açık" });
    expect(toggle.getAttribute("aria-pressed")).toBe("true");
    await vi.waitFor(() => expect(t.pose.emit).toBeDefined());

    ctx.lines = 0;
    await act(async () => t.pose.emit!([person], 0));
    expect(ctx.lines).toBeGreaterThan(0);

    fireEvent.click(toggle);
    expect(screen.getByRole("button", { name: "İskelet kapalı" }).getAttribute("aria-pressed")).toBe("false");
    ctx.lines = 0;
    await act(async () => t.pose.emit!([person], 40));
    expect(ctx.lines).toBe(0);

    fireEvent.click(screen.getByRole("button", { name: "İskelet kapalı" }));
    await act(async () => t.pose.emit!([person], 80));
    expect(ctx.lines).toBeGreaterThan(0);
  });

  test("a form cue turns the joints of that fault red for a moment", async () => {
    const t = testServices();
    let show: ((c: { type: "SHOW"; key: string }) => void) | undefined;
    render(
      <ServicesProvider services={t.services}>
        <I18nextProvider i18n={createI18n("tr")}>
          <LiveSession runner={makeRunner(t)} packs={PACKS} bindCommands={(h) => void (show = h.show)} />
        </I18nextProvider>
      </ServicesProvider>,
    );
    await vi.waitFor(() => expect(t.pose.emit && show).toBeTruthy());
    ctx.arcRadii = [];
    await act(async () => t.pose.emit!([person], 0));
    expect(ctx.arcRadii).not.toContain(12);

    act(() => show!({ type: "SHOW", key: "cue.squat.knee_valgus" }));
    ctx.arcRadii = [];
    await act(async () => t.pose.emit!([person], 40));
    expect(ctx.arcRadii.filter((r) => r === 12)).toHaveLength(6); // both hips, knees, ankles
  });
});
