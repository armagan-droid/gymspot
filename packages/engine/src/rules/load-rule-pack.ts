import { type CheckPosition, type Fault, type RulePack, safeParseRulePack } from "@gymspot/shared";
import { ExpressionError } from "../expr/error";
import { type Expr, parseCheck, parseReadyPose } from "../expr/parse";

export interface CompiledFault extends Fault {
  position: CheckPosition;
  expr: Expr;
}

export interface LoadedRulePack {
  pack: RulePack;
  faults: CompiledFault[];
  readyPose: { expr: Expr; durationMs: number };
}

export class RulePackError extends Error {
  constructor(readonly issues: string[]) {
    super(`invalid rule pack:\n${issues.join("\n")}`);
    this.name = "RulePackError";
  }
}

export type LoadResult = { success: true; value: LoadedRulePack } | { success: false; issues: string[] };

/**
 * Validates a rule pack (shared schema) and parses every expression against
 * its defined metrics (specs/04, AC-4.1). Issues are "path: message" strings.
 */
export function safeLoadRulePack(input: unknown): LoadResult {
  const parsed = safeParseRulePack(input);
  if (!parsed.success) {
    return { success: false, issues: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`) };
  }
  const pack = parsed.data;
  const options = { metrics: new Set(Object.keys(pack.metrics)) };
  const issues: string[] = [];

  const attempt = <T>(path: string, fn: () => T): T | undefined => {
    try {
      return fn();
    } catch (e) {
      if (!(e instanceof ExpressionError)) throw e;
      issues.push(`${path}: ${e.message}`);
      return undefined;
    }
  };

  const faults: CompiledFault[] = [];
  pack.faults.forEach((fault, i) => {
    const check = attempt(`faults.${i}.check`, () => parseCheck(fault.check, options));
    if (check) faults.push({ ...fault, ...check });
  });
  const readyPose = attempt("readyPose", () => parseReadyPose(pack.readyPose, options));

  if (issues.length > 0 || !readyPose) return { success: false, issues };
  return { success: true, value: { pack, faults, readyPose } };
}

export function loadRulePack(input: unknown): LoadedRulePack {
  const r = safeLoadRulePack(input);
  if (!r.success) throw new RulePackError(r.issues);
  return r.value;
}
