import type { RepOutcome, RulePack } from "@gymspot/shared";

// Rep state machine — specs/04 "Tekrar algılama". Works on the (smoothed)
// rep metric; increasing movements are handled by flipping the sign so that
// every movement looks like a decreasing one internally.

type RepConfig = RulePack["rep"];

export interface Snapshot {
  t: number;
  values: Record<string, number>;
}

export interface AttemptCompleted {
  type: "ATTEMPT_COMPLETED";
  /** Time the metric re-entered the start zone. */
  t: number;
  durationMs: number;
  reachedTarget: boolean;
  /** Frame where the metric left the start zone (`at_start`). */
  start: Snapshot;
  /** Frame with the most extreme rep metric value (`at_turn`). */
  turn: Snapshot & { value: number };
}

export type RepCounterEvent = { type: "REP_STARTED"; t: number } | AttemptCompleted;

export type RepCounterState = "WAITING" | "AT_START" | "IN_REP";

export class RepCounter {
  private readonly sign: 1 | -1;
  private readonly startEnter: number;
  private readonly startExit: number;
  private readonly targetEnter: number;
  private readonly confirmAt: number;

  private _state: RepCounterState = "WAITING";
  private start: Snapshot | undefined;
  private turn: (Snapshot & { value: number }) | undefined;
  private reachedTarget = false;
  private confirmed = false;

  constructor(private readonly rep: RepConfig) {
    this.sign = rep.start.enter > rep.target.enter ? 1 : -1;
    const s = this.sign;
    this.startEnter = s * rep.start.enter;
    this.startExit = s * rep.start.exit;
    this.targetEnter = s * rep.target.enter;
    this.confirmAt = s * rep.start.exit - rep.attemptMinExcursion;
  }

  get state(): RepCounterState {
    return this._state;
  }

  reset(): void {
    this._state = "WAITING";
    this.start = undefined;
    this.turn = undefined;
  }

  /** Feeds one frame's metric values (must contain `rep.metric`). */
  push(t: number, values: Readonly<Record<string, number>>): RepCounterEvent[] {
    const v = values[this.rep.metric];
    if (typeof v !== "number" || Number.isNaN(v)) return [];
    const x = this.sign * v;
    const events: RepCounterEvent[] = [];

    if (this._state === "WAITING") {
      if (x >= this.startEnter) this._state = "AT_START";
      return events;
    }

    if (this._state === "AT_START") {
      if (x >= this.startExit) return events;
      this._state = "IN_REP";
      this.start = { t, values: { ...values } };
      this.turn = { t, values: { ...values }, value: v };
      this.reachedTarget = false;
      this.confirmed = false;
    } else if (x >= this.startEnter) {
      this._state = "AT_START";
      if (this.confirmed) {
        events.push({
          type: "ATTEMPT_COMPLETED",
          t,
          durationMs: t - this.start!.t,
          reachedTarget: this.reachedTarget,
          start: this.start!,
          turn: this.turn!,
        });
      }
      return events;
    } else if (x < this.sign * this.turn!.value) {
      this.turn = { t, values: { ...values }, value: v };
    }

    if (x <= this.targetEnter) this.reachedTarget = true;
    if (!this.confirmed && x <= this.confirmAt) {
      this.confirmed = true;
      events.push({ type: "REP_STARTED", t });
    }
    return events;
  }
}

export interface AttemptClassificationInput {
  reachedTarget: boolean;
  durationMs: number;
  /** Any fault with affectsValidity detected in this attempt. */
  hasValidityFault: boolean;
}

/** Outcome table from specs/04 (duration out of range always wins). */
export function classifyAttempt(
  a: AttemptClassificationInput,
  rep: Pick<RepConfig, "minDurationMs" | "maxDurationMs">,
): RepOutcome {
  if (a.durationMs < rep.minDurationMs || a.durationMs > rep.maxDurationMs) return "incomplete";
  if (a.hasValidityFault) return "faulty";
  return a.reachedTarget ? "valid" : "incomplete";
}
