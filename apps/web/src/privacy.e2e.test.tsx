import { squatFrame } from "@gymspot/engine/testing";
import { QR_TTL_MS, type Workout, createQr, generateKeyPair, signDelegation, toBase64Url } from "@gymspot/shared";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, test, vi } from "vitest";
import { createGymApi } from "./api/client";
import { App } from "./App";
import { createI18n } from "./i18n";
import { RecordQueue, type QueuedRecord } from "./sync/queue";
import { SyncService } from "./sync/service";
import { testServices } from "./test-services";

// AC-7.1 (specs/07): during a session no request leaving the client carries
// video, images or landmarks. Real API client, real record queue, a fake server
// that records every request; the camera is scripted with synthetic poses.
// Heavy (lazy routes + crypto): generous waits so a loaded CI machine does not flake.
const SLOW = { timeout: 5000 };

afterEach(cleanup);

const NOW = Date.UTC(2026, 10, 6, 10);
const TENANT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const MEMBER = "a2000000-0000-4000-8000-000000000001";
const workout: Workout = { id: "mp-1:0", name: "A · 1", blocks: [{ exerciseId: "squat", exerciseVersion: 1, sets: 1, reps: 2, restSec: 30, mode: "strict" }] };

interface Captured {
  method: string;
  path: string;
  body: unknown;
  bytes: number;
}

const FORBIDDEN_KEYS = new Set(["image", "world", "frames", "frame", "landmarks", "visibility", "video", "jpeg", "png", "pixels", "x", "y", "z"]);

/** Any forbidden key or a 33-element array anywhere in the value. */
function leaks(value: unknown, path = "$"): string[] {
  if (Array.isArray(value)) {
    return [...(value.length === 33 ? [`${path} (33-element array)`] : []), ...value.flatMap((v, i) => leaks(v, `${path}[${i}]`))];
  }
  if (value && typeof value === "object") {
    return Object.entries(value).flatMap(([k, v]) => [...(FORBIDDEN_KEYS.has(k) ? [`${path}.${k}`] : []), ...leaks(v, `${path}.${k}`)]);
  }
  return [];
}

function fakeServer(routes: Record<string, (body: unknown) => unknown>) {
  const captured: Captured[] = [];
  const fetchFn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const path = String(url).replace("https://api.test", "");
    const raw = init?.body ? String(init.body) : "";
    const body = raw ? JSON.parse(raw) : undefined;
    captured.push({ method: init?.method ?? "GET", path, body, bytes: raw.length });
    const handler = routes[`${init?.method ?? "GET"} ${path}`];
    if (!handler) return new Response(JSON.stringify({ error: "not_found" }), { status: 404 });
    return new Response(JSON.stringify(handler(body)), { status: 200 });
  });
  return { captured, fetchFn };
}

const ingestOk = (b: unknown) => ({ results: (b as { records: { kind: string; data: { id: string } }[] }).records.map((r) => ({ id: r.data.id, kind: r.kind, status: "ok" })) });

function wire(t: ReturnType<typeof testServices>, fetchFn: typeof fetch) {
  const api = createGymApi({ baseUrl: "https://api.test", store: t.services.store, fetchFn });
  t.services.api = api;
  t.services.createSync = (as) => {
    const items: { v: QueuedRecord[] } = { v: [] };
    const queue = new RecordQueue({
      storage: { load: async () => items.v, save: async (x) => void (items.v = [...x]) },
      send: as === "device" ? api.ingestAsDevice : api.ingestAsMember,
    });
    return new SyncService(queue);
  };
}

/** Standing, then two squats after ready pose + countdown. */
async function perform(t: ReturnType<typeof testServices>) {
  await vi.waitFor(() => expect(t.pose.emit).toBeDefined());
  const rep = (ms: number, start: number) => {
    const p = (ms - start) / 2000;
    return p > 0 && p < 1 ? (1 - Math.cos(2 * Math.PI * p)) / 2 : 0;
  };
  await act(async () => {
    for (let ms = 0; ms <= 11000; ms += 1000 / 30) {
      t.clock.now = NOW + ms;
      const knee = 172 - 82 * Math.max(rep(ms, 5000), rep(ms, 7800));
      t.pose.emit!([squatFrame({ kneeAngle: knee, torsoLean: 10 }, { view: "front", t: ms })], ms);
    }
  });
}

async function setupReady(t: ReturnType<typeof testServices>) {
  await screen.findByRole("heading", { name: "Kamera kurulumu" }, SLOW);
  await vi.waitFor(() => expect(t.pose.emit).toBeDefined());
  await act(async () => {
    for (let ms = 0; ms <= 1100; ms += 1000 / 30) t.pose.emit!([squatFrame({ kneeAngle: 172 }, { view: "front", t: ms })], ms);
  });
  t.pose.emit = undefined;
  fireEvent.click(await screen.findByRole("button", { name: "Başla" }, SLOW));
}

function assertClean(captured: Captured[]) {
  expect(captured.length).toBeGreaterThan(0);
  for (const c of captured) {
    expect(leaks(c.body), `${c.method} ${c.path}`).toEqual([]);
    expect(c.bytes, `${c.method} ${c.path} size`).toBeLessThan(20_000);
  }
}

describe("AC-7.1: no video or landmarks leave the client during a session", () => {
  test("phone-owned session", async () => {
    const tenant = await generateKeyPair();
    const phoneKey = await generateKeyPair();
    const delegation = await signDelegation({ v: 1, tid: TENANT, mid: MEMBER, pk: phoneKey.publicKeyB64, consent: true, exp: NOW + 86_400_000 }, tenant.secretKey);
    const server = fakeServer({
      "GET /me/program": () => ({ memberProgramId: "c0000000-0000-4000-8000-000000000001", days: [workout], nextDayIndex: 0, safetyPause: true }),
      "GET /me": () => ({ id: MEMBER, displayName: "Ayşe", email: null, cameraConsent: true, consentVersion: "2026-11-v1" }),
      "POST /auth/member/qr-delegation": () => delegation,
      "POST /ingest": ingestOk,
      "GET /exercises": () => [], // rule pack refresh (T6.3): a bodiless read
    });
    const t = testServices({ credentials: { member: { accessToken: "a", refreshToken: "r" } } });
    wire(t, server.fetchFn as unknown as typeof fetch);
    render(
      <MemoryRouter initialEntries={["/member/session"]}>
        <App i18n={createI18n("tr")} services={t.services} />
      </MemoryRouter>,
    );
    fireEvent.click(await screen.findByRole("button", { name: "Başla" }, SLOW));
    await setupReady(t);
    await perform(t);
    await screen.findByText("Seans tamamlandı", {}, SLOW);

    await vi.waitFor(() => expect(server.captured.filter((c) => c.path === "/ingest").length).toBeGreaterThan(0));
    const sent = server.captured.filter((c) => c.path === "/ingest").flatMap((c) => (c.body as { records: { kind: string }[] }).records.map((r) => r.kind));
    expect(sent).toEqual(expect.arrayContaining(["session", "rep", "set", "session_block"]));
    assertClean(server.captured);
    expect(new Set(server.captured.map((c) => `${c.method} ${c.path}`))).toEqual(new Set(["GET /exercises", "GET /me/program", "GET /me", "POST /auth/member/qr-delegation", "POST /ingest"]));
  }, 30_000);

  test("station tablet session", async () => {
    const tenant = await generateKeyPair();
    const phone = await generateKeyPair();
    const block = workout.blocks[0]!;
    const delegation = await signDelegation({ v: 1, tid: TENANT, mid: MEMBER, pk: phone.publicKeyB64, consent: true, exp: NOW + 86_400_000 }, tenant.secretKey);
    const sid = "11111111-1111-4111-8111-111111111111";
    const qr = await createQr({ v: 1, tid: TENANT, mid: MEMBER, sid, bi: 0, si: 0, blk: block, jti: "j-1", exp: NOW + QR_TTL_MS }, phone.secretKey, delegation);
    const server = fakeServer({
      "POST /auth/device/session": () => ({ accessToken: "dev" }),
      "GET /auth/qr-public-key": () => ({ publicKey: toBase64Url(tenant.publicKey), safetyPause: true }),
      "POST /auth/qr/redeem": () => ({ memberId: MEMBER, cameraConsent: true, cursor: { sessionId: sid, blockIndex: 0, setIndex: 0 }, block }),
      "POST /ingest": ingestOk,
    });
    const t = testServices({ credentials: { device: { deviceId: "d0000000-0000-4000-8000-000000000001", deviceToken: `${TENANT}.x`, tenantId: TENANT, stationId: "s0000000-0000-4000-8000-000000000001" } } });
    wire(t, server.fetchFn as unknown as typeof fetch);
    render(
      <MemoryRouter initialEntries={["/station"]}>
        <App i18n={createI18n("tr")} services={t.services} />
      </MemoryRouter>,
    );
    await vi.waitFor(() => expect(t.scanner.onCode).toBeDefined(), SLOW);
    await act(async () => t.scanner.onCode!(qr));
    await setupReady(t);
    await perform(t);
    await screen.findByRole("heading", { name: "Telefonundan devam et" }, SLOW);

    await vi.waitFor(() => expect(server.captured.some((c) => c.path === "/ingest")).toBe(true));
    assertClean(server.captured);
    // the QR itself is sent to the server only for redemption, and holds no pose data
    const redeem = server.captured.find((c) => c.path === "/auth/qr/redeem")!;
    expect(Object.keys(redeem.body as object)).toEqual(["qr"]);
  }, 30_000);

  test("the leak detector itself catches a pose frame (so 'no leaks' means something)", () => {
    const frame = squatFrame({ kneeAngle: 120 }, { view: "front" });
    expect(leaks({ records: [{ kind: "rep", data: { frame } }] }).length).toBeGreaterThan(0);
    expect(leaks({ points: frame.image })).toContain("$.points (33-element array)");
  });

  test("the queue refuses records with extra payload (defence in depth)", async () => {
    const t = testServices();
    const server = fakeServer({ "POST /ingest": ingestOk });
    wire(t, server.fetchFn as unknown as typeof fetch);
    const sync = t.services.createSync("member");
    const bad = {
      kind: "rep",
      data: { id: "00000000-0000-4000-8000-000000000001", setId: "00000000-0000-4000-8000-000000000002", repIndex: 0, outcome: "valid", durationMs: 1, faults: [], landmarks: [[0.1, 0.2]] },
    };
    await expect(sync.push(bad as never)).rejects.toThrow(/invalid rep/);
    expect(server.captured).toEqual([]);
  });
});
