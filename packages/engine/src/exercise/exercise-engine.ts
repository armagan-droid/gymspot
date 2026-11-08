import { type EngineEvent, type Frame, LANDMARK_NAMES, type LandmarkName, type View } from "@gymspot/shared";
import { collectMetrics } from "../expr/collect";
import { evaluate } from "../expr/evaluate";
import type { Expr } from "../expr/parse";
import { type MetricComputer, type Side, createMetricComputer, resolveLandmark } from "../metrics/compute";
import { createMetricSmoother } from "../metrics/smoothing";
import { RepCounter, classifyAttempt } from "../reps/rep-counter";
import type { CompiledFault, LoadedRulePack } from "../rules/load-rule-pack";

// Frame → EngineEvent pipeline for one exercise set (specs/04, 05):
// metrics → smoothing → rep counter → fault detection → cue rules → safety pause.

export interface ExerciseSetup {
  /** Dominant view for this set (from setup, specs/04 "Görünüm"). */
  view: View;
  nearSide: Side;
}

export interface ExerciseEngineOptions {
  /** Gym setting (C8): pause on a major fault in two consecutive attempts. Default true. */
  safetyPause?: boolean;
  /** Low visibility duration before TRACKING_LOST. Default 1000 ms. */
  trackingLostAfterMs?: number;
}

const INDEX = new Map(LANDMARK_NAMES.map((n, i) => [n, i]));

/** Whether a fault with these views is evaluated in the set's view (specs/04): ambiguous → only faults valid in every view. */
export function faultEnabledInView(views: readonly ("front" | "side")[], view: View): boolean {
  return view === "ambiguous" ? views.length > 1 : views.includes(view);
}

interface FaultRuntime {
  fault: CompiledFault;
  landmarks: number[];
  /** Allowed in this set's view. */
  enabled: boolean;
}

interface FrameRecord {
  values: Record<string, number>;
  visible: boolean[];
}

interface Attempt {
  frames: Map<number, FrameRecord>;
  detected: Set<number>;
  holdSince: (number | undefined)[];
  /** during_rep detections waiting for the attempt to be confirmed. */
  pending: number[];
  confirmed: boolean;
  safetyEmitted: boolean;
}

export class ExerciseEngine {
  private readonly computer: MetricComputer;
  private readonly smooth: ReturnType<typeof createMetricSmoother>;
  private readonly counter: RepCounter;
  private readonly faults: FaultRuntime[];
  private readonly readyPose: { expr: Expr; durationMs: number; landmarks: number[] };
  private readonly trackingLandmarks: number[];
  private readonly minVisibility: number;
  private readonly safetyPause: boolean;
  private readonly trackingLostAfterMs: number;
  private readonly near: Side;

  private cuesEnabled = true;
  private attempt: Attempt | undefined;
  private streak: number[];
  private lastCueAt: number[];
  private readySince: number | undefined;
  private readyFired = false;
  private lowSince: number | undefined;
  private trackingLost = false;

  constructor(
    private readonly loaded: LoadedRulePack,
    setup: ExerciseSetup,
    options: ExerciseEngineOptions = {},
  ) {
    const { pack } = loaded;
    this.near = setup.nearSide;
    this.computer = createMetricComputer(pack.metrics);
    this.smooth = createMetricSmoother(this.computer.order, pack.smoothing);
    this.counter = new RepCounter(pack.rep);
    this.minVisibility = pack.camera.minVisibility;
    this.safetyPause = options.safetyPause ?? true;
    this.trackingLostAfterMs = options.trackingLostAfterMs ?? 1000;

    const landmarksOf = (expr: Expr) => {
      const set = new Set<LandmarkName>();
      for (const m of collectMetrics(expr)) for (const l of this.computer.landmarksOf(m, setup.nearSide)) set.add(l);
      return [...set].map((l) => INDEX.get(l)!);
    };
    this.faults = loaded.faults.map((fault) => {
      const enabled = faultEnabledInView(fault.views ?? pack.camera.views, setup.view);
      return { fault, landmarks: landmarksOf(fault.expr), enabled };
    });
    this.readyPose = { ...loaded.readyPose, landmarks: landmarksOf(loaded.readyPose.expr) };
    this.trackingLandmarks = pack.camera.minVisibleLandmarks.map((r) => INDEX.get(resolveLandmark(r, setup.nearSide))!);
    this.streak = this.faults.map(() => 0);
    this.lastCueAt = this.faults.map(() => -Infinity);
  }

  /** Cues are off during rest, countdown and pause (specs/05). */
  setCuesEnabled(enabled: boolean): void {
    this.cuesEnabled = enabled;
  }

  /** Starts a new set: rep state and consecutive-attempt streaks are cleared. */
  reset(): void {
    this.counter.reset();
    this.attempt = undefined;
    this.streak = this.faults.map(() => 0);
  }

  push(frame: Frame): EngineEvent[] {
    const t = frame.t;
    const events: EngineEvent[] = [];
    const visibleAll = (idx: number[]) => idx.every((i) => frame.image[i]!.visibility >= this.minVisibility);

    // tracking loss means the person is out of view, not a blurry frame: half the setup threshold (specs/04)
    this.trackTracking(t, this.trackingLandmarks.every((i) => frame.image[i]!.visibility >= this.minVisibility / 2), events);

    const values = this.smooth(this.computer.compute(frame, this.near), t);
    const visible = this.faults.map((f) => visibleAll(f.landmarks));

    this.trackReadyPose(t, values, visibleAll(this.readyPose.landmarks), events);

    const before = this.counter.state;
    const repEvents = this.counter.push(t, values);
    const after = this.counter.state;

    if (before !== "IN_REP" && after === "IN_REP") {
      this.attempt = {
        frames: new Map(),
        detected: new Set(),
        holdSince: this.faults.map(() => undefined),
        pending: [],
        confirmed: false,
        safetyEmitted: false,
      };
    }
    const attempt = this.attempt;
    if (attempt) {
      attempt.frames.set(t, { values, visible });
      if (after === "IN_REP") this.evaluateDuringRep(attempt, t, values, visible, events);
    }

    for (const e of repEvents) {
      if (e.type === "REP_STARTED") {
        events.push({ type: "REP_STARTED" });
        if (attempt) {
          attempt.confirmed = true;
          this.announce(attempt, attempt.pending, t, events);
          attempt.pending = [];
        }
      } else if (attempt) {
        const at = (when: number) => attempt.frames.get(when);
        const candidates: number[] = [];
        this.faults.forEach((f, i) => {
          if (!f.enabled || attempt.detected.has(i) || f.fault.position === "during_rep") return;
          const rec = at(f.fault.position === "at_turn" ? e.turn.t : e.start.t);
          if (rec && rec.visible[i] && evaluate(f.fault.expr, rec.values) === true) {
            attempt.detected.add(i);
            candidates.push(i);
          }
        });
        this.announce(attempt, candidates, t, events);

        const detected = [...attempt.detected].sort((a, b) => a - b);
        const hasValidityFault = detected.some((i) => this.faults[i]!.fault.affectsValidity);
        const outcome = classifyAttempt({ reachedTarget: e.reachedTarget, durationMs: e.durationMs, hasValidityFault }, this.loaded.pack.rep);
        events.push({
          type: "REP_COMPLETED",
          outcome,
          faults: detected.map((i) => this.faults[i]!.fault.id),
          durationMs: Math.round(e.durationMs),
        });
        this.checkSafety(attempt, detected, events);
        this.streak = this.streak.map((s, i) => (attempt.detected.has(i) ? s + 1 : 0));
        this.attempt = undefined;
      }
    }

    // Left the rep without a confirmed attempt: it was noise.
    if (before === "IN_REP" && after !== "IN_REP" && this.attempt === attempt) this.attempt = undefined;
    return events;
  }

  private evaluateDuringRep(attempt: Attempt, t: number, values: Record<string, number>, visible: boolean[], events: EngineEvent[]) {
    const newly: number[] = [];
    this.faults.forEach((f, i) => {
      if (!f.enabled || f.fault.position !== "during_rep" || attempt.detected.has(i)) return;
      const truth = visible[i] ? evaluate(f.fault.expr, values) : undefined;
      if (truth !== true) {
        attempt.holdSince[i] = undefined;
        return;
      }
      const since = (attempt.holdSince[i] ??= t);
      if (t - since >= (f.fault.holdMs ?? 0)) {
        attempt.detected.add(i);
        newly.push(i);
      }
    });
    if (newly.length === 0) return;
    if (attempt.confirmed) {
      this.announce(attempt, newly, t, events);
    } else {
      attempt.pending.push(...newly);
    }
  }

  /** Applies cue rules to simultaneous candidates and the during-rep safety check. */
  private announce(attempt: Attempt, candidates: number[], t: number, events: EngineEvent[]) {
    if (candidates.length === 0) return;
    if (this.cuesEnabled) {
      const eligible = candidates.filter((i) => {
        const f = this.faults[i]!.fault;
        return this.streak[i]! + 1 >= f.minConsecutiveReps && t - this.lastCueAt[i]! >= f.cooldownMs;
      });
      const best = eligible.sort((a, b) => this.priority(a) - this.priority(b))[0];
      if (best !== undefined) {
        this.lastCueAt[best] = t;
        events.push({ type: "FAULT_DETECTED", faultId: this.faults[best]!.fault.id });
      }
    }
    // during_rep detections can stop the set immediately; at_turn/at_start wait for REP_COMPLETED
    if (this.counter.state === "IN_REP") this.checkSafety(attempt, candidates, events);
  }

  private checkSafety(attempt: Attempt, detected: number[], events: EngineEvent[]) {
    if (!this.safetyPause || attempt.safetyEmitted) return;
    const hit = detected.find((i) => this.faults[i]!.fault.severity === "major" && this.streak[i]! >= 1);
    if (hit !== undefined) {
      attempt.safetyEmitted = true;
      events.push({ type: "SAFETY_PAUSE", faultId: this.faults[hit]!.fault.id });
    }
  }

  /** Lower is more important: major before minor, then rule pack order. */
  private priority(i: number): number {
    return (this.faults[i]!.fault.severity === "major" ? 0 : 1) * 1000 + i;
  }

  private trackTracking(t: number, visible: boolean, events: EngineEvent[]) {
    if (!visible) {
      this.lowSince ??= t;
      if (!this.trackingLost && t - this.lowSince >= this.trackingLostAfterMs) {
        this.trackingLost = true;
        events.push({ type: "TRACKING_LOST" });
      }
      return;
    }
    this.lowSince = undefined;
    if (this.trackingLost) {
      this.trackingLost = false;
      events.push({ type: "TRACKING_RESTORED" });
    }
  }

  private trackReadyPose(t: number, values: Record<string, number>, visible: boolean, events: EngineEvent[]) {
    if (!(visible && evaluate(this.readyPose.expr, values) === true)) {
      this.readySince = undefined;
      this.readyFired = false;
      return;
    }
    this.readySince ??= t;
    if (!this.readyFired && t - this.readySince >= this.readyPose.durationMs) {
      this.readyFired = true;
      events.push({ type: "READY_POSE_HELD" });
    }
  }
}
