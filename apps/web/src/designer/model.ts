import {
  type CompareOp,
  type Expr,
  type FaultSuggestion,
  type RepSuggestion,
  type ValueNode,
  parseCheck,
  parseExpression,
  parseReadyPose,
} from "@gymspot/engine";
import { CHECK_POSITIONS, type CheckPosition, type RulePack } from "@gymspot/shared";

// Exercise designer model (specs/11): the form's view of a rule pack. Pure;
// the pack JSON stays the single source of truth, the form reads and writes it.

export type Definition = Record<string, unknown>;

/** Gym exercise ids (specs/11 "Kimlik"). */
export const GYM_EXERCISE_ID = /^t_[a-z0-9_]{2,40}$/;

const ASCII: Record<string, string> = { ç: "c", ğ: "g", ı: "i", i: "i", ö: "o", ş: "s", ü: "u", â: "a", î: "i", û: "u" };

/** "Sumo Squat (geniş)" → "t_sumo_squat_genis". */
export function gymExerciseId(name: string): string {
  const slug = name
    .toLocaleLowerCase("tr")
    .replace(/[çğıiöşüâîû]/g, (c) => ASCII[c] ?? c)
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40)
    .replace(/_+$/, "");
  return `t_${slug.length >= 2 ? slug : `${slug}x`.padEnd(2, "x")}`;
}

// ------------------------------------------------------------ starting points

/** Blank starters (specs/11): built from a reference pack without its faults. */
export const STARTERS = [
  { id: "joint", from: "squat" },
  { id: "head", from: "slip" },
  { id: "strike", from: "straight_punch" },
] as const;
export type StarterId = (typeof STARTERS)[number]["id"];

/** A new draft from an existing pack: new id and name, version 1, uncalibrated. */
export function startFrom(source: RulePack, id: string, name: { tr: string; en: string }, keepFaults: boolean): Definition {
  const copy = structuredClone(source) as unknown as Definition;
  copy.id = id;
  copy.version = 1;
  copy.status = "draft";
  copy.name = name;
  if (!keepFaults) {
    copy.faults = [];
    delete copy.howTo;
  }
  return copy;
}

// ------------------------------------------------------------ path editing

export type Path = readonly (string | number)[];

export function getIn(obj: unknown, path: Path): unknown {
  let cur = obj;
  for (const k of path) {
    if (cur === null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string | number, unknown>)[k];
  }
  return cur;
}

/** Copy with the value at path replaced (undefined deletes it); creates objects on the way. */
export function setIn<T>(obj: T, path: Path, value: unknown): T {
  if (path.length === 0) return value as T;
  const [k, ...rest] = path;
  const base = (Array.isArray(obj) ? [...(obj as unknown[])] : obj && typeof obj === "object" ? { ...(obj as object) } : {}) as Record<string | number, unknown>;
  const next = setIn(base[k!], rest, value);
  if (next === undefined && rest.length === 0) {
    if (Array.isArray(base)) (base as unknown[]).splice(k as number, 1);
    else delete base[k!];
  } else base[k!] = next;
  return base as T;
}

/** Validation issues ("path: message") under a path prefix such as "rep" or "faults.0". */
export function issuesUnder(issues: readonly string[], prefix: string): string[] {
  return issues.filter((i) => {
    const path = i.slice(0, i.indexOf(":"));
    return path === prefix || path.startsWith(`${prefix}.`);
  });
}

// ------------------------------------------------------------ condition builder

/** A side of a comparison the builder can show: a number, a metric, or min/max/avg/abs of metrics. */
export type Operand =
  | { kind: "number"; value: number }
  | { kind: "metric"; name: string }
  | { kind: "call"; fn: "min" | "max" | "avg" | "abs"; metrics: string[] };

export interface Clause {
  left: Operand;
  op: CompareOp;
  right: Operand;
}

/** Clauses joined by one connective; anything richer stays a text expression (specs/11). */
export interface Condition {
  join: "and" | "or";
  clauses: Clause[];
}

const operandToText = (o: Operand): string =>
  o.kind === "number" ? formatNumber(o.value) : o.kind === "metric" ? o.name : `${o.fn}(${o.metrics.join(", ")})`;

export function formatNumber(n: number): string {
  // expression numbers have no exponent (04 grammar)
  const s = String(n);
  return /e/i.test(s) ? n.toFixed(10).replace(/0+$/, "").replace(/\.$/, "") : s;
}

export function conditionToText(c: Condition): string {
  return c.clauses.map((cl) => `${operandToText(cl.left)} ${cl.op} ${operandToText(cl.right)}`).join(` ${c.join} `);
}

function operandFromNode(n: ValueNode): Operand | null {
  if (n.kind === "number") return { kind: "number", value: n.value };
  if (n.kind === "metric") return { kind: "metric", name: n.name };
  if (!n.args.every((a) => a.kind === "metric")) return null;
  return { kind: "call", fn: n.fn, metrics: n.args.map((a) => (a as { name: string }).name) };
}

/** The builder form of a parsed expression, or null when it does not fit. */
export function conditionFromExpr(expr: Expr): Condition | null {
  const join = expr.kind === "and" || expr.kind === "or" ? expr.kind : "and";
  const clauses: Clause[] = [];
  const walk = (e: Expr): boolean => {
    if (e.kind === join && (e.kind === "and" || e.kind === "or")) return walk(e.left) && walk(e.right);
    if (e.kind !== "compare") return false;
    const left = operandFromNode(e.left);
    const right = operandFromNode(e.right);
    if (!left || !right) return false;
    clauses.push({ left, op: e.op, right });
    return true;
  };
  return walk(expr) ? { join, clauses } : null;
}

/** Builder form of an expression text; null if it does not parse or does not fit. */
export function conditionFromText(src: string): Condition | null {
  try {
    return conditionFromExpr(parseExpression(src));
  } catch {
    return null;
  }
}

export interface CheckForm {
  position: CheckPosition;
  /** null: the expression is shown as text (edited in the JSON view). */
  condition: Condition | null;
  text: string;
}

export function checkFromText(check: string): CheckForm {
  const colon = check.indexOf(":");
  const position = (CHECK_POSITIONS as readonly string[]).includes(check.slice(0, colon)) ? (check.slice(0, colon) as CheckPosition) : "at_turn";
  const text = check.slice(colon + 1).trim();
  try {
    return { position, condition: conditionFromExpr(parseCheck(check).expr), text };
  } catch {
    return { position, condition: null, text };
  }
}

export const checkToText = (position: CheckPosition, condition: Condition | string): string =>
  `${position}: ${typeof condition === "string" ? condition : conditionToText(condition)}`;

export interface ReadyPoseForm {
  condition: Condition | null;
  text: string;
  durationMs: number;
}

export function readyPoseFromText(src: string): ReadyPoseForm {
  const m = /^(.*)\sfor\s+(\d+)ms$/.exec(src.trim());
  const text = m ? m[1]!.trim() : src;
  const durationMs = m ? Number(m[2]) : 1000;
  try {
    return { condition: conditionFromExpr(parseReadyPose(src).expr), text, durationMs };
  } catch {
    return { condition: null, text, durationMs };
  }
}

export const readyPoseToText = (condition: Condition | string, durationMs: number): string =>
  `${typeof condition === "string" ? condition : conditionToText(condition)} for ${Math.max(1, Math.round(durationMs))}ms`;

// ------------------------------------------------------------ suggestions (specs/11)

const withMetric = (def: Definition, name: string, definition: unknown): Definition =>
  getIn(def, ["metrics", name]) === undefined ? setIn(def, ["metrics", name], definition) : def;

/** Uses the suggested repetition measure (added if it was a candidate) and its zones. */
export function applyRepSuggestion(def: Definition, s: RepSuggestion): Definition {
  return setIn(withMetric(def, s.metric, s.definition), ["rep"], structuredClone(s.rep));
}

/** Adds the suggested condition as a new fault; staff name it and write its cue. */
export function addFaultSuggestion(def: Definition, f: FaultSuggestion): Definition {
  const faults = (getIn(def, ["faults"]) as unknown[] | undefined) ?? [];
  const ids = new Set(faults.map((x) => (x as { id?: string }).id));
  let n = faults.length + 1;
  while (ids.has(`fault_${n}`)) n++;
  return setIn(withMetric(def, f.metric, f.definition), ["faults"], [
    ...faults,
    {
      id: `fault_${n}`,
      name: { tr: "", en: "" },
      severity: "minor",
      check: f.check,
      cue: { tr: "", en: "" },
      affectsValidity: true,
      cooldownMs: 4000,
      minConsecutiveReps: 1,
    },
  ]);
}
