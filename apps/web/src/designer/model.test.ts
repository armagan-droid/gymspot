import { parseCheck, parseExpression, parseReadyPose, safeLoadRulePack } from "@gymspot/engine";
import { describe, expect, test } from "vitest";
import { RULE_PACKS, rulePack } from "../rules";
import {
  type Condition,
  GYM_EXERCISE_ID,
  STARTERS,
  checkFromText,
  checkToText,
  conditionFromText,
  conditionToText,
  getIn,
  gymExerciseId,
  issuesUnder,
  readyPoseFromText,
  readyPoseToText,
  setIn,
  startFrom,
} from "./model";

// Exercise designer form model (specs/11, AC-11.5).

describe("gym exercise ids", () => {
  test("derived from the name, t_-prefixed, ASCII snake_case", () => {
    expect(gymExerciseId("Sumo Squat (geniş)")).toBe("t_sumo_squat_genis");
    expect(gymExerciseId("Şınav – İtiş ÇÖĞÜ")).toBe("t_sinav_itis_cogu");
    expect(gymExerciseId("a")).toBe("t_ax");
    expect(gymExerciseId("!!!")).toBe("t_xx");
    expect(gymExerciseId("x".repeat(80))).toHaveLength(42);
    for (const n of ["Sumo Squat", "a", "!!!", "x".repeat(80), "Diz 2"]) expect(GYM_EXERCISE_ID.test(gymExerciseId(n)), n).toBe(true);
  });
});

describe("starting points", () => {
  test("every starter and every copy is a valid pack with the new id, version 1, draft", () => {
    for (const s of STARTERS) {
      const d = startFrom(rulePack(s.from), "t_new", { tr: "Yeni", en: "New" }, false);
      expect(safeLoadRulePack(d), s.id).toMatchObject({ success: true });
      expect(d).toMatchObject({ id: "t_new", version: 1, status: "draft", name: { tr: "Yeni", en: "New" }, faults: [] });
      expect(d.howTo).toBeUndefined();
    }
    for (const id of Object.keys(RULE_PACKS)) {
      const d = startFrom(rulePack(id), "t_copy", { tr: "Kopya", en: "Copy" }, true);
      expect(safeLoadRulePack(d), id).toMatchObject({ success: true });
      expect(d.faults).toEqual(rulePack(id).faults);
    }
  });

  test("copying does not touch the source pack", () => {
    const before = JSON.stringify(rulePack("squat"));
    const d = startFrom(rulePack("squat"), "t_x", { tr: "X", en: "X" }, true);
    (d.rep as { metric: string }).metric = "changed";
    expect(JSON.stringify(rulePack("squat"))).toBe(before);
  });
});

describe("path editing", () => {
  test("setIn copies along the path, creates missing objects and deletes with undefined", () => {
    const d = { rep: { start: { enter: 1 } }, faults: [{ id: "a" }, { id: "b" }] };
    const e = setIn(d, ["rep", "start", "enter"], 2);
    expect(e.rep.start.enter).toBe(2);
    expect(d.rep.start.enter).toBe(1);
    expect(e.faults).toBe(d.faults);
    expect(getIn(setIn(d, ["howTo", "tr"], "x"), ["howTo", "tr"])).toBe("x");
    expect(setIn(d, ["faults", 0], undefined).faults).toEqual([{ id: "b" }]);
    expect("rep" in setIn(d, ["rep"], undefined)).toBe(false);
  });

  test("issues are grouped by their path", () => {
    const issues = ["rep.metric: unknown", "rep: zones overlap", "faults.0.check: bad", "faults.1: x", "readyPose: y"];
    expect(issuesUnder(issues, "rep")).toEqual(["rep.metric: unknown", "rep: zones overlap"]);
    expect(issuesUnder(issues, "faults.0")).toEqual(["faults.0.check: bad"]);
  });
});

describe("AC-11.5: condition builder", () => {
  const samples: Condition[] = [
    { join: "and", clauses: [{ left: { kind: "metric", name: "knee" }, op: "<", right: { kind: "number", value: 100 } }] },
    {
      join: "or",
      clauses: [
        { left: { kind: "call", fn: "min", metrics: ["guard_l", "guard_r"] }, op: "<", right: { kind: "number", value: -0.5 } },
        { left: { kind: "metric", name: "hip" }, op: ">=", right: { kind: "metric", name: "knee" } },
        { left: { kind: "call", fn: "abs", metrics: ["tilt"] }, op: ">", right: { kind: "number", value: 0.15 } },
      ],
    },
  ];

  test("builder → text → builder is lossless", () => {
    for (const c of samples) expect(conditionFromText(conditionToText(c))).toEqual(c);
  });

  test("the text means what the engine parses", () => {
    expect(parseExpression(conditionToText(samples[1]!))).toEqual(
      parseExpression("min(guard_l, guard_r) < -0.5 or hip >= knee or abs(tilt) > 0.15"),
    );
  });

  test("every expression in the shipped packs either round-trips to the same AST or stays text", () => {
    let fitted = 0;
    for (const { pack } of Object.values(RULE_PACKS)) {
      for (const f of pack.faults) {
        const form = checkFromText(f.check);
        if (form.condition) {
          fitted++;
          expect(parseCheck(checkToText(form.position, form.condition)), f.check).toEqual(parseCheck(f.check));
        } else {
          expect(parseCheck(checkToText(form.position, form.text)), f.check).toEqual(parseCheck(f.check));
        }
      }
      const r = readyPoseFromText(pack.readyPose);
      expect(parseReadyPose(readyPoseToText(r.condition ?? r.text, r.durationMs)), pack.readyPose).toEqual(parseReadyPose(pack.readyPose));
    }
    expect(fitted).toBeGreaterThan(5);
  });

  test("mixed and/or, not, nested calls and broken text are not forced into the builder", () => {
    for (const src of ["a < 1 and b < 2 or c < 3", "not a < 1", "max(a, 1) < 2", "a <"]) {
      expect(conditionFromText(src), src).toBeNull();
    }
    expect(checkFromText("during_rep: a < 1 and (b < 2 or c < 3)")).toMatchObject({ position: "during_rep", condition: null, text: "a < 1 and (b < 2 or c < 3)" });
  });

  test("ready pose keeps its hold time", () => {
    expect(readyPoseFromText("knee > 160 for 1500ms")).toMatchObject({ durationMs: 1500, text: "knee > 160" });
    expect(readyPoseToText({ join: "and", clauses: [{ left: { kind: "metric", name: "knee" }, op: ">", right: { kind: "number", value: 160 } }] }, 800)).toBe("knee > 160 for 800ms");
  });
});
