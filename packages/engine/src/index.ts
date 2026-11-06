// Pure engine: expression parser, metrics, rep counter, fault evaluator, program state machine (specs/03, 04, 05).
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
  type CompiledFault,
  type LoadResult,
  type LoadedRulePack,
  RulePackError,
  loadRulePack,
  safeLoadRulePack,
} from "./rules/load-rule-pack";
