import { type ProgramCommand, PROGRAM_TIMING } from "@gymspot/engine";
import { squatSequence } from "@gymspot/engine/testing";
import type { Frame } from "@gymspot/shared";
import { describe, expect, test } from "vitest";
import { RULE_PACKS } from "../rules";
import { SessionRunner } from "./runner";

const T0 = Date.UTC(2026, 10, 6, 9);

function makeRunner(reps = 3, sets = 1) {
  const commands: ProgramCommand[] = [];
  let clock = T0;
  let n = 0;
  const runner = new SessionRunner({
    packs: RULE_PACKS,
    program: {
      role: "owner",
      workout: { id: "w", name: "A", blocks: [{ exerciseId: "squat", exerciseVersion: 1, sets, reps, restSec: 30, mode: "strict" }] },
      sessionId: "11111111-1111-4111-8111-111111111111",
      memberId: "m",
      memberProgramId: "p",
      workoutDayIndex: 0,
      deviceId: "phone",
    },
    setup: { view: "front", nearSide: "left" },
    now: () => clock,
    newId: () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`,
    onCommand: (c) => commands.push(c),
  });
  const feed = (frames: Frame[], candidates = (f: Frame) => [f]) => {
    for (const f of frames) {
      clock = T0 + f.t;
      runner.pushCandidates(candidates(f), f.t);
    }
  };
  return { runner, commands, feed, advance: (ms: number) => (clock += ms) };
}

const squats = (reps: { kneeAngle: number }[], leadInMs = 5000) => squatSequence({ view: "front", reps, leadInMs, seed: 2 }).frames;

describe("SessionRunner (camera → engine → program)", () => {
  test("synthetic squats complete the session", () => {
    const { runner, commands, feed } = makeRunner(3);
    runner.act("START");
    feed(squats([{ kneeAngle: 90 }, { kneeAngle: 90 }, { kneeAngle: 90 }]));
    expect(runner.state.status).toBe("SESSION_DONE");
    expect(commands.filter((c) => c.type === "PERSIST_EVENT" && c.record.kind === "rep")).toHaveLength(3);
  });

  test("cues reach the commands only during the set", () => {
    const { runner, commands, feed } = makeRunner(3);
    runner.act("START");
    feed(squats([{ kneeAngle: 120 }, { kneeAngle: 90 }, { kneeAngle: 90 }, { kneeAngle: 90 }]));
    expect(commands).toContainEqual({ type: "SPEAK", key: "cue.squat.insufficient_depth" });
  });

  test("a person leaving the camera pauses the set (absence → TRACKING_LOST)", () => {
    const { runner, feed, advance } = makeRunner(10);
    runner.act("START");
    const frames = squats([{ kneeAngle: 90 }]);
    feed(frames);
    expect(runner.state.status).toBe("SET_ACTIVE");
    // nobody in view: the pose model returns no candidates
    const last = frames.at(-1)!.t;
    for (let t = last + 33; t < last + 7000; t += 33) {
      advance(33);
      runner.pushCandidates([], t);
    }
    expect(runner.state.status).toBe("PAUSED");
  });

  test("tracking comes back when the person returns", () => {
    const { runner, feed, advance } = makeRunner(10);
    runner.act("START");
    const frames = squats([{ kneeAngle: 90 }]);
    feed(frames);
    const last = frames.at(-1)!.t;
    for (let t = last + 33; t < last + 2000; t += 33) {
      advance(33);
      runner.pushCandidates([], t);
    }
    expect(runner.state.trackingLostAt).toBeDefined();
    feed(frames.slice(0, 5).map((f) => ({ ...f, t: f.t + last + 2000 })));
    expect(runner.state.trackingLostAt).toBeUndefined();
    expect(runner.state.status).toBe("SET_ACTIVE");
  });

  test("tick() advances timers without frames (rest countdown)", () => {
    const { runner, feed, advance } = makeRunner(1, 2);
    runner.act("START");
    feed(squats([{ kneeAngle: 90 }]));
    expect(runner.state.status).toBe("REST");
    advance(30_000);
    runner.tick();
    expect(runner.state.status).toBe("READY");
  });

  test("user actions reach the program", () => {
    const { runner, advance } = makeRunner();
    runner.act("START");
    runner.act("START");
    expect(runner.state.status).toBe("COUNTDOWN");
    advance(PROGRAM_TIMING.countdownMs);
    runner.tick();
    expect(runner.state.status).toBe("SET_ACTIVE");
    runner.act("PAUSE");
    expect(runner.state.status).toBe("PAUSED");
  });

  test("subscribers are notified on state changes", () => {
    const { runner } = makeRunner();
    const seen: string[] = [];
    const off = runner.subscribe((s) => seen.push(s.status));
    runner.act("START");
    off();
    runner.act("START");
    expect(seen).toEqual(["READY"]);
  });
});

describe("subscribe", () => {
  test("a change made before subscribing is delivered at once (no stale screen)", () => {
    const { runner } = makeRunner();
    const rendered = runner.state;
    runner.act("START"); // e.g. a click between render and the effect
    const seen: string[] = [];
    runner.subscribe((s) => seen.push(s.status), rendered);
    expect(seen).toEqual([runner.state.status]);
    expect(runner.state.status).not.toBe("IDLE");
  });

  test("nothing is delivered when the rendered state is current", () => {
    const { runner } = makeRunner();
    const seen: string[] = [];
    runner.subscribe((s) => seen.push(s.status), runner.state);
    expect(seen).toEqual([]);
  });
});
