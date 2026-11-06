import { type Frame, LANDMARK_NAMES } from "@gymspot/shared";

// Person selection when the camera sees several people (specs/07).

export interface PersonTrack {
  /** Hip center of the tracked person in image coordinates. */
  hip: { x: number; y: number };
}

export interface PersonSelection {
  frame: Frame | null;
  track: PersonTrack | undefined;
  ambiguous: boolean;
}

export const PERSON_SELECTION = { trackRadius: 0.15, ambiguityRatio: 0.8, visibleThreshold: 0.5 } as const;

const LH = LANDMARK_NAMES.indexOf("left_hip");
const RH = LANDMARK_NAMES.indexOf("right_hip");

const hipCenter = (f: Frame) => ({ x: (f.image[LH]!.x + f.image[RH]!.x) / 2, y: (f.image[LH]!.y + f.image[RH]!.y) / 2 });

/** Box area × centrality (1 − distance of the box center from the image center). */
export function personScore(f: Frame): number {
  const pts = f.image.filter((p) => p.visibility >= PERSON_SELECTION.visibleThreshold);
  const use = pts.length >= 2 ? pts : f.image;
  const xs = use.map((p) => p.x);
  const ys = use.map((p) => p.y);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const area = (x1 - x0) * (y1 - y0);
  const centrality = Math.max(0, 1 - Math.hypot((x0 + x1) / 2 - 0.5, (y0 + y1) / 2 - 0.5));
  return area * centrality;
}

export function selectPerson(candidates: readonly Frame[], track?: PersonTrack): PersonSelection {
  if (candidates.length === 0) return { frame: null, track, ambiguous: false };

  if (track) {
    let best: Frame | undefined;
    let bestDist: number = PERSON_SELECTION.trackRadius;
    for (const c of candidates) {
      const h = hipCenter(c);
      const d = Math.hypot(h.x - track.hip.x, h.y - track.hip.y);
      if (d < bestDist) {
        best = c;
        bestDist = d;
      }
    }
    if (best) return { frame: best, track: { hip: hipCenter(best) }, ambiguous: false };
  }

  const ranked = candidates.map((c) => ({ c, s: personScore(c) })).sort((a, b) => b.s - a.s);
  const [first, runnerUp] = ranked;
  if (runnerUp && runnerUp.s > first!.s * PERSON_SELECTION.ambiguityRatio) {
    return { frame: null, track: undefined, ambiguous: true };
  }
  return { frame: first!.c, track: { hip: hipCenter(first!.c) }, ambiguous: false };
}
