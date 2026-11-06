import { describe, expect, test } from "vitest";
import {
  DELEGATION_TTL_MS,
  LocalJtiRegistry,
  QR_TTL_MS,
  createQr,
  generateKeyPair,
  publicKeyFromSecret,
  signDelegation,
  verifyQr,
} from "../src/index";

const NOW = Date.UTC(2026, 10, 6, 10);
const TENANT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OTHER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const MEMBER = "a0000000-0000-4000-8000-000000000001";
const SESSION = "11111111-1111-4111-8111-111111111111";

async function setup(o: { delegationExp?: number; consent?: boolean } = {}) {
  const tenant = await generateKeyPair();
  const phone = await generateKeyPair();
  const delegation = await signDelegation(
    { v: 1, tid: TENANT, mid: MEMBER, pk: phone.publicKeyB64, consent: o.consent ?? true, exp: o.delegationExp ?? NOW + DELEGATION_TTL_MS },
    tenant.secretKey,
  );
  const qr = (p: Partial<{ exp: number; jti: string; tid: string; mid: string }> = {}) =>
    createQr({ v: 1, tid: TENANT, mid: MEMBER, sid: SESSION, bi: 1, si: 0, jti: "j-1", exp: NOW + QR_TTL_MS, ...p }, phone.secretKey, delegation);
  return { tenant, phone, delegation, qr };
}

describe("QR check-in tokens (specs/07, AC-7.3 offline)", () => {
  test("a valid QR verifies offline with the tenant public key", async () => {
    const s = await setup();
    const r = await verifyQr(await s.qr(), s.tenant.publicKey, NOW);
    expect(r).toMatchObject({ ok: true, payload: { mid: MEMBER, sid: SESSION, bi: 1, si: 0, jti: "j-1" }, delegation: { consent: true } });
  });

  test("the camera consent travels in the server-signed certificate", async () => {
    const s = await setup({ consent: false });
    const r = await verifyQr(await s.qr(), s.tenant.publicKey, NOW);
    expect(r.ok && r.delegation.consent).toBe(false);
  });

  test("an expired QR is rejected", async () => {
    const s = await setup();
    expect(await verifyQr(await s.qr(), s.tenant.publicKey, NOW + QR_TTL_MS + 1)).toEqual({ ok: false, reason: "expired" });
  });

  test("a QR claiming a lifetime beyond 2 min (+30 s skew) is rejected", async () => {
    const s = await setup();
    expect(await verifyQr(await s.qr({ exp: NOW + 10 * 60_000 }), s.tenant.publicKey, NOW)).toEqual({ ok: false, reason: "expired" });
  });

  test("an expired delegation certificate is rejected", async () => {
    const s = await setup({ delegationExp: NOW - 1 });
    expect(await verifyQr(await s.qr(), s.tenant.publicKey, NOW)).toEqual({ ok: false, reason: "delegation_expired" });
  });

  test("another tenant's key does not verify", async () => {
    const s = await setup();
    const other = await generateKeyPair();
    expect(await verifyQr(await s.qr(), other.publicKey, NOW)).toEqual({ ok: false, reason: "bad_signature" });
  });

  test("tampering with the payload or the certificate breaks the signature", async () => {
    const s = await setup();
    const [p, ps, c, cs] = (await s.qr()).split(".");
    const flip = (b64: string) => {
      const json = JSON.parse(Buffer.from(b64, "base64url").toString());
      json.mid = "b0000000-0000-4000-8000-000000000001";
      return Buffer.from(JSON.stringify(json)).toString("base64url");
    };
    expect(await verifyQr([flip(p!), ps, c, cs].join("."), s.tenant.publicKey, NOW)).toEqual({ ok: false, reason: "bad_signature" });
    expect(await verifyQr([p, ps, flip(c!), cs].join("."), s.tenant.publicKey, NOW)).toEqual({ ok: false, reason: "bad_signature" });
  });

  test("payload and certificate must name the same tenant and member", async () => {
    const s = await setup();
    expect(await verifyQr(await s.qr({ tid: OTHER }), s.tenant.publicKey, NOW)).toEqual({ ok: false, reason: "mismatch" });
  });

  test("malformed input is rejected without throwing", async () => {
    const s = await setup();
    for (const bad of ["", "a.b", "x.y.z.w", "....", `${"a".repeat(10)}.!!.??.##`]) {
      expect(await verifyQr(bad, s.tenant.publicKey, NOW), bad).toEqual({ ok: false, reason: "malformed" });
    }
  });

  test("LocalJtiRegistry: single use offline, forgets entries after expiry", () => {
    const reg = new LocalJtiRegistry();
    expect(reg.use("j-1", NOW + 1000, NOW)).toBe(true);
    expect(reg.use("j-1", NOW + 1000, NOW + 10)).toBe(false);
    expect(reg.use("j-2", NOW + 1000, NOW + 10)).toBe(true);
    reg.use("j-3", NOW + 5000, NOW + 2000); // prunes j-1/j-2 (expired)
    expect(reg.size).toBe(1);
  });

  test("public key derivation from a 32-byte secret is deterministic", async () => {
    const seed = new Uint8Array(32).fill(7);
    expect(await publicKeyFromSecret(seed)).toEqual(await publicKeyFromSecret(seed));
  });
});
