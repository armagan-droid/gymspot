import { LANDMARK_NAMES } from "@gymspot/shared";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, test } from "vitest";
import { App } from "../App";
import { createI18n } from "../i18n";
import { poseResultToFrame } from "../pose/toFrame";
import { FpsMeter, SampleBuffer, meetsBudget, percentile } from "./measure";

afterEach(cleanup);

const lm = (i: number) => ({ x: i / 100, y: 0.5, z: 0, visibility: 0.9 });

describe("poseResultToFrame", () => {
  test("maps the first pose to a Frame", () => {
    const pose = LANDMARK_NAMES.map((_, i) => lm(i));
    const f = poseResultToFrame({ landmarks: [pose], worldLandmarks: [pose] }, 123);
    expect(f?.t).toBe(123);
    expect(f?.image).toHaveLength(33);
    expect(f?.image[5]!.x).toBe(0.05);
  });

  test("returns null without a complete pose", () => {
    expect(poseResultToFrame({ landmarks: [], worldLandmarks: [] }, 0)).toBeNull();
    expect(poseResultToFrame({ landmarks: [[lm(0)]], worldLandmarks: [[lm(0)]] }, 0)).toBeNull();
  });

  test("clamps visibility and falls back to the image visibility for world points", () => {
    const image = LANDMARK_NAMES.map(() => ({ x: 0, y: 0, z: 0, visibility: 1.3 }));
    const world = LANDMARK_NAMES.map(() => ({ x: 0, y: 0, z: 0 }));
    const f = poseResultToFrame({ landmarks: [image], worldLandmarks: [world] }, 0)!;
    expect(f.image[0]!.visibility).toBe(1);
    expect(f.world[0]!.visibility).toBe(1);
  });
});

describe("measurement helpers", () => {
  test("FpsMeter over a sliding window", () => {
    const m = new FpsMeter(1000);
    for (let i = 0; i <= 30; i++) m.tick(i * (1000 / 30));
    expect(m.fps).toBeCloseTo(30, 0);
    for (let i = 31; i <= 60; i++) m.tick(1000 + (i - 30) * 100); // slows to 10 fps
    expect(m.fps).toBeCloseTo(10, 0);
  });

  test("percentile (nearest rank)", () => {
    const xs = Array.from({ length: 100 }, (_, i) => i + 1);
    expect(percentile(xs, 50)).toBe(50);
    expect(percentile(xs, 95)).toBe(95);
    expect(percentile([7], 95)).toBe(7);
    expect(percentile([], 50)).toBeNaN();
  });

  test("SampleBuffer keeps the last N finite samples", () => {
    const b = new SampleBuffer(3);
    [1, 2, NaN, 3, 4].forEach((v) => b.add(v));
    expect(b.samples).toEqual([2, 3, 4]);
    expect(b.stats()).toEqual({ n: 3, p50: 3, p95: 4 });
  });

  test("budget from specs/02: ≥ 15 FPS and ≤ 250 ms p95", () => {
    expect(meetsBudget(15, 250)).toBe(true);
    expect(meetsBudget(14.9, 100)).toBe(false);
    expect(meetsBudget(30, 251)).toBe(false);
  });
});

describe("spike route", () => {
  test("is available in development builds", async () => {
    render(
      <MemoryRouter initialEntries={["/spike"]}>
        <App i18n={createI18n("tr")} />
      </MemoryRouter>,
    );
    expect(await screen.findByRole("heading", { name: "Pose spike (T2.2)" })).toBeTruthy();
    expect(screen.getByText(/Nothing is uploaded or stored/)).toBeTruthy();
  });
});
