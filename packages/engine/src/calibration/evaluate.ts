import type { LandmarkSequence, RepLabel, RepOutcome } from "@gymspot/shared";
import { ExerciseEngine } from "../exercise/exercise-engine";
import { chooseNearSide } from "../metrics/compute";
import { loadRulePack } from "../rules/load-rule-pack";

// Pilot calibration metrics — specs/09 "Pilot kabul kriterleri" and T5.3.
// Replays labeled landmark sequences through the engine and compares.

export interface AttemptComparison {
  index: number;
  predicted?: { outcome: RepOutcome; faults: string[] };
  label?: RepLabel;
}

export interface CueComparison {
  /** Attempt the cue belongs to (the attempt in progress or just completed). */
  attempt: number;
  faultId: string;
  correct: boolean;
}

export interface SequenceEvaluation {
  exerciseId: string;
  attempts: AttemptComparison[];
  cues: CueComparison[];
  /** Reps counted in strict mode (valid only). */
  labeledCount: number;
  predictedCount: number;
}

export function evaluateSequence(rulePackJson: unknown, seq: LandmarkSequence): SequenceEvaluation {
  if (!seq.labels) throw new Error("sequence has no labels");
  const loaded = loadRulePack(rulePackJson);
  const engine = new ExerciseEngine(loaded, { view: seq.view, nearSide: chooseNearSide(seq.frames.slice(0, 30)) }, { safetyPause: false });
  const predicted: { outcome: RepOutcome; faults: string[] }[] = [];
  const cues: { attempt: number; faultId: string }[] = [];
  for (const frame of seq.frames) {
    for (const e of engine.push(frame)) {
      if (e.type === "REP_COMPLETED") predicted.push({ outcome: e.outcome, faults: [...e.faults] });
      else if (e.type === "FAULT_DETECTED") cues.push({ attempt: predicted.length, faultId: e.faultId });
    }
  }
  const labels = seq.labels.reps;
  const n = Math.max(predicted.length, labels.length);
  return {
    exerciseId: seq.exerciseId,
    attempts: Array.from({ length: n }, (_, index) => ({
      index,
      ...(predicted[index] && { predicted: predicted[index] }),
      ...(labels[index] && { label: labels[index] }),
    })),
    cues: cues.map((c) => ({ ...c, correct: Boolean(labels[c.attempt]?.faults.includes(c.faultId)) })),
    labeledCount: labels.filter((l) => l.outcome === "valid").length,
    predictedCount: predicted.filter((p) => p.outcome === "valid").length,
  };
}

export interface CalibrationSummary {
  sequences: number;
  attempts: number;
  /** Mean over sequences (sets) of 1 − |counted − labeled| / labeled. */
  countAccuracy: number;
  /** Cues for faults not in the label / all cues (0 when there were no cues). */
  falseAlarmRate: number;
  faults: Record<string, { hits: number; misses: number; falseAlarms: number }>;
  /** specs/09 targets: ≥ 95% counting, ≤ 10% false alarms. */
  meetsTargets: boolean;
}

export function summarize(evals: readonly SequenceEvaluation[]): CalibrationSummary {
  const perSet = evals.map((e) => (e.labeledCount === 0 ? (e.predictedCount === 0 ? 1 : 0) : Math.max(0, 1 - Math.abs(e.predictedCount - e.labeledCount) / e.labeledCount)));
  const cues = evals.flatMap((e) => e.cues);
  const faults: CalibrationSummary["faults"] = {};
  const f = (id: string) => (faults[id] ??= { hits: 0, misses: 0, falseAlarms: 0 });
  for (const e of evals) {
    for (const a of e.attempts) {
      const labeledFaults = new Set(a.label?.faults ?? []);
      const predictedFaults = new Set(a.predicted?.faults ?? []);
      for (const id of labeledFaults) {
        if (predictedFaults.has(id)) f(id).hits++;
        else f(id).misses++;
      }
      for (const id of predictedFaults) if (!labeledFaults.has(id)) f(id).falseAlarms++;
    }
  }
  const countAccuracy = perSet.length ? perSet.reduce((s, x) => s + x, 0) / perSet.length : 0;
  const falseAlarmRate = cues.length ? cues.filter((c) => !c.correct).length / cues.length : 0;
  return {
    sequences: evals.length,
    attempts: evals.reduce((s, e) => s + e.attempts.length, 0),
    countAccuracy,
    falseAlarmRate,
    faults,
    meetsTargets: countAccuracy >= 0.95 && falseAlarmRate <= 0.1,
  };
}

/**
 * Returns a copy of a rule pack with one parameter changed:
 * `rep.<...>` sets a numeric field, `faults.<id>.threshold` replaces the
 * last number in that fault's check expression.
 */
export function withParameter<T>(rulePackJson: T, path: string, value: number): T {
  const pack = JSON.parse(JSON.stringify(rulePackJson)) as Record<string, unknown> & { faults: { id: string; check: string }[] };
  const parts = path.split(".");
  if (parts[0] === "faults" && parts[2] === "threshold") {
    const fault = pack.faults.find((x) => x.id === parts[1]);
    if (!fault) throw new Error(`no fault '${parts[1]}'`);
    const numbers = [...fault.check.matchAll(/-?\d+(\.\d+)?/g)];
    const last = numbers.at(-1);
    if (!last || last.index === undefined) throw new Error(`fault '${parts[1]}' has no threshold`);
    fault.check = fault.check.slice(0, last.index) + String(value) + fault.check.slice(last.index + last[0].length);
    return pack as T;
  }
  let node = pack as Record<string, unknown>;
  for (const key of parts.slice(0, -1)) {
    const next = node[key];
    if (!next || typeof next !== "object") throw new Error(`no parameter '${path}'`);
    node = next as Record<string, unknown>;
  }
  const leaf = parts.at(-1)!;
  if (typeof node[leaf] !== "number") throw new Error(`no numeric parameter '${path}'`);
  node[leaf] = value;
  return pack as T;
}

export type SweepRow = { value: number; summary: CalibrationSummary } | { value: number; error: string };

/** Candidate values that make the rule pack invalid are reported, not thrown. */
export function sweep(rulePackJson: unknown, sequences: readonly LandmarkSequence[], path: string, values: readonly number[]): SweepRow[] {
  return values.map((value) => {
    const pack = withParameter(rulePackJson, path, value);
    try {
      return { value, summary: summarize(sequences.map((s) => evaluateSequence(pack, s))) };
    } catch (e) {
      return { value, error: e instanceof Error ? e.message.split(/\r?\n/).slice(0, 3).join(" ") : String(e) };
    }
  });
}
