import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { LandmarkSequence } from "@gymspot/shared";
import { describe, expect, test } from "vitest";
import {
  type AttemptCompleted,
  RepCounter,
  type RepCounterEvent,
  chooseNearSide,
  classifyAttempt,
  createMetricComputer,
  createMetricSmoother,
  evaluate,
  loadRulePack,
} from "../src/index";
import { mirrorFrame, playSequence, pushupSequence, scalarSignal } from "../src/testing/index";

const load = (id: string) =>
  loadRulePack(JSON.parse(readFileSync(fileURLToPath(new URL(`../../../exercises/${id}.json`, import.meta.url)), "utf8")));
const squat = load("squat");
const press = load("shoulder_press");

/** Runs a scalar signal for the pack's rep metric through a fresh counter. */
function run(rep: typeof squat.pack.rep, signal: { t: number; value: number }[], extra?: (t: number) => Record<string, number>) {
  const c = new RepCounter(rep);
  return signal.flatMap((p) => c.push(p.t, { [rep.metric]: p.value, ...extra?.(p.t) }));
}
const attempts = (events: RepCounterEvent[]) => events.filter((e): e is AttemptCompleted => e.type === "ATTEMPT_COMPLETED");
const starts = (events: RepCounterEvent[]) => events.filter((e) => e.type === "REP_STARTED");

describe("RepCounter — decreasing movement (squat)", () => {
  test("counts clean reps that reach the target", () => {
    const ev = run(squat.pack.rep, scalarSignal({ fps: 30, from: 172, reps: [{ to: 90 }, { to: 90 }, { to: 90 }] }));
    expect(starts(ev)).toHaveLength(3);
    const a = attempts(ev);
    expect(a).toHaveLength(3);
    expect(a.every((x) => x.reachedTarget)).toBe(true);
  });

  test("REP_STARTED precedes each ATTEMPT_COMPLETED", () => {
    const ev = run(squat.pack.rep, scalarSignal({ fps: 30, from: 172, reps: [{ to: 90 }, { to: 90 }] }));
    expect(ev.map((e) => e.type)).toEqual(["REP_STARTED", "ATTEMPT_COMPLETED", "REP_STARTED", "ATTEMPT_COMPLETED"]);
  });

  test("nothing counts until the start zone has been entered", () => {
    // starts half-way down (120), comes up to 172, then does one rep
    const sig = scalarSignal({ fps: 30, from: 172, reps: [{ to: 90 }], leadInMs: 1000 }).map((p, i) =>
      i < 10 ? { ...p, value: 120 } : p,
    );
    const ev = run(squat.pack.rep, sig);
    expect(attempts(ev)).toHaveLength(1);
  });

  test("a partial rep is an attempt that did not reach the target", () => {
    const a = attempts(run(squat.pack.rep, scalarSignal({ fps: 30, from: 172, reps: [{ to: 125 }] })));
    expect(a).toHaveLength(1);
    expect(a[0]!.reachedTarget).toBe(false);
    expect(a[0]!.turn.value).toBeCloseTo(125, 0);
  });

  test("a wobble smaller than attemptMinExcursion is not an attempt (AC-4.4)", () => {
    // start.exit 150, excursion 20 -> must go below 130 to count
    const ev = run(squat.pack.rep, scalarSignal({ fps: 30, from: 172, reps: [{ to: 135 }] }));
    expect(attempts(ev)).toHaveLength(0);
  });

  test("turn point and start snapshots carry all metric values from those frames", () => {
    const sig = scalarSignal({ fps: 30, from: 172, reps: [{ to: 90 }] });
    const lean = (t: number) => ({ torso_lean: t / 100 });
    const [a] = attempts(run(squat.pack.rep, sig, lean));
    expect(a!.turn.value).toBeCloseTo(90);
    expect(a!.turn.values.torso_lean).toBeCloseTo(a!.turn.t / 100);
    expect(a!.turn.values.knee_angle_avg).toBe(a!.turn.value);
    expect(a!.start.values.torso_lean).toBeCloseTo(a!.start.t / 100);
    expect(a!.start.values.knee_angle_avg).toBeLessThan(150);
  });

  test("duration runs from leaving the start zone to re-entering it", () => {
    const sig = scalarSignal({ fps: 30, from: 172, reps: [{ to: 90, durationMs: 2000 }] });
    const [a] = attempts(run(squat.pack.rep, sig));
    const left = sig.find((p) => p.value < 150)!.t;
    const back = sig.find((p) => p.t > left && p.value >= 160)!.t;
    expect(a!.start.t).toBe(left);
    expect(a!.t).toBe(back);
    expect(a!.durationMs).toBeCloseTo(back - left);
  });

  test("NaN frames are ignored", () => {
    const sig = scalarSignal({ fps: 30, from: 172, reps: [{ to: 90 }] }).map((p, i) => (i % 7 === 3 ? { ...p, value: NaN } : p));
    const a = attempts(run(squat.pack.rep, sig));
    expect(a).toHaveLength(1);
    expect(a[0]!.reachedTarget).toBe(true);
  });

  test("reset() returns to waiting for the start zone", () => {
    const c = new RepCounter(squat.pack.rep);
    c.push(0, { knee_angle_avg: 172 });
    c.push(33, { knee_angle_avg: 140 });
    expect(c.state).toBe("IN_REP");
    c.reset();
    expect(c.state).toBe("WAITING");
  });
});

describe("AC-4.4: noisy signals are not double counted", () => {
  test.each([1, 2, 3, 4, 5])("5 reps with σ=3° noise count exactly 5 (seed %i)", (seed) => {
    const reps = Array.from({ length: 5 }, () => ({ to: 92 }));
    const a = attempts(run(squat.pack.rep, scalarSignal({ fps: 30, from: 172, reps, noise: 3, seed })));
    expect(a).toHaveLength(5);
    expect(a.every((x) => x.reachedTarget)).toBe(true);
  });

  test("standing still near the start thresholds produces no events at all", () => {
    // 156 ± 4 keeps crossing start.exit (150) and start.enter (160)
    const sig = scalarSignal({ fps: 30, from: 156, reps: [], leadInMs: 10_000, noise: 4, seed: 11 });
    expect(sig.some((p) => p.value < 150) && sig.some((p) => p.value >= 160)).toBe(true);
    expect(run(squat.pack.rep, [{ t: -100, value: 170 }, ...sig])).toEqual([]);
  });

  test("REP_STARTED fires once the excursion is confirmed, not on leaving the start zone", () => {
    const sig = scalarSignal({ fps: 30, from: 172, reps: [{ to: 90 }] });
    const c = new RepCounter(squat.pack.rep);
    const firstStart = sig.find((p) => c.push(p.t, { knee_angle_avg: p.value }).some((e) => e.type === "REP_STARTED"))!;
    expect(firstStart.value).toBeLessThanOrEqual(130);
    expect(firstStart.value).toBeGreaterThan(120);
  });

  test("hovering around the target threshold still counts one rep per rep", () => {
    const reps = Array.from({ length: 4 }, () => ({ to: 100, durationMs: 3000 }));
    const a = attempts(run(squat.pack.rep, scalarSignal({ fps: 30, from: 172, reps, noise: 3, seed: 21 })));
    expect(a).toHaveLength(4);
  });
});

describe("RepCounter — increasing movement (shoulder press)", () => {
  test("counts presses and detects partial lockouts", () => {
    const a = attempts(run(press.pack.rep, scalarSignal({ fps: 30, from: 85, reps: [{ to: 172 }, { to: 140 }, { to: 170 }] })));
    expect(a.map((x) => x.reachedTarget)).toEqual([true, false, true]);
    expect(a[1]!.turn.value).toBeCloseTo(140, 0);
  });
});

describe("classifyAttempt (specs/04 outcome table)", () => {
  const rep = { minDurationMs: 800, maxDurationMs: 8000 };
  const base = { reachedTarget: true, durationMs: 2000, hasValidityFault: false };

  test.each([
    [{ reachedTarget: true, hasValidityFault: false }, "valid"],
    [{ reachedTarget: true, hasValidityFault: true }, "faulty"],
    [{ reachedTarget: false, hasValidityFault: true }, "faulty"],
    [{ reachedTarget: false, hasValidityFault: false }, "incomplete"],
  ] as const)("%o -> %s", (input, outcome) => {
    expect(classifyAttempt({ ...base, ...input }, rep)).toBe(outcome);
  });

  test("too fast or too slow is incomplete regardless of the rest", () => {
    expect(classifyAttempt({ ...base, durationMs: 500 }, rep)).toBe("incomplete");
    expect(classifyAttempt({ ...base, durationMs: 9000 }, rep)).toBe("incomplete");
    expect(classifyAttempt({ ...base, durationMs: 500, hasValidityFault: true }, rep)).toBe("incomplete");
    expect(classifyAttempt({ ...base, durationMs: 800 }, rep)).toBe("valid");
    expect(classifyAttempt({ ...base, durationMs: 8000 }, rep)).toBe("valid");
  });
});

describe("AC-4.5: partial reps trigger the depth fault at the turn point", () => {
  const depth = squat.faults.find((f) => f.id === "insufficient_depth")!;

  test("insufficient_depth is true for a partial squat and false for a full one", () => {
    const a = attempts(run(squat.pack.rep, scalarSignal({ fps: 30, from: 172, reps: [{ to: 90 }, { to: 120 }] })));
    expect(depth.position).toBe("at_turn");
    expect(evaluate(depth.expr, a[0]!.turn.values)).toBe(false);
    expect(evaluate(depth.expr, a[1]!.turn.values)).toBe(true);
    const outcomes = a.map((x) =>
      classifyAttempt(
        { reachedTarget: x.reachedTarget, durationMs: x.durationMs, hasValidityFault: evaluate(depth.expr, x.turn.values) === true },
        squat.pack.rep,
      ),
    );
    expect(outcomes).toEqual(["valid", "faulty"]);
  });
});

describe("AC-4.7: near_ landmarks give the same result for left, right and mirrored side views", () => {
  const pushup = load("pushup");

  function attemptsOf(seq: LandmarkSequence) {
    const computer = createMetricComputer(pushup.pack.metrics);
    const near = chooseNearSide(seq.frames.slice(0, 30));
    const smooth = createMetricSmoother(computer.order, pushup.pack.smoothing);
    const counter = new RepCounter(pushup.pack.rep);
    return attempts(playSequence(seq, (f) => counter.push(f.t, smooth(computer.compute(f, near), f.t))));
  }

  test("same attempts and turn values", () => {
    const reps = [{ elbowAngle: 85 }, { elbowAngle: 110 }, { elbowAngle: 88, hipOffset: -0.08 }];
    const right = pushupSequence({ reps, facing: "right" });
    const left = pushupSequence({ reps, facing: "left" });
    const mirrored = { ...right, frames: right.frames.map(mirrorFrame) };

    const r = attemptsOf(right);
    expect(r.map((a) => a.reachedTarget)).toEqual([true, false, true]);
    for (const other of [attemptsOf(left), attemptsOf(mirrored)]) {
      expect(other.map((a) => a.reachedTarget)).toEqual(r.map((a) => a.reachedTarget));
      other.forEach((a, i) => {
        expect(a.turn.value).toBeCloseTo(r[i]!.turn.value, 6);
        expect(a.turn.values.hip_offset).toBeCloseTo(r[i]!.turn.values.hip_offset!, 6);
      });
    }
  });
});
