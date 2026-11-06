import { squatFrame } from "@gymspot/engine/testing";
import { QR_TTL_MS, createQr, generateKeyPair, signDelegation, toBase64Url } from "@gymspot/shared";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, test, vi } from "vitest";
import { ApiError, NetworkError } from "../api/client";
import { App } from "../App";
import { createI18n } from "../i18n";
import { testServices } from "../test-services";

afterEach(cleanup);

const NOW = Date.UTC(2026, 10, 6, 10);
const TENANT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const MEMBER = "a2000000-0000-4000-8000-000000000001";
const SESSION = "11111111-1111-4111-8111-111111111111";
const DEVICE = { deviceId: "d0000000-0000-4000-8000-000000000001", deviceToken: `${TENANT}.x`, tenantId: TENANT, stationId: "s0000000-0000-4000-8000-000000000001" };
const block = { exerciseId: "squat", exerciseVersion: 1, sets: 1, reps: 2, restSec: 30, mode: "strict" as const, stationHint: "Squat Rafı 2" };

async function memberQr(consent = true) {
  const tenant = await generateKeyPair();
  const phone = await generateKeyPair();
  const delegation = await signDelegation({ v: 1, tid: TENANT, mid: MEMBER, pk: phone.publicKeyB64, consent, exp: NOW + 3600_000 }, tenant.secretKey);
  const qr = await createQr({ v: 1, tid: TENANT, mid: MEMBER, sid: SESSION, bi: 1, si: 0, blk: block, jti: "j-1", exp: NOW + QR_TTL_MS }, phone.secretKey, delegation);
  return { qr, tenantKey: toBase64Url(tenant.publicKey) };
}

function renderStation(t: ReturnType<typeof testServices>, path = "/station") {
  render(
    <MemoryRouter initialEntries={[path]}>
      <App i18n={createI18n("tr")} services={t.services} />
    </MemoryRouter>,
  );
}

async function scan(t: ReturnType<typeof testServices>, qr: string) {
  await vi.waitFor(() => expect(t.scanner.onCode).toBeDefined());
  await act(async () => t.scanner.onCode!(qr));
}

/** Emits ~frames of standing and squats through the scripted pose source. */
async function moves(t: ReturnType<typeof testServices>, kneeAt: (ms: number) => number, durationMs: number, t0 = 0) {
  await vi.waitFor(() => expect(t.pose.emit).toBeDefined());
  await act(async () => {
    for (let ms = 0; ms <= durationMs; ms += 1000 / 30) t.pose.emit!([squatFrame({ kneeAngle: kneeAt(ms), torsoLean: 10 }, { view: "front", t: t0 + ms })], t0 + ms);
  });
}

describe("A1 pairing", () => {
  test("an unpaired tablet asks for the pairing code and moves on to scanning", async () => {
    const pairDevice = vi.fn(async () => DEVICE);
    const t = testServices({ api: { pairDevice, stationConfig: vi.fn(async () => ({ publicKey: "k", safetyPause: true })), redeemQr: vi.fn() } });
    pairDevice.mockImplementation(async () => (t.services.store.set("device", DEVICE), DEVICE));
    renderStation(t);
    expect(await screen.findByRole("heading", { name: "Cihaz eşleştirme" })).toBeTruthy(); // lazy route
    fireEvent.change(screen.getByLabelText("Eşleştirme kodu"), { target: { value: "abcd2345" } });
    fireEvent.click(screen.getByRole("button", { name: "Eşleştir" }));
    expect(await screen.findByRole("heading", { name: /QR'ı kameraya göster/ })).toBeTruthy();
    expect(pairDevice).toHaveBeenCalledWith("ABCD2345");
  });

  test("a wrong code shows an error", async () => {
    const t = testServices({ api: { pairDevice: vi.fn(async () => Promise.reject(new ApiError(401, null))) } });
    renderStation(t);
    fireEvent.change(await screen.findByLabelText("Eşleştirme kodu"), { target: { value: "WRONG123" } });
    fireEvent.click(screen.getByRole("button", { name: "Eşleştir" }));
    expect(await screen.findByText("Kod geçersiz ya da süresi dolmuş.")).toBeTruthy();
  });
});

describe("A2 check-in", () => {
  test("station screens always show the medical disclaimer and the no-video notice (rule 5, specs/07)", () => {
    renderStation(testServices({ credentials: { device: DEVICE }, api: { stationConfig: vi.fn(async () => ({ publicKey: "k", safetyPause: true })), redeemQr: vi.fn() } }));
    expect(screen.getByText("Bu sistem tıbbi tavsiye değildir. Ağrı hissedersen dur.")).toBeTruthy();
    expect(screen.getByText(/Görüntü saklanmaz/)).toBeTruthy();
  });

  test("a valid QR leads to camera setup for the delegated exercise", async () => {
    const m = await memberQr();
    const t = testServices({
      credentials: { device: DEVICE },
      api: { stationConfig: vi.fn(async () => ({ publicKey: m.tenantKey, safetyPause: true })), redeemQr: vi.fn(async () => ({ memberId: MEMBER, cameraConsent: true, cursor: { sessionId: SESSION, blockIndex: 1, setIndex: 0 }, block })) },
    });
    renderStation(t);
    await scan(t, m.qr);
    expect(await screen.findByRole("heading", { name: "Kamera kurulumu" })).toBeTruthy();
  });

  test("a reused QR is refused with a clear message", async () => {
    const m = await memberQr();
    const t = testServices({ credentials: { device: DEVICE }, api: { stationConfig: vi.fn(async () => ({ publicKey: m.tenantKey, safetyPause: true })), redeemQr: vi.fn(async () => Promise.reject(new ApiError(409, { reason: "already_used" }))) } });
    renderStation(t);
    await scan(t, m.qr);
    expect(await screen.findByText(/zaten kullanıldı/)).toBeTruthy();
  });

  test("offline: verified on the tablet with the cached key and queued for redemption", async () => {
    const m = await memberQr();
    const t = testServices({ credentials: { device: DEVICE }, online: false, api: { stationConfig: vi.fn(async () => Promise.reject(new NetworkError("offline"))), redeemQr: vi.fn(async () => Promise.reject(new NetworkError("x"))) } });
    t.storage.setItem("gymspot.station.qrKey", JSON.stringify(m.tenantKey));
    renderStation(t);
    expect(await screen.findByText(/Çevrimdışı mod/)).toBeTruthy();
    await scan(t, m.qr);
    expect(await screen.findByRole("heading", { name: "Kamera kurulumu" })).toBeTruthy();
    expect(JSON.parse(t.storage.getItem("gymspot.station.pending")!)).toEqual([m.qr]);
  });

  test("AC-7.4: without camera consent the camera is not opened", async () => {
    const m = await memberQr(false);
    const t = testServices({ credentials: { device: DEVICE }, online: false, api: { stationConfig: vi.fn(async () => Promise.reject(new NetworkError("offline"))), redeemQr: vi.fn() } });
    t.storage.setItem("gymspot.station.qrKey", JSON.stringify(m.tenantKey));
    renderStation(t);
    await scan(t, m.qr);
    expect(await screen.findByText(/Kamera rızan olmadığı için/)).toBeTruthy();
    expect(t.pose.sources).toBe(0); // no pose source was created for a session
  });
});

describe("executor run (specs/03 devir)", () => {
  test("the delegated block runs on the tablet, records go out as the device, then back to waiting", async () => {
    const m = await memberQr();
    const t = testServices({
      credentials: { device: DEVICE },
      api: { stationConfig: vi.fn(async () => ({ publicKey: m.tenantKey, safetyPause: true })), redeemQr: vi.fn(async () => ({ memberId: MEMBER, cameraConsent: true, cursor: { sessionId: SESSION, blockIndex: 1, setIndex: 0 }, block })) },
    });
    render(
      <MemoryRouter initialEntries={["/station"]}>
        <App i18n={createI18n("tr")} services={t.services} />
      </MemoryRouter>,
    );
    await scan(t, m.qr);
    await screen.findByRole("heading", { name: "Kamera kurulumu" });
    await moves(t, () => 172, 1100); // standing in view: setup gets ready
    fireEvent.click(await screen.findByRole("button", { name: "Başla" }));

    // ready pose (1.5 s) → countdown (3 s) → two squats
    t.pose.emit = undefined;
    const squat = (ms: number) => {
      const rep = (start: number) => {
        const p = (ms - start) / 2000;
        return p > 0 && p < 1 ? (1 - Math.cos(2 * Math.PI * p)) / 2 : 0;
      };
      return 172 - 82 * Math.max(rep(5000), rep(7800));
    };
    await vi.waitFor(() => expect(t.pose.emit).toBeDefined());
    await act(async () => {
      for (let ms = 0; ms <= 11000; ms += 1000 / 30) {
        t.clock.now = NOW + ms;
        t.pose.emit!([squatFrame({ kneeAngle: squat(ms), torsoLean: 10 }, { view: "front", t: ms })], ms);
      }
    });

    expect(await screen.findByRole("heading", { name: "Telefonundan devam et" })).toBeTruthy();
    const kinds = t.records.map((r) => `${r.as}:${r.record.kind}`);
    expect(kinds).toEqual(["device:rep", "device:rep", "device:set", "device:session_block"]);
    expect(t.records.at(-1)!.record.data).toMatchObject({ sessionId: SESSION, position: 1, executedByDeviceId: DEVICE.deviceId, stationId: DEVICE.stationId, status: "done" });
  }, 20_000);
});
