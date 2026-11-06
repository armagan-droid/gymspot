import { QR_TTL_MS, type Workout, createQr, generateKeyPair, signDelegation, toBase64Url } from "@gymspot/shared";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, test, vi } from "vitest";
import { App } from "../App";
import { createI18n } from "../i18n";
import { testServices } from "../test-services";

// A5-e camera-less sets (specs/03 rule 14, specs/07, AC-8.3).

afterEach(cleanup);

const NOW = Date.UTC(2026, 10, 6, 10);
const TENANT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const MEMBER = "a2000000-0000-4000-8000-000000000001";
const workout: Workout = { id: "mp-1:0", name: "A · 1", blocks: [{ exerciseId: "squat", exerciseVersion: 1, sets: 2, reps: 10, restSec: 30, mode: "strict" }] };

async function phone(o: { consent: boolean; cameraDenied?: boolean }) {
  const tenant = await generateKeyPair();
  const phoneKey = await generateKeyPair();
  const delegation = await signDelegation({ v: 1, tid: TENANT, mid: MEMBER, pk: phoneKey.publicKeyB64, consent: o.consent, exp: NOW + 86_400_000 }, tenant.secretKey);
  const t = testServices({
    credentials: { member: { accessToken: "a", refreshToken: "r" } },
    api: {
      memberProgram: vi.fn(async () => ({ memberProgramId: "c0000000-0000-4000-8000-000000000001", days: [workout], nextDayIndex: 0, safetyPause: true })),
      me: vi.fn(async () => ({ id: MEMBER, displayName: "Ayşe", email: null, cameraConsent: o.consent, consentVersion: o.consent ? "2026-11-v1" : null })),
      qrDelegation: vi.fn(async () => delegation),
    },
  });
  if (o.cameraDenied) t.services.requestCamera = vi.fn(async () => ({ ok: false as const, reason: "denied" as const }));
  render(
    <MemoryRouter initialEntries={["/member/session"]}>
      <App i18n={createI18n("tr")} services={t.services} />
    </MemoryRouter>,
  );
  fireEvent.click(await screen.findByRole("button", { name: "Başla" }));
  return t;
}

describe("phone: camera-less sets", () => {
  test("without consent: 'log manually' records a manual set and never opens the camera", async () => {
    const t = await phone({ consent: false });
    expect(await screen.findByText(/önce açık rıza vermelisin/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Elle kaydet" }));
    const input = await screen.findByLabelText("Yapılan tekrar (hedef 10)");
    expect((input as HTMLInputElement).value).toBe("10");
    fireEvent.change(input, { target: { value: "8" } });
    fireEvent.click(screen.getByRole("button", { name: "Seti kaydet" }));
    expect(await screen.findByRole("heading", { name: "Dinlenme" })).toBeTruthy();
    expect(screen.getByText("8 tekrar · 8 temiz")).toBeTruthy();
    await vi.waitFor(() => expect(t.records.some((r) => r.record.kind === "set")).toBe(true));
    expect(t.records.find((r) => r.record.kind === "set")!.record.data).toMatchObject({ source: "manual", validReps: 8, belowTarget: true });
    expect(t.records.some((r) => r.record.kind === "rep")).toBe(false);
    expect(t.services.requestCamera).not.toHaveBeenCalled();
    expect(t.pose.sources).toBeLessThanOrEqual(1); // created for setup, never started
  });

  test("AC-8.3: camera permission denied → A9 → log manually", async () => {
    await phone({ consent: true, cameraDenied: true });
    expect(await screen.findByText(/Kamera izni verilmedi/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Elle kaydet" }));
    expect(await screen.findByRole("button", { name: "Seti kaydet" })).toBeTruthy();
  });

  test("manual mode continues through rest to the next set", async () => {
    const t = await phone({ consent: false });
    fireEvent.click(await screen.findByRole("button", { name: "Elle kaydet" }));
    fireEvent.click(await screen.findByRole("button", { name: "Seti kaydet" }));
    fireEvent.click(await screen.findByRole("button", { name: "Hazırım" }));
    expect(await screen.findByText("Set 2 / 2")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Seti kaydet" }));
    expect(await screen.findByText("Seans tamamlandı")).toBeTruthy();
    await vi.waitFor(() => expect(t.records.filter((r) => r.record.kind === "set")).toHaveLength(2));
  });
});

describe("station tablet: camera-less block", () => {
  async function station(o: { consent: boolean; cameraDenied?: boolean }) {
    const tenant = await generateKeyPair();
    const phoneKey = await generateKeyPair();
    const block = { exerciseId: "squat", exerciseVersion: 1, sets: 1, reps: 10, restSec: 30, mode: "strict" as const };
    const delegation = await signDelegation({ v: 1, tid: TENANT, mid: MEMBER, pk: phoneKey.publicKeyB64, consent: o.consent, exp: NOW + 86_400_000 }, tenant.secretKey);
    const sid = "11111111-1111-4111-8111-111111111111";
    const qr = await createQr({ v: 1, tid: TENANT, mid: MEMBER, sid, bi: 0, si: 0, blk: block, jti: "j-1", exp: NOW + QR_TTL_MS }, phoneKey.secretKey, delegation);
    const t = testServices({
      credentials: { device: { deviceId: "d0000000-0000-4000-8000-000000000001", deviceToken: `${TENANT}.x`, tenantId: TENANT, stationId: "s0000000-0000-4000-8000-000000000001" } },
      online: false,
      api: { stationConfig: vi.fn(async () => Promise.reject(new Error("offline"))) },
    });
    t.storage.setItem("gymspot.station.qrKey", JSON.stringify(toBase64Url(tenant.publicKey)));
    render(
      <MemoryRouter initialEntries={["/station"]}>
        <App i18n={createI18n("tr")} services={t.services} />
      </MemoryRouter>,
    );
    await vi.waitFor(() => expect(t.scanner.onCode).toBeDefined());
    if (o.cameraDenied) t.services.requestCamera = vi.fn(async () => ({ ok: false as const, reason: "unavailable" as const }));
    await act(async () => t.scanner.onCode!(qr));
    return t;
  }

  test("camera unavailable at setup → manual block, recorded as the device, then back to the phone", async () => {
    const t = await station({ consent: true, cameraDenied: true });
    fireEvent.click(await screen.findByRole("button", { name: "Elle kaydet" }));
    fireEvent.change(await screen.findByLabelText("Yapılan tekrar (hedef 10)"), { target: { value: "10" } });
    fireEvent.click(screen.getByRole("button", { name: "Seti kaydet" }));
    expect(await screen.findByRole("heading", { name: "Telefonundan devam et" })).toBeTruthy();
    expect(t.records.map((r) => `${r.as}:${r.record.kind}`)).toEqual(["device:set", "device:session_block"]);
    expect(t.records[0]!.record.data).toMatchObject({ source: "manual", validReps: 10, belowTarget: false });
  });

  test("no consent → the tablet offers manual logging instead of the camera", async () => {
    const t = await station({ consent: false });
    expect(await screen.findByText(/Kamera rızan olmadığı için/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Elle kaydet" }));
    expect(await screen.findByRole("button", { name: "Seti kaydet" })).toBeTruthy();
    expect(t.pose.sources).toBe(0);
  });
});
