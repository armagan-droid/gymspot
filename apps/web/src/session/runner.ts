import {
  ExerciseEngine,
  type ExerciseEngineOptions,
  type ExerciseSetup,
  type LoadedRulePack,
  type PersonTrack,
  type ProgramCommand,
  type ProgramConfig,
  type ProgramState,
  createProgram,
  selectPerson,
  step,
} from "@gymspot/engine";
import type { Frame, ProgramInput, SessionCursor, UserActionKind } from "@gymspot/shared";

// Wires camera candidates → person selection → ExerciseEngine → program state
// machine, and forwards program commands. No DOM; driven by the UI or tests.

export interface SessionRunnerOptions {
  packs: Readonly<Record<string, LoadedRulePack>>;
  program: ProgramConfig;
  setup: ExerciseSetup;
  /** Wall clock (epoch ms) for program time. */
  now(): number;
  newId(): string;
  onCommand(c: ProgramCommand): void;
  engine?: ExerciseEngineOptions;
  /** No person (or ambiguous selection) for this long → TRACKING_LOST (specs/04). */
  absenceLostAfterMs?: number;
}

export class SessionRunner {
  private _state: ProgramState;
  private engine: ExerciseEngine | undefined;
  private engineBlock = -1;
  private track: PersonTrack | undefined;
  private lastPersonAt: number | undefined;
  private lostByAbsence = false;
  private lostByEngine = false;
  private lostSent = false;
  private readonly listeners = new Set<(s: ProgramState) => void>();

  constructor(
    private readonly o: SessionRunnerOptions,
    restored?: ProgramState,
  ) {
    this._state = restored ?? createProgram(o.program, o.now());
  }

  get state(): ProgramState {
    return this._state;
  }

  subscribe(fn: (s: ProgramState) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Setup for the following sets (from A3). */
  setSetup(setup: ExerciseSetup): void {
    this.o.setup = setup;
    this.engineBlock = -1;
  }

  /** Station tablet: start the block handed over by the phone (specs/03 devir). */
  accept(cursor: SessionCursor): void {
    this.send({ type: "HANDOFF_ACCEPTED", cursor });
  }

  /** Phone: the member is back from the station. */
  returned(): void {
    this.send({ type: "HANDOFF_RETURNED" });
  }

  act(kind: UserActionKind): void {
    this.send({ type: "USER_ACTION", kind });
  }

  tick(): void {
    this.send({ type: "TICK", now: this.o.now() });
  }

  /** One camera result: zero or more people. `t` is the frame timestamp (ms). */
  pushCandidates(candidates: readonly Frame[], t: number): void {
    this.tick();
    const sel = selectPerson(candidates, this.track);
    this.track = sel.track;

    this.lastPersonAt ??= t;
    if (sel.frame) {
      this.lastPersonAt = t;
      if (this.lostByAbsence) {
        this.lostByAbsence = false;
        this.syncTracking();
      }
    } else if (!this.lostByAbsence && t - this.lastPersonAt >= (this.o.absenceLostAfterMs ?? 1000)) {
      this.lostByAbsence = true;
      this.syncTracking();
    }

    const engine = this.currentEngine();
    if (!engine || !sel.frame) return;
    engine.setCuesEnabled(this._state.status === "SET_ACTIVE");
    for (const e of engine.push(sel.frame)) {
      if (e.type === "TRACKING_LOST" || e.type === "TRACKING_RESTORED") {
        this.lostByEngine = e.type === "TRACKING_LOST";
        this.syncTracking();
      } else {
        this.send(e);
      }
    }
  }

  private currentEngine(): ExerciseEngine | undefined {
    const blockIndex = this._state.cursor.blockIndex;
    if (blockIndex !== this.engineBlock) {
      const block = this.o.program.workout.blocks[blockIndex];
      const pack = block && this.o.packs[block.exerciseId];
      this.engine = pack ? new ExerciseEngine(pack, this.o.setup, this.o.engine) : undefined;
      this.engineBlock = blockIndex;
    }
    return this.engine;
  }

  /** Absence and engine visibility loss are one signal for the program (specs/04). */
  private syncTracking(): void {
    const lost = this.lostByAbsence || this.lostByEngine;
    if (lost && !this.lostSent) {
      this.lostSent = true;
      this.send({ type: "TRACKING_LOST" });
    } else if (!lost && this.lostSent) {
      this.lostSent = false;
      this.send({ type: "TRACKING_RESTORED" });
    }
  }

  private send(input: ProgramInput): void {
    const prev = this._state;
    const r = step(prev, input, { newId: this.o.newId });
    this._state = r.state;
    // a new set starts with a fresh rep counter and streaks (specs/05)
    if (r.state.status === "COUNTDOWN" && prev.status !== "COUNTDOWN" && prev.status !== "PAUSED") this.engine?.reset();
    r.commands.forEach((c) => this.o.onCommand(c));
    if (r.state !== prev) this.listeners.forEach((fn) => fn(r.state));
  }
}
