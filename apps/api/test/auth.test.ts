import {
  QR_TTL_MS,
  createQr,
  fromBase64Url,
  generateKeyPair,
  verifyQr,
} from "@gymspot/shared";
import type { FastifyInstance } from "fastify";
import { type Kysely, sql } from "kysely";
import { afterAll, beforeAll, beforeEach, describe, expect, inject, test, vi } from "vitest";
import { buildApp } from "../src/app";
import { hashPassword } from "../src/auth/password";
import { type Database, createDb } from "../src/db/db";

const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const OWNER = "a1000000-0000-4000-8000-000000000001";
const TRAINER = "a1000000-0000-4000-8000-000000000002";
const MEMBER = "a2000000-0000-4000-8000-000000000001";
const MEMBER_NO_CONSENT = "a2000000-0000-4000-8000-000000000002";
const STATION = "a3000000-0000-4000-8000-000000000001";
const SESSION = "11111111-1111-4111-8111-111111111111";
const T0 = Date.UTC(2026, 10, 6, 10);

let db: Kysely<Database>;
let app: FastifyInstance;
let clock = T0;
const sent: { to: string; link: string }[] = [];

beforeAll(async () => {
  db = createDb(inject("databaseUrl"));
  const pw = await hashPassword("doğru-parola-123");
  for (const q of [
    sql`truncate tenants, exercises cascade`,
    sql`insert into tenants (id, name) values (${A}, 'Salon A'), (${B}, 'Salon B')`,
    sql`insert into users (id, tenant_id, email, password_hash, role) values
          (${OWNER}, ${A}, 'sahip@a.test', ${pw}, 'owner'),
          (${TRAINER}, ${A}, 'pt@a.test', ${pw}, 'trainer')`,
    sql`insert into members (id, tenant_id, display_name, email, consent_at, consent_version) values
          (${MEMBER}, ${A}, 'Ayşe', 'ayse@a.test', now(), 'v1'),
          (${MEMBER_NO_CONSENT}, ${A}, 'Ali', 'ali@a.test', null, null)`,
    sql`insert into stations (id, tenant_id, name) values (${STATION}, ${A}, 'Squat Rafı 2')`,
  ]) {
    await q.execute(db);
  }
});
afterAll(async () => db.destroy());

beforeEach(async () => {
  clock = T0;
  sent.length = 0;
  await sql`delete from login_attempts`.execute(db);
  app = buildApp({
    db,
    config: {
      jwtSecret: "test-jwt-secret-at-least-32-bytes-long!!",
      qrMasterSecret: "test-qr-master-secret",
      appBaseUrl: "https://app.test",
      now: () => clock,
      sendMagicLink: async (to, link) => void sent.push({ to, link }),
      authRateLimit: 1000,
      calibrationKey: new Uint8Array(32),
    },
  });
});

const post = (url: string, body: unknown, token?: string) =>
  app.inject({ method: "POST", url, payload: body as object, headers: token ? { authorization: `Bearer ${token}` } : {} });
const staffLogin = (email = "sahip@a.test", password = "doğru-parola-123", tenantId = A) =>
  post("/auth/staff/login", { tenantId, email, password });

describe("staff login (specs/07)", () => {
  test("correct credentials return access and refresh tokens", async () => {
    const res = await staffLogin();
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ accessToken: expect.any(String), refreshToken: expect.stringMatching(new RegExp(`^${A}\\.`)) });
  });

  test("wrong password or unknown user → 401 with the same message", async () => {
    const wrong = await staffLogin("sahip@a.test", "yanlış");
    const unknown = await staffLogin("yok@a.test", "yanlış");
    expect(wrong.statusCode).toBe(401);
    expect(unknown.statusCode).toBe(401);
    expect(wrong.json()).toEqual(unknown.json());
  });

  test("credentials are tenant-scoped", async () => {
    expect((await staffLogin("sahip@a.test", "doğru-parola-123", B)).statusCode).toBe(401);
  });

  test("5 failures lock the account for 15 min, even with the right password", async () => {
    for (let i = 0; i < 5; i++) expect((await staffLogin("sahip@a.test", "yanlış")).statusCode).toBe(401);
    expect((await staffLogin()).statusCode).toBe(429);
    clock += 15 * 60_000 + 1;
    expect((await staffLogin()).statusCode).toBe(200);
  });

  test("logins are written to the audit log", async () => {
    await staffLogin("sahip@a.test", "yanlış");
    await staffLogin();
    const r = await sql<{ action: string }>`select action from audit_log where tenant_id = ${A} order by at desc limit 2`.execute(db);
    expect(r.rows.map((x) => x.action).sort()).toEqual(["login_failed", "login_ok"]);
  });
});

describe("tokens", () => {
  test("refresh rotates: the old refresh token stops working", async () => {
    const { refreshToken } = (await staffLogin()).json();
    const first = await post("/auth/refresh", { refreshToken });
    expect(first.statusCode).toBe(200);
    expect((await post("/auth/refresh", { refreshToken })).statusCode).toBe(401);
    expect((await post("/auth/refresh", { refreshToken: first.json().refreshToken })).statusCode).toBe(200);
  });

  test("logout revokes the refresh token", async () => {
    const { refreshToken } = (await staffLogin()).json();
    expect((await post("/auth/logout", { refreshToken })).statusCode).toBe(204);
    expect((await post("/auth/refresh", { refreshToken })).statusCode).toBe(401);
  });

  test("access tokens expire after 15 min", async () => {
    const { accessToken } = (await staffLogin()).json();
    expect((await post(`/stations/${STATION}/pairing-code`, {}, accessToken)).statusCode).toBe(200);
    clock += 15 * 60_000 + 1000;
    expect((await post(`/stations/${STATION}/pairing-code`, {}, accessToken)).statusCode).toBe(401);
  });

  test("a garbage bearer token is rejected", async () => {
    expect((await post(`/stations/${STATION}/pairing-code`, {}, "nope")).statusCode).toBe(401);
  });
});

describe("AC-7.6: member magic link", () => {
  const linkToken = () => new URL(sent.at(-1)!.link).searchParams.get("token")!;

  test("request always answers 202; only known members get a link", async () => {
    expect((await post("/auth/member/magic-link", { tenantId: A, email: "yok@a.test" })).statusCode).toBe(202);
    expect(sent).toEqual([]);
    expect((await post("/auth/member/magic-link", { tenantId: A, email: "AYSE@a.test" })).statusCode).toBe(202);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.link).toMatch(/^https:\/\/app\.test\/member\/login\?token=/);
  });

  test("works once", async () => {
    await post("/auth/member/magic-link", { tenantId: A, email: "ayse@a.test" });
    const token = linkToken();
    const ok = await post("/auth/member/verify", { token });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().accessToken).toEqual(expect.any(String));
    expect((await post("/auth/member/verify", { token })).statusCode).toBe(401);
  });

  test("expires after 15 min", async () => {
    await post("/auth/member/magic-link", { tenantId: A, email: "ayse@a.test" });
    clock += 15 * 60_000 + 1;
    expect((await post("/auth/member/verify", { token: linkToken() })).statusCode).toBe(401);
  });

  test("a token presented under another tenant prefix fails", async () => {
    await post("/auth/member/magic-link", { tenantId: A, email: "ayse@a.test" });
    const forged = linkToken().replace(A, B);
    expect((await post("/auth/member/verify", { token: forged })).statusCode).toBe(401);
  });
});

async function pairTablet() {
  const { accessToken } = (await staffLogin()).json();
  const { code } = (await post(`/stations/${STATION}/pairing-code`, {}, accessToken)).json();
  const paired = (await post("/auth/device/pair", { code })).json();
  const session = (await post("/auth/device/session", { deviceToken: paired.deviceToken })).json();
  return { staffToken: accessToken, deviceToken: paired.deviceToken as string, deviceId: paired.deviceId as string, deviceAccess: session.accessToken as string };
}

describe("device pairing (specs/07)", () => {
  test("only managers/owners create pairing codes", async () => {
    const { accessToken } = (await staffLogin("pt@a.test")).json();
    expect((await post(`/stations/${STATION}/pairing-code`, {}, accessToken)).statusCode).toBe(403);
  });

  test("a code pairs once and yields a device token for the station", async () => {
    const { accessToken } = (await staffLogin()).json();
    const res = await post(`/stations/${STATION}/pairing-code`, {}, accessToken);
    const { code } = res.json();
    expect(code).toMatch(/^[A-HJ-NP-Z2-9]{8}$/);
    const paired = await post("/auth/device/pair", { code: code.toLowerCase() });
    expect(paired.statusCode).toBe(200);
    expect(paired.json()).toMatchObject({ tenantId: A, stationId: STATION, deviceToken: expect.stringMatching(new RegExp(`^${A}\\.`)) });
    expect((await post("/auth/device/pair", { code })).statusCode).toBe(401);
  });

  test("codes expire after 10 min", async () => {
    const { accessToken } = (await staffLogin()).json();
    const { code } = (await post(`/stations/${STATION}/pairing-code`, {}, accessToken)).json();
    clock += 10 * 60_000 + 1;
    expect((await post("/auth/device/pair", { code })).statusCode).toBe(401);
  });

  test("a removed device can no longer start sessions", async () => {
    const t = await pairTablet();
    const del = await app.inject({ method: "DELETE", url: `/devices/${t.deviceId}`, headers: { authorization: `Bearer ${t.staffToken}` } });
    expect(del.statusCode).toBe(204);
    expect((await post("/auth/device/session", { deviceToken: t.deviceToken })).statusCode).toBe(401);
  });
});

describe("AC-7.3: QR check-in (online)", () => {
  async function memberPhone(email = "ayse@a.test") {
    await post("/auth/member/magic-link", { tenantId: A, email });
    const token = new URL(sent.at(-1)!.link).searchParams.get("token")!;
    const { accessToken } = (await post("/auth/member/verify", { token })).json();
    const phone = await generateKeyPair();
    const res = await post("/auth/member/qr-delegation", { publicKey: phone.publicKeyB64 }, accessToken);
    expect(res.statusCode).toBe(200);
    return { phone, delegation: res.json() };
  }
  const makeQr = (p: Awaited<ReturnType<typeof memberPhone>>, jti = "jti-1", mid = MEMBER) =>
    createQr({ v: 1, tid: A, mid, sid: SESSION, bi: 1, si: 0, blk: { exerciseId: "squat", exerciseVersion: 1, sets: 3, reps: 10, restSec: 60, mode: "strict" as const }, jti, exp: clock + QR_TTL_MS }, p.phone.secretKey, p.delegation);

  test("a tablet redeems a member's QR once", async () => {
    const t = await pairTablet();
    const qr = await makeQr(await memberPhone());
    const ok = await post("/auth/qr/redeem", { qr }, t.deviceAccess);
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toEqual({
      memberId: MEMBER,
      cameraConsent: true,
      cursor: { sessionId: SESSION, blockIndex: 1, setIndex: 0 },
      block: { exerciseId: "squat", exerciseVersion: 1, sets: 3, reps: 10, restSec: 60, mode: "strict" },
    });
    const again = await post("/auth/qr/redeem", { qr }, t.deviceAccess);
    expect(again.statusCode).toBe(409);
  });

  test("expired and tampered QRs are rejected", async () => {
    const t = await pairTablet();
    const p = await memberPhone();
    const qr = await makeQr(p, "jti-2");
    clock += QR_TTL_MS + 1;
    expect((await post("/auth/qr/redeem", { qr }, t.deviceAccess)).json()).toMatchObject({ reason: "expired" });
    clock = T0;
    const [body, ...rest] = (await makeQr(p, "jti-3")).split(".");
    const tampered = [body!.slice(0, -2) + "AA", ...rest].join(".");
    expect((await post("/auth/qr/redeem", { qr: tampered }, t.deviceAccess)).statusCode).toBe(401);
  });

  test("camera consent comes from the server-signed delegation", async () => {
    const t = await pairTablet();
    const qr = await makeQr(await memberPhone("ali@a.test"), "jti-4", MEMBER_NO_CONSENT);
    expect((await post("/auth/qr/redeem", { qr }, t.deviceAccess)).json()).toMatchObject({ cameraConsent: false });
  });

  test("the published tenant key verifies QRs offline on the tablet", async () => {
    const t = await pairTablet();
    const qr = await makeQr(await memberPhone(), "jti-5");
    const { publicKey } = (await app.inject({ method: "GET", url: "/auth/qr-public-key", headers: { authorization: `Bearer ${t.deviceAccess}` } })).json();
    expect(await verifyQr(qr, fromBase64Url(publicKey), clock)).toMatchObject({ ok: true });
  });

  test("only devices redeem; members and staff cannot", async () => {
    const { accessToken } = (await staffLogin()).json();
    expect((await post("/auth/qr/redeem", { qr: "x.y.z.w" }, accessToken)).statusCode).toBe(403);
  });
});

describe("rate limiting", () => {
  test("auth endpoints are rate limited per client", async () => {
    const limited = buildApp({
      db,
      config: { jwtSecret: "test-jwt-secret-at-least-32-bytes-long!!", qrMasterSecret: "x", appBaseUrl: "https://app.test", now: () => clock, sendMagicLink: vi.fn(), authRateLimit: 3, calibrationKey: new Uint8Array(32) },
    });
    const codes: number[] = [];
    for (let i = 0; i < 5; i++) {
      codes.push((await limited.inject({ method: "POST", url: "/auth/member/magic-link", payload: { tenantId: A, email: "x@a.test" } })).statusCode);
    }
    expect(codes).toEqual([202, 202, 202, 429, 429]);
    await limited.close();
  });
});
