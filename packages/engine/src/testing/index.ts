// Synthetic fixtures and replay helpers for tests and calibration tooling (specs/04).
// Exposed as @gymspot/engine/testing; not part of the runtime engine API.
export { type Body, type BodyPoint, type FrameOptions, SEGMENT, completeBody, mirrorFrame, toFrame } from "./body";
export {
  type PressParams,
  type PushupParams,
  type SequenceOptions,
  type SquatParams,
  pressBody,
  pressFrame,
  evaderSequence,
  fighterSequence,
  pressSequence,
  pushupBody,
  pushupFrame,
  pushupSequence,
  squatBody,
  squatFrame,
  squatSequence,
} from "./exercises";
export { type EvaderParams, type FighterParams, evaderBody, evaderFrame, fighterBody, fighterFrame } from "./martial";
export { type PlayOptions, playSequence } from "./player";
export { type Random, createRandom } from "./random";
export { type ScalarSignalOptions, type TimelineOptions, type TimelinePoint, repTimeline, scalarSignal } from "./timeline";
