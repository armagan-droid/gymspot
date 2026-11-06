import {
  BILATERAL_JOINTS,
  type Frame,
  LANDMARK_NAMES,
  type Landmark,
  type LandmarkName,
  type LandmarkRef,
  type MetricDefinition,
  metricDependencies,
} from "@gymspot/shared";

// Metric functions from the closed list in specs/04. Angles use world (3D)
// coordinates; everything else uses image (2D) coordinates.

export type Side = "left" | "right";

const INDEX = new Map(LANDMARK_NAMES.map((n, i) => [n, i]));
const idx = (n: LandmarkName) => INDEX.get(n)!;
const DEG = 180 / Math.PI;

export function resolveLandmark(ref: LandmarkRef, near: Side): LandmarkName {
  if (ref.startsWith("near_")) return `${near}_${ref.slice(5)}` as LandmarkName;
  if (ref.startsWith("far_")) return `${near === "left" ? "right" : "left"}_${ref.slice(4)}` as LandmarkName;
  return ref as LandmarkName;
}

type P2 = { x: number; y: number };
const mid = (a: P2, b: P2): P2 => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
const dist = (a: P2, b: P2) => Math.hypot(a.x - b.x, a.y - b.y);

function angle3(a: Landmark, b: Landmark, c: Landmark): number {
  const ux = a.x - b.x, uy = a.y - b.y, uz = a.z - b.z;
  const vx = c.x - b.x, vy = c.y - b.y, vz = c.z - b.z;
  const n = Math.hypot(ux, uy, uz) * Math.hypot(vx, vy, vz);
  if (n === 0) return NaN;
  return Math.acos(Math.max(-1, Math.min(1, (ux * vx + uy * vy + uz * vz) / n))) * DEG;
}

/** Image distance between the shoulder midpoint and the hip midpoint. */
export function torsoLength(frame: Frame): number {
  const im = frame.image;
  return dist(
    mid(im[idx("left_shoulder")]!, im[idx("right_shoulder")]!),
    mid(im[idx("left_hip")]!, im[idx("right_hip")]!),
  );
}

const safeDiv = (a: number, b: number) => (b === 0 ? NaN : a / b);

function diffY(frame: Frame, a: P2, b: P2): number {
  return safeDiv(b.y - a.y, torsoLength(frame));
}

function angleFromVertical(a: P2, b: P2): number {
  const vx = b.x - a.x;
  const vy = b.y - a.y;
  const n = Math.hypot(vx, vy);
  if (n === 0) return NaN;
  return Math.acos(Math.max(-1, Math.min(1, -vy / n))) * DEG; // image "up" is −y
}

function kneeInwardRatio(frame: Frame, hip: P2, knee: P2, ankle: P2): number {
  if (hip.y === ankle.y) return NaN;
  const t = (knee.y - hip.y) / (ankle.y - hip.y);
  const lineX = hip.x + t * (ankle.x - hip.x);
  const im = frame.image;
  const midX = (im[idx("left_hip")]!.x + im[idx("right_hip")]!.x) / 2;
  const inward = Math.sign(midX - lineX);
  if (inward === 0) return NaN;
  return safeDiv(inward * (knee.x - lineX), dist(hip, knee) + dist(knee, ankle));
}

function signedOffset(a: P2, b: P2, c: P2): number {
  const wx = c.x - a.x;
  const wy = c.y - a.y;
  const len = Math.hypot(wx, wy);
  if (len === 0) return NaN;
  // unit normal pointing image-up (−y); +x if the line is vertical
  let nx = -wy / len;
  let ny = wx / len;
  if (ny > 0 || (ny === 0 && nx < 0)) {
    nx = -nx;
    ny = -ny;
  }
  return ((b.x - a.x) * nx + (b.y - a.y) * ny) / len;
}

export interface MetricComputer {
  /** Metric names in evaluation order (dependencies first). */
  readonly order: readonly string[];
  compute(frame: Frame, near: Side): Record<string, number>;
  /** Landmarks a metric depends on, transitively, with near_/far_ resolved. */
  landmarksOf(metric: string, near: Side): Set<LandmarkName>;
}

export function createMetricComputer(metrics: Record<string, MetricDefinition>): MetricComputer {
  const order = topologicalOrder(metrics);

  const evalDef = (def: MetricDefinition, frame: Frame, near: Side, values: Record<string, number>): number => {
    const img = (r: LandmarkRef) => frame.image[idx(resolveLandmark(r, near))]!;
    const wld = (r: LandmarkRef) => frame.world[idx(resolveLandmark(r, near))]!;
    if ("angle" in def) return angle3(wld(def.angle[0]), wld(def.angle[1]), wld(def.angle[2]));
    if ("avg" in def) return (values[def.avg[0]]! + values[def.avg[1]]!) / 2;
    if ("absDiff" in def) return Math.abs(values[def.absDiff[0]]! - values[def.absDiff[1]]!);
    if ("diffY" in def) return diffY(frame, img(def.diffY[0]), img(def.diffY[1]));
    if ("angleFromVertical" in def) return angleFromVertical(img(def.angleFromVertical[0]), img(def.angleFromVertical[1]));
    if ("kneeInwardRatio" in def) {
      const [h, k, a] = def.kneeInwardRatio;
      return kneeInwardRatio(frame, img(h), img(k), img(a));
    }
    const [a, b, c] = def.signedOffset;
    return signedOffset(img(a), img(b), img(c));
  };

  const directLandmarks = (def: MetricDefinition): LandmarkRef[] =>
    metricDependencies(def).length > 0 ? [] : (Object.values(def)[0] as LandmarkRef[]);

  return {
    order,
    compute(frame, near) {
      const values: Record<string, number> = {};
      for (const name of order) values[name] = evalDef(metrics[name]!, frame, near, values);
      return values;
    },
    landmarksOf(metric, near) {
      const out = new Set<LandmarkName>();
      const visit = (name: string) => {
        const def = metrics[name];
        if (!def) return;
        for (const r of directLandmarks(def)) out.add(resolveLandmark(r, near));
        metricDependencies(def).forEach(visit);
      };
      visit(metric);
      return out;
    },
  };
}

function topologicalOrder(metrics: Record<string, MetricDefinition>): string[] {
  const order: string[] = [];
  const state = new Map<string, "visiting" | "done">();
  const visit = (name: string) => {
    const s = state.get(name);
    if (s === "done") return;
    if (s === "visiting") throw new Error(`metric cycle at '${name}'`);
    const def = metrics[name];
    if (!def) throw new Error(`undefined metric '${name}'`);
    state.set(name, "visiting");
    metricDependencies(def).forEach(visit);
    state.set(name, "done");
    order.push(name);
  };
  Object.keys(metrics).forEach(visit);
  return order;
}

/** Picks the side with the higher mean visibility over the given frames; ties → left (specs/04). */
export function chooseNearSide(frames: readonly Frame[]): Side {
  let left = 0;
  let right = 0;
  for (const f of frames) {
    for (const j of BILATERAL_JOINTS) {
      left += f.image[idx(`left_${j}` as LandmarkName)]!.visibility;
      right += f.image[idx(`right_${j}` as LandmarkName)]!.visibility;
    }
  }
  return right > left ? "right" : "left";
}
