// Pure engine: expression parser, metrics, rep counter, fault evaluator, program state machine (specs/03, 04, 05).
export {
  type AttemptComparison,
  type CalibrationSummary,
  type CueComparison,
  type SequenceEvaluation,
  type SweepRow,
  evaluateSequence,
  summarize,
  sweep,
  withParameter,
} from "./calibration/evaluate";
export { type ExerciseEngineOptions, type ExerciseSetup, ExerciseEngine, faultEnabledInView } from "./exercise/exercise-engine";
export {
  type Edge,
  type SetupAssessment,
  type SetupHint,
  type SetupSample,
  SETUP_CHECKS,
  assessSetup,
  faultLandmarks,
  problemEdges,
} from "./setup/assess-setup";
export { PERSON_SELECTION, type PersonSelection, type PersonTrack, personScore, selectPerson } from "./setup/select-person";
export { FREQUENT_FAULT_STREAK, type SetSummary, summarizeSet } from "./exercise/summary";
export { collectMetrics } from "./expr/collect";
export { ExpressionError } from "./expr/error";
export { type Truth, evaluate } from "./expr/evaluate";
export {
  type Expr,
  FUNCTION_NAMES,
  type FunctionName,
  type ParseOptions,
  type ValueNode,
  parseCheck,
  parseExpression,
  parseReadyPose,
} from "./expr/parse";
export type { CompareOp } from "./expr/tokenize";
export {
  type MetricComputer,
  type Side,
  chooseNearSide,
  createMetricComputer,
  resolveLandmark,
  torsoLength,
} from "./metrics/compute";
export { OneEuroFilter, type OneEuroParams, createMetricSmoother } from "./metrics/smoothing";
export { DEFAULT_VIEW_THRESHOLDS, type ViewThresholds, detectView, dominantView } from "./metrics/view";
export {
  PROGRAM_MESSAGE_KEYS,
  PROGRAM_TIMING,
  type PersistRecord,
  type ProgramCommand,
  type ProgramConfig,
  type ProgramDeps,
  type ProgramState,
  type ProgramStatus,
  countsTowardTarget,
  createProgram,
  deserializeProgram,
  serializeProgram,
  step,
} from "./program/program";
export {
  type AttemptClassificationInput,
  type AttemptCompleted,
  RepCounter,
  type RepCounterEvent,
  type RepCounterState,
  type Snapshot,
  classifyAttempt,
} from "./reps/rep-counter";
export {
  type CompiledFault,
  type LoadResult,
  type LoadedRulePack,
  RulePackError,
  loadRulePack,
  safeLoadRulePack,
} from "./rules/load-rule-pack";
