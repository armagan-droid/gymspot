import { type Block, LocalJtiRegistry, type SessionCursor, fromBase64Url, verifyQr } from "@gymspot/shared";
import { ApiError, type GymApi, NetworkError } from "../api/client";

// Station check-in from the member's QR — specs/07 "Check-in / devir QR token'ı":
// online the server enforces single use; offline the tablet verifies with the
// cached tenant key, keeps its own jti registry and redeems later.

export type CheckinResult =
  | { ok: true; memberId: string; cameraConsent: boolean; cursor: SessionCursor; block: Block; offline: boolean }
  | { ok: false; reason: "already_used" | "invalid" | "no_key" };

export interface KeyValueStorage {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
}

/** Offline state that must survive reloads: used jtis, QRs to redeem later, the tenant key. */
export class OfflineCheckins {
  constructor(private readonly storage: KeyValueStorage) {}

  private read<T>(k: string, fallback: T): T {
    const v = this.storage.getItem(`gymspot.station.${k}`);
    return v ? (JSON.parse(v) as T) : fallback;
  }
  private write(k: string, v: unknown) {
    this.storage.setItem(`gymspot.station.${k}`, JSON.stringify(v));
  }

  /** Gym safety pause setting (specs/05), cached with the key. */
  get safetyPause(): boolean {
    return this.read<boolean>("safetyPause", true);
  }
  set safetyPause(v: boolean) {
    this.write("safetyPause", v);
  }

  get tenantKey(): string | null {
    return this.read<string | null>("qrKey", null);
  }
  set tenantKey(v: string | null) {
    this.write("qrKey", v);
  }

  /** False if this jti was already used on this tablet. */
  useJti(jti: string, exp: number, now: number): boolean {
    const reg = new LocalJtiRegistry(this.read<[string, number][]>("jtis", []));
    const fresh = reg.use(jti, exp, now);
    this.write("jtis", reg.entries());
    return fresh;
  }

  addPending(qr: string) {
    this.write("pending", [...this.pending(), qr]);
  }

  pending(): string[] {
    return this.read<string[]>("pending", []);
  }

  /** Redeems offline check-ins once online; keeps them on network errors. */
  async flush(redeem: (qr: string) => Promise<unknown>): Promise<void> {
    const keep: string[] = [];
    for (const qr of this.pending()) {
      try {
        await redeem(qr);
      } catch (e) {
        if (e instanceof NetworkError) keep.push(qr);
        // 409 reuse / 401 invalid are recorded server-side (audit); nothing to retry
      }
    }
    this.write("pending", keep);
  }
}

export async function checkIn(qr: string, deps: { api: GymApi; offline: OfflineCheckins; now: () => number; online: () => boolean }): Promise<CheckinResult> {
  const key = deps.offline.tenantKey;
  const local = key ? await verifyQr(qr, fromBase64Url(key), deps.now()) : null;
  if (local && !local.ok) return { ok: false, reason: "invalid" };

  if (deps.online()) {
    try {
      const r = await deps.api.redeemQr(qr);
      if (local?.ok) deps.offline.useJti(local.payload.jti, local.payload.exp, deps.now());
      return { ok: true, ...r, offline: false };
    } catch (e) {
      if (e instanceof ApiError) return { ok: false, reason: e.status === 409 ? "already_used" : "invalid" };
      if (!(e instanceof NetworkError)) throw e;
      // fall through to offline verification
    }
  }

  if (!local) return { ok: false, reason: "no_key" };
  if (!local.ok) return { ok: false, reason: "invalid" };
  const { payload, delegation } = local;
  if (!deps.offline.useJti(payload.jti, payload.exp, deps.now())) return { ok: false, reason: "already_used" };
  deps.offline.addPending(qr);
  return {
    ok: true,
    memberId: payload.mid,
    cameraConsent: delegation.consent,
    cursor: { sessionId: payload.sid, blockIndex: payload.bi, setIndex: payload.si },
    block: payload.blk,
    offline: true,
  };
}
