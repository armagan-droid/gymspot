import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { RulePackError, loadRulePack, safeLoadRulePack } from "../src/index";

const DIR = fileURLToPath(new URL("../../../exercises/", import.meta.url));
const files = readdirSync(DIR).filter((f) => f.endsWith(".json"));
const read = (f: string) => JSON.parse(readFileSync(join(DIR, f), "utf8"));
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const squat = (): any => structuredClone(read("squat.json"));

describe("AC-4.1 (expression part): exercises/*.json load with all expressions resolved", () => {
  test.each(files)("%s loads", (file) => {
    const r = safeLoadRulePack(read(file));
    expect(r.success ? [] : r.issues).toEqual([]);
  });
});

describe("loadRulePack", () => {
  test("compiles fault checks and readyPose", () => {
    const loaded = loadRulePack(squat());
    expect(loaded.readyPose.durationMs).toBe(1500);
    const depth = loaded.faults.find((f) => f.id === "insufficient_depth");
    expect(depth?.position).toBe("at_turn");
    expect(depth?.expr).toMatchObject({ kind: "compare", op: ">" });
    expect(loaded.pack.id).toBe("squat");
  });

  test("undefined metric in a fault check is rejected with its path", () => {
    const p = squat();
    p.faults[1].check = "during_rep: knee_valgus > 0.15";
    const r = safeLoadRulePack(p);
    expect(r.success).toBe(false);
    if (!r.success) expect(r.issues.join("\n")).toMatch(/faults\.1\.check: .*knee_valgus/);
  });

  test("undefined metric in readyPose is rejected", () => {
    const p = squat();
    p.readyPose = "knee_angle > 165 for 1500ms";
    const r = safeLoadRulePack(p);
    expect(r.success).toBe(false);
    if (!r.success) expect(r.issues.join("\n")).toMatch(/readyPose: .*knee_angle/);
  });

  test("schema issues are reported before expression parsing", () => {
    const p = squat();
    p.hysteresis = {};
    const r = safeLoadRulePack(p);
    expect(r.success).toBe(false);
    if (!r.success) expect(r.issues.join("\n")).toContain("hysteresis");
  });

  test("loadRulePack throws RulePackError listing all issues", () => {
    const p = squat();
    p.faults[0].check = "at_turn: nope > 1";
    p.faults[1].check = "during_rep: eval(1) > 1";
    expect(() => loadRulePack(p)).toThrow(RulePackError);
    try {
      loadRulePack(p);
    } catch (e) {
      expect((e as RulePackError).issues).toHaveLength(2);
    }
  });
});
