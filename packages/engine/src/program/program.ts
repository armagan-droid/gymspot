import type {
  Fault,
  ProgramInput,
  RepOutcome,
  SessionBlockRecord,
  SessionCursor,
  SessionRecord,
  SetRecord,
  RepEventRecord,
  UserActionKind,
  Workout,
} from "@gymspot/shared";
import { summarizeSet } from "../exercise/summary";

// Program / session state machine — specs/03-program-engine.md.
// Pure reducer: step(state, input, deps) → { state, commands }. Time only
// advances through TICK; every other input is processed at the last TICK time.

export type ProgramStatus =
  | "IDLE"
  | "CHECKIN"
  | "READY"
  | "COUNTDOWN"
  | "SET_ACTIVE"
  | "SET_CONFIRM"
  | "REST"
  | "TRANSFER"
  | "PAUSED"
  | "SESSION_DONE"
  | "ABORTED"
  | "ABANDONED";

export const PROGRAM_TIMING = {
  countdownMs: 3_000,
  inactivityPromptMs: 10_000,
  inactivityCloseMs: 20_000,
  trackingPauseMs: 5_000,
  transferPauseMs: 30 * 60_000,
  transferAbandonMs: 2 * 60 * 60_000,
} as const;

/**
 * i18n keys used in SPEAK/SHOW commands (besides `cue.<exerciseId>.<faultId>`,
 * whose text comes from the rule pack). The web app must translate every key.
 */
export const PROGRAM_MESSAGE_KEYS = {
  countdown: "countdown.start",
  setGo: "set.go",
  restOver: "rest.over",
  setDonePrompt: "prompt.set_done",
  resumePrompt: "prompt.resume",
  safetyStop: "safety.stop",
  sessionDone: "session.done",
  setSummary: "summary.set",
  returnToPhone: "handoff.return_to_phone",
} as const;
const K = PROGRAM_MESSAGE_KEYS;

export interface ProgramConfig {
  /** owner = member's phone; executor = station tablet running one delegated block. */
  role: "owner" | "executor";
  workout: Workout;
  sessionId: string;
  memberId: string;
  memberProgramId: string;
  workoutDayIndex: number;
  deviceId: string;
  stationId?: string;
  /** Rule pack faults per exercise, for set summary tie-breaks (specs/05). */
  faults?: Record<string, Pick<Fault, "id" | "severity">[]>;
}

export type PersistRecord =
  | { kind: "session"; data: SessionRecord }
  | { kind: "session_block"; data: SessionBlockRecord }
  | { kind: "set"; data: SetRecord }
  | { kind: "rep"; data: RepEventRecord };

export type ProgramCommand =
  | { type: "SPEAK"; key: string }
  | { type: "SHOW"; key: string; params?: Record<string, string | number> }
  | { type: "NAVIGATE_TO_STATION"; stationHint: string }
  | { type: "SHOW_HANDOFF_QR"; cursor: SessionCursor }
  | { type: "PERSIST_EVENT"; record: PersistRecord };

interface SetProgress {
  id: string;
  startedAt: number;
  attempts: { outcome: RepOutcome; faults: string[] }[];
  counted: number;
  lastActivityAt: number;
}

interface PendingSkip {
  blockIndex: number;
  setIndex: number;
  blockId: string;
  setsDone: number;
  status: "skipped" | "partial";
}

export interface ProgramState {
  v: 1;
  config: ProgramConfig;
  status: ProgramStatus;
  now: number;
  cursor: { blockIndex: number; setIndex: number };
  block?: { id: string; setsDone: number };
  set?: SetProgress;
  resumeTo?: ProgramStatus;
  countdownEndsAt?: number;
  restEndsAt?: number;
  restRemainingMs?: number;
  trackingLostAt?: number;
  transferSince?: number;
  pendingSkip?: PendingSkip;
  sessionStartedAt?: number;
}

export interface ProgramDeps {
  newId(): string;
}

const TERMINAL: ReadonlySet<ProgramStatus> = new Set(["SESSION_DONE", "ABORTED", "ABANDONED"]);

export function createProgram(config: ProgramConfig, now: number): ProgramState {
  return {
    v: 1,
    config,
    status: config.role === "owner" ? "IDLE" : "CHECKIN",
    now,
    cursor: { blockIndex: 0, setIndex: 0 },
  };
}

export function serializeProgram(state: ProgramState): string {
  return JSON.stringify(state);
}

export function deserializeProgram(json: string): ProgramState {
  const s = JSON.parse(json) as Partial<ProgramState>;
  if (s?.v !== 1 || typeof s.status !== "string" || !s.config || typeof s.now !== "number" || !s.cursor) {
    throw new Error("unsupported program state");
  }
  return s as ProgramState;
}

/** Whether an attempt counts toward the set target (specs/03 rule 3). */
export function countsTowardTarget(outcome: RepOutcome, mode: "strict" | "lenient"): boolean {
  return outcome === "valid" || (outcome === "faulty" && mode === "lenient");
}

export function step(prev: ProgramState, input: ProgramInput, deps: ProgramDeps): { state: ProgramState; commands: ProgramCommand[] } {
  // State is plain JSON (AC-3.5); a JSON round-trip copies it without DOM/Node globals.
  const m = new Machine(JSON.parse(JSON.stringify(prev)) as ProgramState, deps);
  const handled = m.handle(input);
  return handled ? { state: m.s, commands: m.out } : { state: prev, commands: [] };
}

class Machine {
  out: ProgramCommand[] = [];

  constructor(
    public s: ProgramState,
    private readonly deps: ProgramDeps,
  ) {}

  // ------------------------------------------------------------ helpers

  private get cfg() {
    return this.s.config;
  }
  private blockAt(i: number) {
    return this.cfg.workout.blocks[i];
  }
  private get blk() {
    return this.blockAt(this.s.cursor.blockIndex)!;
  }
  private iso(ms: number) {
    return new Date(ms).toISOString();
  }
  private speak(key: string) {
    this.out.push({ type: "SPEAK", key });
  }
  private show(key: string, params?: Record<string, string | number>) {
    this.out.push(params ? { type: "SHOW", key, params } : { type: "SHOW", key });
  }
  private persist(record: PersistRecord) {
    this.out.push({ type: "PERSIST_EVENT", record });
  }

  private sessionRecord(status: SessionRecord["status"]): void {
    const c = this.cfg;
    this.persist({
      kind: "session",
      data: {
        id: c.sessionId,
        memberId: c.memberId,
        memberProgramId: c.memberProgramId,
        workoutDayIndex: c.workoutDayIndex,
        startedAt: this.iso(this.s.sessionStartedAt ?? this.s.now),
        ...(status !== "active" && { endedAt: this.iso(this.s.now) }),
        status,
      },
    });
  }

  private blockRecord(blockIndex: number, id: string, status: SessionBlockRecord["status"]): void {
    const b = this.blockAt(blockIndex)!;
    this.persist({
      kind: "session_block",
      data: {
        id,
        sessionId: this.cfg.sessionId,
        position: blockIndex,
        exerciseId: b.exerciseId,
        exerciseVersion: b.exerciseVersion,
        plannedSets: b.sets,
        executedByDeviceId: this.cfg.deviceId,
        ...(this.cfg.stationId && { stationId: this.cfg.stationId }),
        status,
      },
    });
  }

  private flushPendingSkip(): void {
    const p = this.s.pendingSkip;
    if (!p) return;
    this.blockRecord(p.blockIndex, p.blockId, p.status);
    this.s.pendingSkip = undefined;
  }

  private enterBlock(index: number, setIndex = 0): void {
    this.s.cursor = { blockIndex: index, setIndex };
    this.s.block = { id: this.deps.newId(), setsDone: setIndex };
    this.s.set = undefined;
    this.s.restEndsAt = undefined;
  }

  /** NEXT_BLOCK_READY (rule 7). */
  private nextBlock(index: number): void {
    if (index >= this.cfg.workout.blocks.length) return this.sessionDone();
    this.enterBlock(index);
    const hint = this.blockAt(index)!.stationHint;
    if (this.cfg.role === "owner" && hint !== undefined && hint !== this.blockAt(index - 1)?.stationHint) {
      this.s.status = "TRANSFER";
      this.s.transferSince = this.s.now;
      this.out.push({ type: "SHOW_HANDOFF_QR", cursor: { sessionId: this.cfg.sessionId, blockIndex: index, setIndex: 0 } });
      this.out.push({ type: "NAVIGATE_TO_STATION", stationHint: hint });
    } else {
      this.s.status = "READY";
    }
  }

  private sessionDone(): void {
    this.flushPendingSkip();
    this.s.status = "SESSION_DONE";
    if (this.cfg.role === "owner") this.sessionRecord("done");
    this.speak(K.sessionDone);
  }

  private startCountdown(): void {
    this.s.status = "COUNTDOWN";
    this.s.countdownEndsAt = this.s.now + PROGRAM_TIMING.countdownMs;
    this.speak(K.countdown);
  }

  private enterSetActive(): void {
    this.s.status = "SET_ACTIVE";
    this.s.countdownEndsAt = undefined;
    if (!this.s.set) {
      this.s.set = { id: this.deps.newId(), startedAt: this.s.now, attempts: [], counted: 0, lastActivityAt: this.s.now };
    }
    this.s.set.lastActivityAt = this.s.now;
    this.speak(K.setGo);
  }

  private writeSet(belowTarget: boolean): void {
    const set = this.s.set!;
    const b = this.blk;
    const n = (o: RepOutcome) => set.attempts.filter((a) => a.outcome === o).length;
    this.persist({
      kind: "set",
      data: {
        id: set.id,
        sessionBlockId: this.s.block!.id,
        setIndex: this.s.cursor.setIndex,
        ...(b.reps !== undefined && { plannedReps: b.reps }),
        validReps: n("valid"),
        faultyReps: n("faulty"),
        incompleteReps: n("incomplete"),
        source: "camera",
        belowTarget,
        startedAt: this.iso(set.startedAt),
        endedAt: this.iso(this.s.now),
      },
    });
  }

  /** Rule 4: write the set, show the summary, then REST or BLOCK_DONE. */
  private endSet(byTime = false): void {
    const set = this.s.set!;
    const b = this.blk;
    const belowTarget = b.reps !== undefined ? set.counted < b.reps : !byTime;
    this.writeSet(belowTarget);
    const summary = summarizeSet(set.attempts, this.cfg.faults?.[b.exerciseId] ?? [], b.mode);
    this.show(K.setSummary, {
      counted: summary.counted,
      valid: summary.valid,
      faulty: summary.faulty,
      incomplete: summary.incomplete,
      mostFrequentFault: summary.mostFrequentFault ?? "",
    });
    this.s.set = undefined;
    this.s.block!.setsDone++;
    this.s.cursor.setIndex++;
    if (this.s.block!.setsDone >= b.sets) return this.blockDone();
    this.s.status = "REST";
    this.s.restEndsAt = this.s.now + b.restSec * 1000;
  }

  private blockDone(): void {
    this.blockRecord(this.s.cursor.blockIndex, this.s.block!.id, "done");
    if (this.cfg.role === "executor") {
      this.s.status = "IDLE";
      this.show(K.returnToPhone);
      return;
    }
    this.nextBlock(this.s.cursor.blockIndex + 1);
  }

  private pause(): void {
    this.s.resumeTo = this.s.status;
    if (this.s.status === "REST") this.s.restRemainingMs = Math.max(0, this.s.restEndsAt! - this.s.now);
    this.s.status = "PAUSED";
  }

  private skip(): void {
    this.flushPendingSkip();
    const setsDone = this.s.block!.setsDone;
    this.s.pendingSkip = {
      blockIndex: this.s.cursor.blockIndex,
      setIndex: this.s.cursor.setIndex,
      blockId: this.s.block!.id,
      setsDone,
      status: setsDone > 0 ? "partial" : "skipped",
    };
    this.nextBlock(this.s.cursor.blockIndex + 1);
  }

  private undoSkip(): boolean {
    const p = this.s.pendingSkip;
    if (!p) return false;
    this.s.cursor = { blockIndex: p.blockIndex, setIndex: p.setIndex };
    this.s.block = { id: p.blockId, setsDone: p.setsDone };
    this.s.pendingSkip = undefined;
    this.s.transferSince = undefined;
    this.s.status = "READY";
    return true;
  }

  private handoffReturned(): void {
    this.s.transferSince = undefined;
    this.s.resumeTo = undefined;
    // delegated: the tablet writes this block's records (specs/03 "Kayıtlar")
    this.nextBlock(this.s.cursor.blockIndex + 1);
  }

  private abort(): void {
    const set = this.s.set;
    if (set && set.attempts.length > 0) {
      this.writeSet(true);
      this.s.block!.setsDone++;
    }
    if (this.s.block && this.s.block.setsDone > 0 && this.s.status !== "TRANSFER") {
      this.blockRecord(this.s.cursor.blockIndex, this.s.block.id, "partial");
    }
    this.flushPendingSkip();
    this.s.status = "ABORTED";
    this.s.set = undefined;
    if (this.cfg.role === "owner") this.sessionRecord("aborted");
  }

  private onRep(input: Extract<ProgramInput, { type: "REP_STARTED" | "REP_COMPLETED" }>): void {
    const set = this.s.set!;
    set.lastActivityAt = this.s.now;
    if (input.type === "REP_STARTED") return;
    set.attempts.push({ outcome: input.outcome, faults: [...input.faults] });
    this.persist({
      kind: "rep",
      data: {
        id: this.deps.newId(),
        setId: set.id,
        repIndex: set.attempts.length - 1,
        outcome: input.outcome,
        durationMs: input.durationMs,
        faults: [...input.faults],
      },
    });
    if (countsTowardTarget(input.outcome, this.blk.mode)) set.counted++;
    if (this.blk.reps !== undefined && set.counted >= this.blk.reps) this.endSet();
  }

  // ------------------------------------------------------------ dispatch

  /** Returns false for inputs that are invalid in the current state. */
  handle(input: ProgramInput): boolean {
    const s = this.s;
    if (input.type === "TICK") {
      s.now = Math.max(s.now, input.now);
      this.onTick();
      return true;
    }
    if (TERMINAL.has(s.status)) return false;

    if (input.type === "TRACKING_LOST") {
      s.trackingLostAt ??= s.now;
      return true;
    }
    if (input.type === "TRACKING_RESTORED") {
      s.trackingLostAt = undefined;
      if (s.status === "PAUSED") this.show(K.resumePrompt);
      return true;
    }
    if (input.type === "USER_ACTION") return this.onAction(input.kind);

    switch (s.status) {
      case "CHECKIN":
        if (input.type !== "HANDOFF_ACCEPTED" || input.cursor.sessionId !== this.cfg.sessionId) return false;
        if (!this.blockAt(input.cursor.blockIndex)) return false;
        this.enterBlock(input.cursor.blockIndex, input.cursor.setIndex);
        s.status = "READY";
        return true;
      case "READY":
        if (input.type !== "READY_POSE_HELD") return false;
        this.flushPendingSkip();
        this.startCountdown();
        return true;
      case "SET_ACTIVE":
        if (input.type === "REP_STARTED" || input.type === "REP_COMPLETED") {
          this.onRep(input);
          return true;
        }
        if (input.type === "FAULT_DETECTED") {
          const key = `cue.${this.blk.exerciseId}.${input.faultId}`;
          this.speak(key);
          this.show(key);
          return true;
        }
        if (input.type === "SAFETY_PAUSE") {
          this.speak(K.safetyStop);
          this.show(K.safetyStop);
          this.pause();
          return true;
        }
        return false;
      case "SET_CONFIRM":
        if (input.type === "REP_STARTED" || input.type === "REP_COMPLETED") {
          s.status = "SET_ACTIVE";
          this.onRep(input);
          return true;
        }
        return false;
      case "TRANSFER":
        if (input.type !== "HANDOFF_RETURNED") return false;
        this.handoffReturned();
        return true;
      case "PAUSED":
        if (input.type !== "HANDOFF_RETURNED" || s.resumeTo !== "TRANSFER") return false;
        this.handoffReturned();
        return true;
      default:
        return false;
    }
  }

  private onAction(kind: UserActionKind): boolean {
    const s = this.s;
    const st = s.status;
    switch (kind) {
      case "START":
        if (st === "IDLE" && this.cfg.role === "owner" && s.sessionStartedAt === undefined) {
          s.sessionStartedAt = s.now;
          this.sessionRecord("active");
          this.nextBlock(0);
          return true;
        }
        if (st === "READY") {
          this.flushPendingSkip();
          this.startCountdown();
          return true;
        }
        if (st === "TRANSFER") {
          s.transferSince = undefined;
          s.status = "READY";
          return true;
        }
        return false;
      case "READY":
        if (st !== "REST") return false;
        s.restEndsAt = undefined;
        s.status = "READY";
        return true;
      case "PAUSE":
        if (st === "IDLE" || st === "PAUSED") return false;
        this.pause();
        return true;
      case "RESUME": {
        if (st !== "PAUSED") return false;
        const to = s.resumeTo!;
        s.resumeTo = undefined;
        if (s.trackingLostAt !== undefined) s.trackingLostAt = s.now; // fresh grace period
        if (to === "SET_ACTIVE" || to === "SET_CONFIRM") {
          this.startCountdown();
        } else if (to === "REST") {
          s.status = "REST";
          s.restEndsAt = s.now + (s.restRemainingMs ?? 0);
          s.restRemainingMs = undefined;
        } else if (to === "COUNTDOWN") {
          this.startCountdown();
        } else {
          s.status = to;
        }
        return true;
      }
      case "END_SET":
        if (st !== "SET_ACTIVE" && st !== "SET_CONFIRM") return false;
        this.endSet();
        return true;
      case "CONTINUE_SET":
        if (st !== "SET_CONFIRM") return false;
        s.status = "SET_ACTIVE";
        s.set!.lastActivityAt = s.now;
        return true;
      case "SKIP_BLOCK":
        if (st !== "READY" && st !== "REST" && st !== "TRANSFER") return false;
        this.skip();
        return true;
      case "UNDO_SKIP":
        if (st !== "READY" && st !== "TRANSFER") return false;
        return this.undoSkip();
      case "ABORT":
        if (st === "IDLE") return false;
        this.abort();
        return true;
    }
  }

  private onTick(): void {
    const s = this.s;
    const now = s.now;
    switch (s.status) {
      case "COUNTDOWN":
        if (now >= s.countdownEndsAt!) this.enterSetActive();
        return;
      case "SET_ACTIVE": {
        const b = this.blk;
        if (b.durationSec !== undefined && now - s.set!.startedAt >= b.durationSec * 1000) return this.endSet(true);
        if (this.trackingTimedOut()) return this.pause();
        if (now - s.set!.lastActivityAt >= PROGRAM_TIMING.inactivityPromptMs) {
          s.status = "SET_CONFIRM";
          this.speak(K.setDonePrompt);
          this.show(K.setDonePrompt);
        }
        return;
      }
      case "SET_CONFIRM":
        if (now - s.set!.lastActivityAt >= PROGRAM_TIMING.inactivityCloseMs) this.endSet();
        return;
      case "READY":
        if (this.trackingTimedOut()) this.pause();
        return;
      case "REST":
        if (now >= s.restEndsAt!) {
          s.restEndsAt = undefined;
          s.status = "READY";
          this.speak(K.restOver);
        }
        return;
      case "TRANSFER":
        if (this.transferAbandoned()) return;
        if (now - s.transferSince! >= PROGRAM_TIMING.transferPauseMs) this.pause();
        return;
      case "PAUSED":
        if (s.resumeTo === "TRANSFER") this.transferAbandoned();
        return;
      default:
        return;
    }
  }

  private trackingTimedOut(): boolean {
    return this.s.trackingLostAt !== undefined && this.s.now - this.s.trackingLostAt >= PROGRAM_TIMING.trackingPauseMs;
  }

  private transferAbandoned(): boolean {
    const s = this.s;
    if (s.transferSince === undefined || s.now - s.transferSince < PROGRAM_TIMING.transferAbandonMs) return false;
    this.flushPendingSkip();
    s.status = "ABANDONED";
    s.resumeTo = undefined;
    this.sessionRecord("abandoned");
    return true;
  }
}
