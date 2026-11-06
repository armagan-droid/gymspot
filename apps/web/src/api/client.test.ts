import { describe, expect, test, vi } from "vitest";
import { ApiError, type CredentialStore, NetworkError, createGymApi } from "./client";

function memoryStore(initial: Record<string, unknown> = {}): CredentialStore & { data: Record<string, unknown> } {
  const data = { ...initial };
  return { data, get: (k) => (data[k] as never) ?? null, set: (k, v) => void (data[k] = v), clear: (k) => void delete data[k] };
}

type Route = (body: unknown, auth: string | null) => { status: number; json?: unknown };
function fakeFetch(routes: Record<string, Route>) {
  return vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const path = String(url).replace("https://api.test", "");
    const key = `${init?.method} ${path}`;
    const route = routes[key];
    if (!route) throw new TypeError(`no route ${key}`);
    const auth = (init?.headers as Record<string, string> | undefined)?.authorization?.replace("Bearer ", "") ?? null;
    const r = route(init?.body ? JSON.parse(String(init.body)) : undefined, auth);
    return new Response(r.json === undefined ? null : JSON.stringify(r.json), { status: r.status });
  });
}

describe("GymApi client", () => {
  test("pairing stores device credentials; device calls open a device session first", async () => {
    const store = memoryStore();
    const fetchFn = fakeFetch({
      "POST /auth/device/pair": () => ({ status: 200, json: { deviceId: "d1", deviceToken: "t.x", tenantId: "t", stationId: "s" } }),
      "POST /auth/device/session": (b) => ({ status: 200, json: { accessToken: `acc-for-${(b as { deviceToken: string }).deviceToken}` } }),
      "GET /auth/qr-public-key": (_b, auth) => (auth === "acc-for-t.x" ? { status: 200, json: { publicKey: "PK", safetyPause: true } } : { status: 401 }),
    });
    const api = createGymApi({ baseUrl: "https://api.test", store, fetchFn });
    await api.pairDevice("ABCD2345");
    expect(store.data.device).toMatchObject({ deviceId: "d1" });
    expect((await api.stationConfig()).publicKey).toBe("PK");
  });

  test("an expired device access token is renewed once", async () => {
    let n = 0;
    const store = memoryStore({ device: { deviceId: "d1", deviceToken: "t.x", tenantId: "t", stationId: "s" } });
    const fetchFn = fakeFetch({
      "POST /auth/device/session": () => ({ status: 200, json: { accessToken: `acc${++n}` } }),
      "GET /auth/qr-public-key": (_b, auth) => (auth === "acc2" ? { status: 200, json: { publicKey: "PK", safetyPause: true } } : { status: 401 }),
    });
    const api = createGymApi({ baseUrl: "https://api.test", store, fetchFn });
    expect((await api.stationConfig()).publicKey).toBe("PK");
    expect(n).toBe(2);
  });

  test("member calls refresh the token on 401 and store the new pair", async () => {
    const store = memoryStore({ member: { accessToken: "old", refreshToken: "r1" } });
    const fetchFn = fakeFetch({
      "POST /auth/refresh": () => ({ status: 200, json: { accessToken: "new", refreshToken: "r2" } }),
      "GET /me/program": (_b, auth) => (auth === "new" ? { status: 200, json: { memberProgramId: "p", days: [], nextDayIndex: 0 } } : { status: 401 }),
    });
    const api = createGymApi({ baseUrl: "https://api.test", store, fetchFn });
    expect(await api.memberProgram()).toMatchObject({ memberProgramId: "p" });
    expect(store.data.member).toEqual({ accessToken: "new", refreshToken: "r2" });
  });

  test("a failed refresh signs the member out", async () => {
    const store = memoryStore({ member: { accessToken: "old", refreshToken: "r1" } });
    const fetchFn = fakeFetch({ "POST /auth/refresh": () => ({ status: 401 }), "GET /me/program": () => ({ status: 401 }) });
    const api = createGymApi({ baseUrl: "https://api.test", store, fetchFn });
    await expect(api.memberProgram()).rejects.toBeInstanceOf(ApiError);
    expect(store.data.member).toBeUndefined();
  });

  test("network failures surface as NetworkError (offline path)", async () => {
    const store = memoryStore({ device: { deviceId: "d1", deviceToken: "t.x", tenantId: "t", stationId: "s" } });
    const api = createGymApi({ baseUrl: "https://api.test", store, fetchFn: vi.fn(async () => Promise.reject(new TypeError("Failed to fetch"))) });
    await expect(api.redeemQr("x")).rejects.toBeInstanceOf(NetworkError);
  });

  test("API errors keep status and reason", async () => {
    const store = memoryStore({ device: { deviceId: "d1", deviceToken: "t.x", tenantId: "t", stationId: "s" } });
    const fetchFn = fakeFetch({
      "POST /auth/device/session": () => ({ status: 200, json: { accessToken: "a" } }),
      "POST /auth/qr/redeem": () => ({ status: 409, json: { error: "invalid_qr", reason: "already_used" } }),
    });
    const api = createGymApi({ baseUrl: "https://api.test", store, fetchFn });
    await expect(api.redeemQr("x")).rejects.toMatchObject({ status: 409, body: { reason: "already_used" } });
  });
});
