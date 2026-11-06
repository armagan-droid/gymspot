import { Writable } from "node:stream";
import { type Kysely, sql } from "kysely";
import { afterAll, beforeAll, beforeEach, describe, expect, inject, test } from "vitest";
import { buildApp } from "../src/app";
import { type Database, createDb } from "../src/db/db";
import { A, PASSWORD, T0, type TestApi, seedTenants, testApi } from "./helpers";

let db: Kysely<Database>;
let api: TestApi;
let manager: string;

beforeAll(async () => {
  db = createDb(inject("databaseUrl"));
});
afterAll(async () => db.destroy());
beforeEach(async () => {
  await seedTenants(db);
  api = testApi(db);
  manager = await api.staffToken("yonetici@a.test");
});

function logCapture() {
  const lines: string[] = [];
  const stream = new Writable({
    write(chunk, _enc, cb) {
      lines.push(String(chunk));
      cb();
    },
  });
  return { lines, stream };
}

const config = (now = () => T0) => ({
  jwtSecret: "test-jwt-secret-at-least-32-bytes-long!!",
  qrMasterSecret: "q",
  appBaseUrl: "https://app.test",
  now,
  sendMagicLink: async () => undefined,
  authRateLimit: 1000,
  calibrationKey: new Uint8Array(32),
});

describe("structured logs (specs/02)", () => {
  test("no passwords, tokens or bodies in the logs; request ids are echoed", async () => {
    const log = logCapture();
    const app = buildApp({ db, config: config(), logger: { level: "info", stream: log.stream } });
    const login = await app.inject({ method: "POST", url: "/auth/staff/login", payload: { tenantId: A, email: "yonetici@a.test", password: PASSWORD } });
    const token = login.json().accessToken as string;
    const res = await app.inject({ method: "GET", url: "/stations", headers: { authorization: `Bearer ${token}`, "x-request-id": "req-123" } });
    await app.close();

    expect(res.headers["x-request-id"]).toBe("req-123");
    const all = log.lines.join("\n");
    expect(log.lines.length).toBeGreaterThan(0);
    expect(all).not.toContain(PASSWORD);
    expect(all).not.toContain(token);
    expect(all).not.toContain(login.json().refreshToken);
    expect(all).toContain("req-123");
    expect(all).toContain('"url":"/stations"');
  });

  test("a generated request id comes back when none was sent", async () => {
    const res = await api.app.inject({ method: "GET", url: "/health" });
    expect(res.headers["x-request-id"]).toMatch(/^[0-9a-f-]{36}$/);
  });
});

async function device() {
  const st = (await api.call("POST", "/stations", manager, { name: "Squat Rafı 2" })).json().id as string;
  const { code } = (await api.call("POST", `/stations/${st}/pairing-code`, manager)).json();
  const { deviceToken, deviceId } = (await api.call("POST", "/auth/device/pair", undefined, { code })).json();
  const access = (await api.call("POST", "/auth/device/session", undefined, { deviceToken })).json().accessToken as string;
  return { st, deviceId, access };
}

describe("device heartbeat (specs/02)", () => {
  test("updates last seen and station health; stale stations go offline after 3 min", async () => {
    const d = await device();
    api.clock.now = T0 + 60_000;
    const r = await api.call("POST", "/devices/heartbeat", d.access, { appVersion: "1.0.0", fps: 24.5, queued: 3 });
    expect(r.status).toBe(204);
    const row = (await sql<{ last_seen_at: Date; device_status: string; last_heartbeat_at: Date }>`
      select d.last_seen_at, s.device_status, s.last_heartbeat_at from devices d join stations s on s.id = d.station_id where d.id = ${d.deviceId}`.execute(db)).rows[0]!;
    expect(row.last_seen_at.getTime()).toBe(T0 + 60_000);
    expect(row.last_heartbeat_at.getTime()).toBe(T0 + 60_000);
    expect(row.device_status).toBe("online");

    expect((await api.call("GET", "/admin/overview", manager)).json().stations[0]).toMatchObject({ online: true });
    api.clock.now = T0 + 60_000 + 3 * 60_000 + 1;
    const fresh = await api.staffToken("yonetici@a.test");
    expect((await api.call("GET", "/admin/overview", fresh)).json().stations[0]).toMatchObject({ online: false });
  });

  test("only devices send heartbeats; payload is validated", async () => {
    expect((await api.call("POST", "/devices/heartbeat", manager, {})).status).toBe(403);
    const d = await device();
    expect((await api.call("POST", "/devices/heartbeat", d.access, { appVersion: "x".repeat(500) })).status).toBe(400);
  });
});

describe("client error reports (specs/02, 07)", () => {
  test("accepted, scrubbed again on the server and logged without PII", async () => {
    const log = logCapture();
    const app = buildApp({ db, config: config(), logger: { level: "info", stream: log.stream } });
    const res = await app.inject({
      method: "POST",
      url: "/client-errors",
      payload: {
        message: "TypeError for ayse@a.test",
        stack: "at x (app.js:1:1)",
        tags: { route: "/station", release: "1.0.0", email: "ayse@a.test" },
        context: { status: "SET_ACTIVE", points: [[0.1, 0.2]] },
      },
    });
    await app.close();
    expect(res.statusCode).toBe(202);
    const all = log.lines.join("\n");
    expect(all).toContain("client_error");
    expect(all).toContain("TypeError for [email]");
    expect(all).not.toContain("ayse@a.test");
    expect(all).not.toContain("0.1");
  });

  test("oversized reports are rejected", async () => {
    const res = await api.app.inject({ method: "POST", url: "/client-errors", payload: { message: "x", stack: "y".repeat(100_000) } });
    expect(res.statusCode).toBe(413);
  });
});
