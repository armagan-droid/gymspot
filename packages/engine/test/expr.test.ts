import { afterEach, describe, expect, test, vi } from "vitest";
import { ExpressionError, evaluate, parseCheck, parseExpression, parseReadyPose } from "../src/index";

const METRICS = new Set(["knee_angle_avg", "torso_lean", "knee_valgus_l", "knee_valgus_r", "hip_offset"]);
const parse = (src: string) => parseExpression(src, { metrics: METRICS });

describe("AST", () => {
  test("comparison of metric and number", () => {
    expect(parse("knee_angle_avg > 160")).toEqual({
      kind: "compare",
      op: ">",
      left: { kind: "metric", name: "knee_angle_avg" },
      right: { kind: "number", value: 160 },
    });
  });

  test("negative and decimal numbers", () => {
    expect(parse("hip_offset < -0.06")).toMatchObject({ right: { kind: "number", value: -0.06 } });
  });

  test("all comparison operators", () => {
    for (const op of [">", "<", ">=", "<="]) {
      expect(parse(`torso_lean ${op} 1`)).toMatchObject({ kind: "compare", op });
    }
  });

  test("and binds tighter than or", () => {
    expect(parse("torso_lean > 1 or torso_lean > 2 and torso_lean > 3")).toMatchObject({
      kind: "or",
      left: { kind: "compare" },
      right: { kind: "and" },
    });
  });

  test("not binds tighter than and", () => {
    expect(parse("not torso_lean > 1 and torso_lean > 2")).toMatchObject({
      kind: "and",
      left: { kind: "not", operand: { kind: "compare" } },
    });
  });

  test("parentheses override precedence", () => {
    expect(parse("(torso_lean > 1 or torso_lean > 2) and torso_lean > 3")).toMatchObject({
      kind: "and",
      left: { kind: "or" },
    });
  });

  test("function calls", () => {
    expect(parse("abs(hip_offset) > 0.1")).toMatchObject({
      left: { kind: "call", fn: "abs", args: [{ kind: "metric", name: "hip_offset" }] },
    });
    expect(parse("max(knee_valgus_l, knee_valgus_r) > 0.15")).toMatchObject({
      left: { kind: "call", fn: "max", args: [{ name: "knee_valgus_l" }, { name: "knee_valgus_r" }] },
    });
    expect(parse("avg(min(torso_lean, 3), 4) < 5")).toMatchObject({
      left: { kind: "call", fn: "avg", args: [{ kind: "call", fn: "min" }, { kind: "number" }] },
    });
  });

  test("whitespace is insignificant", () => {
    expect(parse("  torso_lean>=1and(not torso_lean<2)")).toEqual(parse("torso_lean >= 1 and (not torso_lean < 2)"));
  });
});

describe("check and readyPose forms", () => {
  test("parseCheck splits position and expression", () => {
    const c = parseCheck("at_turn: knee_angle_avg > 100", { metrics: METRICS });
    expect(c.position).toBe("at_turn");
    expect(c.expr).toEqual(parse("knee_angle_avg > 100"));
    expect(parseCheck("during_rep: torso_lean > 1", { metrics: METRICS }).position).toBe("during_rep");
    expect(parseCheck("at_start: torso_lean > 1", { metrics: METRICS }).position).toBe("at_start");
  });

  test("parseCheck rejects unknown positions and missing colon", () => {
    expect(() => parseCheck("at_phase_bottom: torso_lean > 1", { metrics: METRICS })).toThrow(ExpressionError);
    expect(() => parseCheck("torso_lean > 1", { metrics: METRICS })).toThrow(ExpressionError);
  });

  test("parseReadyPose extracts duration", () => {
    const r = parseReadyPose("knee_angle_avg > 165 for 1500ms", { metrics: METRICS });
    expect(r.durationMs).toBe(1500);
    expect(r.expr).toEqual(parse("knee_angle_avg > 165"));
  });

  test("parseReadyPose requires an integer ms duration", () => {
    for (const bad of ["knee_angle_avg > 165", "knee_angle_avg > 165 for 1.5ms", "knee_angle_avg > 165 for 1500", "knee_angle_avg > 165 for -5ms"]) {
      expect(() => parseReadyPose(bad, { metrics: METRICS }), bad).toThrow(ExpressionError);
    }
  });

  test("'for' is not allowed inside plain expressions", () => {
    expect(() => parse("knee_angle_avg > 165 for 1500ms")).toThrow(ExpressionError);
  });
});

describe("AC-4.2: bad input is rejected and never executed", () => {
  afterEach(() => vi.restoreAllMocks());

  const malicious = [
    'eval("1")',
    "eval(1) > 0",
    "Function('return 1')() > 0",
    "process.exit(1)",
    "torso_lean > 1; process.exit(1)",
    "constructor > 0",
    "__proto__ > 0",
    "torso_lean.constructor > 0",
    "torso_lean['x'] > 0",
    "`x` > 0",
    '"1" > 0',
    "torso_lean == 1",
    "torso_lean = 1",
    "torso_lean != 1",
    "!(torso_lean > 1)",
    "torso_lean > 1 && torso_lean < 2",
    "() => 1",
    "TORSO_LEAN > 1",
  ];

  test.each(malicious)("rejects %s", (src) => {
    const evalSpy = vi.spyOn(globalThis, "eval");
    expect(() => parse(src)).toThrow(ExpressionError);
    expect(evalSpy).not.toHaveBeenCalled();
  });

  test("unknown metric is rejected with its name", () => {
    expect(() => parse("hip_angle > 1")).toThrow(/hip_angle/);
  });

  test("unknown function is rejected", () => {
    expect(() => parse("sqrt(torso_lean) > 1")).toThrow(/sqrt/);
  });

  test("structural errors", () => {
    for (const bad of [
      "",
      "torso_lean",
      "torso_lean >",
      "> 1",
      "torso_lean > 1 >",
      "torso_lean < 1 < 2",
      "(torso_lean > 1",
      "torso_lean > 1)",
      "torso_lean > 1 and",
      "abs() > 1",
      "abs(torso_lean, hip_offset) > 1",
      "avg(torso_lean,) > 1",
      "1.5.2 > 1",
      "- 1 > torso_lean",
    ]) {
      expect(() => parse(bad), JSON.stringify(bad)).toThrow(ExpressionError);
    }
  });

  test("errors report the column", () => {
    try {
      parse("torso_lean > 1 & 2");
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(ExpressionError);
      expect((e as ExpressionError).column).toBe(16);
    }
  });

  test("without a metric set any snake_case identifier is accepted", () => {
    expect(parseExpression("anything_goes > 1")).toMatchObject({ left: { name: "anything_goes" } });
  });
});

describe("evaluate", () => {
  const ev = (src: string, values: Record<string, number>) => evaluate(parse(src), values);

  test("comparisons", () => {
    expect(ev("torso_lean > 10", { torso_lean: 11 })).toBe(true);
    expect(ev("torso_lean > 10", { torso_lean: 10 })).toBe(false);
    expect(ev("torso_lean >= 10", { torso_lean: 10 })).toBe(true);
    expect(ev("torso_lean < 10", { torso_lean: 9 })).toBe(true);
    expect(ev("torso_lean <= 10", { torso_lean: 10 })).toBe(true);
  });

  test("boolean operators", () => {
    expect(ev("torso_lean > 1 and hip_offset > 1", { torso_lean: 2, hip_offset: 0 })).toBe(false);
    expect(ev("torso_lean > 1 or hip_offset > 1", { torso_lean: 2, hip_offset: 0 })).toBe(true);
    expect(ev("not torso_lean > 1", { torso_lean: 2 })).toBe(false);
  });

  test("functions", () => {
    expect(ev("abs(hip_offset) > 0.05", { hip_offset: -0.06 })).toBe(true);
    expect(ev("avg(knee_valgus_l, knee_valgus_r) > 0.1", { knee_valgus_l: 0.05, knee_valgus_r: 0.2 })).toBe(true);
    expect(ev("min(knee_valgus_l, knee_valgus_r) > 0.1", { knee_valgus_l: 0.05, knee_valgus_r: 0.2 })).toBe(false);
    expect(ev("max(knee_valgus_l, knee_valgus_r) > 0.1", { knee_valgus_l: 0.05, knee_valgus_r: 0.2 })).toBe(true);
  });

  describe("unknown values (three-valued logic, specs/04)", () => {
    test("missing or NaN metric makes a comparison unknown", () => {
      expect(ev("torso_lean > 1", {})).toBeUndefined();
      expect(ev("torso_lean > 1", { torso_lean: NaN })).toBeUndefined();
    });

    test("not of unknown stays unknown (never turns uncertainty into a fault)", () => {
      expect(ev("not torso_lean > 1", { torso_lean: NaN })).toBeUndefined();
    });

    test("and / or follow Kleene logic", () => {
      expect(ev("torso_lean > 1 and hip_offset > 1", { torso_lean: 0 })).toBe(false);
      expect(ev("torso_lean > 1 and hip_offset > 1", { torso_lean: 2 })).toBeUndefined();
      expect(ev("torso_lean > 1 or hip_offset > 1", { torso_lean: 2 })).toBe(true);
      expect(ev("torso_lean > 1 or hip_offset > 1", { torso_lean: 0 })).toBeUndefined();
    });

    test("functions propagate unknown", () => {
      expect(ev("max(knee_valgus_l, knee_valgus_r) > 0.1", { knee_valgus_l: 0.5 })).toBeUndefined();
    });

    test("prototype properties are not metric values", () => {
      const e = parseExpression("constructor > 0");
      expect(evaluate(e, {})).toBeUndefined();
    });
  });
});
