// Camera access (specs/08 "Kamera izni"). Frames never leave the device (specs/07).

export type CameraFailure = "denied" | "unavailable";
export type CameraResult = { ok: true; stream: MediaStream } | { ok: false; reason: CameraFailure };

export function cameraErrorReason(e: unknown): CameraFailure {
  const name = (e as { name?: string } | null)?.name;
  return name === "NotAllowedError" || name === "SecurityError" ? "denied" : "unavailable";
}

export async function requestCamera(): Promise<CameraResult> {
  if (!globalThis.isSecureContext || !navigator.mediaDevices?.getUserMedia) return { ok: false, reason: "unavailable" };
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: false,
    });
    return { ok: true, stream };
  } catch (e) {
    return { ok: false, reason: cameraErrorReason(e) };
  }
}
