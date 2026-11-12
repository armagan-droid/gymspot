import type { PoseModelVariant } from "./mediapipe";

// Device-local camera preferences (specs/08 A5 diagnostics). Nothing leaves the device.

export const POSE_MODEL_KEY = "gymspot.poseModel";
export const DIAGNOSTICS_KEY = "gymspot.diagnostics";

type Store = Pick<Storage, "getItem" | "setItem">;
const local = (): Store | undefined => (typeof localStorage === "undefined" ? undefined : localStorage);

export function poseModel(store: Store | undefined = local()): PoseModelVariant {
  return store?.getItem(POSE_MODEL_KEY) === "full" ? "full" : "lite";
}
export function setPoseModel(v: PoseModelVariant, store: Store | undefined = local()): void {
  store?.setItem(POSE_MODEL_KEY, v);
}
export function diagnosticsOn(store: Store | undefined = local()): boolean {
  return store?.getItem(DIAGNOSTICS_KEY) === "1";
}
export function setDiagnosticsOn(on: boolean, store: Store | undefined = local()): void {
  store?.setItem(DIAGNOSTICS_KEY, on ? "1" : "0");
}
