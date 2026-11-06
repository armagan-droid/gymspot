import { QR_TTL_MS, createQr, generateKeyPair, signDelegation, toBase64Url } from "@gymspot/shared";
import { describe, expect, test, vi } from "vitest";
import { ApiError, type GymApi, NetworkError } from "../api/client";
import { OfflineCheckins, checkIn } from "./checkin";

const NOW = Date.UTC(2026, 10, 6, 10);
const TENANT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const MEMBER = "a2000000-0000-4000-8000-000000000001";
const SESSION = "11111111-1111-4111-8111-111111111111";
const block = { exerciseId: "pushup", exerciseVersion: 1, sets: 2, reps: 8, restSec: 60, mode: "strict" as const, stationHint: "Şınav Alanı" };

function storage() {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
}

async function fixture(consent = true) {
  const tenant = await generateKeyPair();
  const phone = await generateKeyPair();
  const delegation = await signDelegation({ v: 1, tid: TENANT, mid: MEMBER, pk: phone.publicKeyB64, consent, exp: NOW + 3600_000 }, tenant.secretKey);
  const qr = (jti = "j-1") => createQr({ v: 1, tid: TENANT, mid: MEMBER, sid: SESSION, bi: 1, si: 0, blk: block, jti, exp: NOW + QR_TTL_MS }, phone.secretKey, delegation);
  const offline = new OfflineCheckins(storage());
  offline.tenantKey = toBase64Url(tenant.publicKey);
  return { qr, offline };
}

const api = (redeemQr: GymApi["redeemQr"]) => ({ redeemQr }) as unknown as GymApi;
const serverOk = vi.fn(async () => ({ memberId: MEMBER, cameraConsent: true, cursor: { sessionId: SESSION, blockIndex: 1, setIndex: 0 }, block }));

describe("station check-in (specs/07)", () => {
  test("online: the server redeems and the jti is remembered locally", async () => {
    const f = await fixture();
    const qr = await f.qr();
    const r = await checkIn(qr, { api: api(serverOk), offline: f.offline, now: () => NOW, online: () => true });
    expect(r).toMatchObject({ ok: true, offline: false, block: { exerciseId: "pushup" } });
    // the same QR offline later is refused
    const again = await checkIn(qr, { api: api(serverOk), offline: f.offline, now: () => NOW, online: () => false });
    expect(again).toEqual({ ok: false, reason: "already_used" });
  });

  test("online reuse (409) and invalid (401) are reported", async () => {
    const f = await fixture();
    const used = api(async () => Promise.reject(new ApiError(409, { reason: "already_used" })));
    expect(await checkIn(await f.qr(), { api: used, offline: f.offline, now: () => NOW, online: () => true })).toEqual({ ok: false, reason: "already_used" });
    const bad = api(async () => Promise.reject(new ApiError(401, { reason: "expired" })));
    expect(await checkIn(await f.qr("j-2"), { api: bad, offline: f.offline, now: () => NOW, online: () => true })).toEqual({ ok: false, reason: "invalid" });
  });

  test("network failure falls back to offline verification (AC-7.3 offline)", async () => {
    const f = await fixture();
    const down = api(async () => Promise.reject(new NetworkError("offline")));
    const qr = await f.qr();
    const r = await checkIn(qr, { api: down, offline: f.offline, now: () => NOW, online: () => true });
    expect(r).toMatchObject({ ok: true, offline: true, memberId: MEMBER, cursor: { blockIndex: 1 }, block });
    expect(f.offline.pending()).toEqual([qr]);
    expect(await checkIn(qr, { api: down, offline: f.offline, now: () => NOW, online: () => false })).toEqual({ ok: false, reason: "already_used" });
  });

  test("offline: expired or forged QRs are refused without a request", async () => {
    const f = await fixture();
    const redeem = vi.fn();
    const qr = await f.qr();
    expect(await checkIn(qr, { api: api(redeem), offline: f.offline, now: () => NOW + QR_TTL_MS + 1, online: () => true })).toEqual({ ok: false, reason: "invalid" });
    expect(redeem).not.toHaveBeenCalled();
  });

  test("offline without a cached tenant key cannot verify", async () => {
    const f = await fixture();
    f.offline.tenantKey = null;
    expect(await checkIn(await f.qr(), { api: api(serverOk), offline: f.offline, now: () => NOW, online: () => false })).toEqual({ ok: false, reason: "no_key" });
  });

  test("camera consent from the certificate is passed on (AC-7.4)", async () => {
    const f = await fixture(false);
    const r = await checkIn(await f.qr(), { api: api(serverOk), offline: f.offline, now: () => NOW, online: () => false });
    expect(r).toMatchObject({ ok: true, cameraConsent: false });
  });

  test("pending offline check-ins are redeemed later; network errors keep them", async () => {
    const f = await fixture();
    f.offline.addPending("qr-a");
    f.offline.addPending("qr-b");
    await f.offline.flush(async (qr) => {
      if (qr === "qr-b") throw new NetworkError("still offline");
    });
    expect(f.offline.pending()).toEqual(["qr-b"]);
    await f.offline.flush(async () => Promise.reject(new ApiError(409, null)));
    expect(f.offline.pending()).toEqual([]);
  });
});
