import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { LandmarkSequence } from "@gymspot/shared";
import { describe, expect, test } from "vitest";
import { evaluateSequence, summarize, sweep, withParameter } from "../src/index";
import { squatSequence } from "../src/testing/index";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const squatJson = (): any => JSON.parse(readFileSync(fileURLToPath(new URL("../../../exercises/squat.json", import.meta.url)), "utf8"));

const labeled = (reps: Parameters<typeof squatSequence>[0]["reps"], leadInMs = 5000): LandmarkSequence =>
  ({ ...squatSequence({ view: "front", reps, leadInMs, seed: 3, noise: 0.002 }), source: "calibration" }) as LandmarkSequence;

const clean = labeled([
  { kneeAngle: 90, label: { outcome: "valid", faults: [] } },
  { kneeAngle: 120, label: { outcome: "faulty", faults: ["insufficient_depth"] } },
  { kneeAngle: 92, label: { outcome: "valid", faults: [] } },
]);

describe("evaluateSequence (specs/09 pilot metrics)", () => {
  test("predictions are aligned with labels attempt by attempt", () => {
    const r = evaluateSequence(squatJson(), clean);
    expect(r.attempts.map((a) => [a.predicted?.outcome, a.label?.outcome])).toEqual([
      ["valid", "valid"],
      ["faulty", "faulty"],
      ["valid", "valid"],
    ]);
    expect(r.labeledCount).toBe(2);
    expect(r.predictedCount).toBe(2);
    expect(r.cues).toEqual([{ attempt: 1, faultId: "insufficient_depth", correct: true }]);
  });

  test("a mislabeled rep lowers the count accuracy", () => {
    const wrong = { ...clean, labels: { reps: clean.labels!.reps.map((l, i) => (i === 1 ? { outcome: "valid" as const, faults: [] } : l)) } };
    const s = summarize([evaluateSequence(squatJson(), wrong)]);
    expect(s.countAccuracy).toBeCloseTo(1 - 1 / 3);
    expect(s.falseAlarmRate).toBe(1); // the cue's fault is not in the label
  });

  test("perfect agreement → 100% count accuracy, 0% false alarms, per-fault hits", () => {
    const s = summarize([evaluateSequence(squatJson(), clean)]);
    expect(s).toMatchObject({ countAccuracy: 1, falseAlarmRate: 0, sequences: 1, attempts: 3 });
    expect(s.faults.insufficient_depth).toEqual({ hits: 1, misses: 0, falseAlarms: 0 });
    expect(s.meetsTargets).toBe(true);
  });

  test("a labeled fault the engine misses is counted as a miss", () => {
    const missed = labeled([{ kneeAngle: 90, label: { outcome: "valid", faults: ["knee_valgus"] } }]);
    expect(summarize([evaluateSequence(squatJson(), missed)]).faults.knee_valgus).toEqual({ hits: 0, misses: 1, falseAlarms: 0 });
  });

  test("sequences without labels are rejected", () => {
    const { labels: _l, ...noLabels } = clean;
    expect(() => evaluateSequence(squatJson(), noLabels as LandmarkSequence)).toThrow(/labels/);
  });
});

describe("threshold tools", () => {
  test("withParameter changes a rep zone value or a fault check's threshold", () => {
    expect(withParameter(squatJson(), "rep.target.enter", 95).rep.target.enter).toBe(95);
    expect(withParameter(squatJson(), "faults.knee_valgus.threshold", 0.2).faults[1].check).toBe("during_rep: knee_valgus_l > 0.15 or knee_valgus_r > 0.2");
    expect(() => withParameter(squatJson(), "faults.nope.threshold", 1)).toThrow(/nope/);
    expect(() => withParameter(squatJson(), "rep.nothing", 1)).toThrow(/rep.nothing/);
  });

  test("sweep reports metrics per candidate value", () => {
    // a 112° rep labeled as a valid full squat: only a looser depth threshold counts it
    const seq = labeled([
      { kneeAngle: 90, label: { outcome: "valid", faults: [] } },
      { kneeAngle: 112, label: { outcome: "valid", faults: [] } },
    ]);
    const base = withParameter(squatJson(), "rep.target.exit", 125); // room for a deeper target zone
    const rows = sweep(base, [seq], "rep.target.enter", [100, 115]);
    expect(rows.map((r) => r.value)).toEqual([100, 115]);
    expect("summary" in rows[0]! && rows[0].summary.countAccuracy).toBeLessThan(1);
    // the depth fault threshold must move with the zone for the 112° rep to be valid
    const both = sweep(withParameter(base, "faults.insufficient_depth.threshold", 115), [seq], "rep.target.enter", [115]);
    expect("summary" in both[0]! && both[0].summary.countAccuracy).toBe(1);
  });

  test("candidate values that break the rule pack are reported, not thrown", () => {
    const rows = sweep(squatJson(), [clean], "rep.target.enter", [100, 140]); // 140 > target.exit (110)
    expect("summary" in rows[0]!).toBe(true);
    expect(rows[1]).toMatchObject({ value: 140, error: expect.stringContaining("invalid rule pack") });
  });
});
