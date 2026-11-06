import { type Frame, LANDMARK_NAMES, type View } from "@gymspot/shared";
import { torsoLength } from "./compute";

// specs/04 "Görünüm tespiti": shoulder width / torso length in the image.

export interface ViewThresholds {
  /** ratio ≥ front → "front" */
  front: number;
  /** ratio ≤ side → "side" */
  side: number;
}

export const DEFAULT_VIEW_THRESHOLDS: ViewThresholds = { front: 0.45, side: 0.2 };

const LS = LANDMARK_NAMES.indexOf("left_shoulder");
const RS = LANDMARK_NAMES.indexOf("right_shoulder");

export function detectView(frame: Frame, th: ViewThresholds = DEFAULT_VIEW_THRESHOLDS): View {
  const torso = torsoLength(frame);
  if (torso === 0) return "ambiguous";
  const ratio = Math.abs(frame.image[LS]!.x - frame.image[RS]!.x) / torso;
  if (ratio >= th.front) return "front";
  if (ratio <= th.side) return "side";
  return "ambiguous";
}

/** Most frequent view over a set; ties and empty input are ambiguous. */
export function dominantView(views: Iterable<View>): View {
  const counts = new Map<View, number>();
  for (const v of views) counts.set(v, (counts.get(v) ?? 0) + 1);
  let best: View = "ambiguous";
  let bestCount = 0;
  let tie = false;
  for (const [v, c] of counts) {
    if (c > bestCount) {
      best = v;
      bestCount = c;
      tie = false;
    } else if (c === bestCount) {
      tie = true;
    }
  }
  return tie ? "ambiguous" : best;
}
