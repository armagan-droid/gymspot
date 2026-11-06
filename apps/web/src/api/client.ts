import type { PersistRecord } from "@gymspot/engine";
import type { Block, SessionCursor, SignedDelegation, Workout } from "@gymspot/shared";
import type { IngestResult } from "../sync/queue";

// Typed API client (apps/api). Tokens live in an injected store (localStorage in the app).

export interface DeviceCredentials {
  deviceId: string;
  deviceToken: string;
  tenantId: string;
  stationId: string;
}

export interface MemberCredentials {
  accessToken: string;
  refreshToken: string;
}

export interface MemberProgram {
  memberProgramId: string;
  days: Workout[];
  nextDayIndex: number;
}

export interface MemberProfile {
  id: string;
  displayName: string;
  email: string | null;
  cameraConsent: boolean;
  consentVersion: string | null;
}

export interface SessionSummary {
  id: string;
  workoutDayIndex: number;
  startedAt: string;
  endedAt: string | null;
  status: string;
}

export interface SessionDetail extends SessionSummary {
  blocks: {
    position: number;
    exerciseId: string;
    status: string;
    plannedSets: number;
    sets: { setIndex: number; plannedReps: number | null; validReps: number; faultyReps: number; incompleteReps: number; faults: { faultId: string; count: number }[] }[];
  }[];
}

export interface ProgressRow {
  week: string;
  exerciseId: string;
  valid: number;
  faulty: number;
  incomplete: number;
  cleanRatio: number | null;
}

export interface RedeemResult {
  memberId: string;
  cameraConsent: boolean;
  cursor: SessionCursor;
  block: Block;
}

/** device/member credentials, and the member's gym (tenant) remembered from the invite link. */
export type CredentialKey = "device" | "member" | "tenant";

export interface CredentialStore {
  get<T>(key: CredentialKey): T | null;
  set(key: CredentialKey, value: unknown): void;
  clear(key: CredentialKey): void;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly body: { error?: string; reason?: string } | null,
  ) {
    super(`API ${status}: ${body?.error ?? "error"}`);
  }
}

/** Network failure (offline, DNS, CORS): callers fall back to offline paths. */
export class NetworkError extends Error {}

export interface GymApi {
  pairDevice(code: string): Promise<DeviceCredentials>;
  qrPublicKey(): Promise<string>;
  redeemQr(qr: string): Promise<RedeemResult>;
  ingestAsDevice(records: PersistRecord[]): Promise<IngestResult[]>;
  memberProgram(): Promise<MemberProgram>;
  me(): Promise<MemberProfile>;
  requestMagicLink(tenantId: string, email: string): Promise<void>;
  /** Signs the member in; the gym is taken from the token's tenant prefix and remembered. */
  verifyMagicLink(token: string): Promise<void>;
  signOutMember(): Promise<void>;
  giveConsent(version: string): Promise<void>;
  withdrawConsent(): Promise<void>;
  mySessions(): Promise<SessionSummary[]>;
  mySession(id: string): Promise<SessionDetail>;
  myProgress(): Promise<ProgressRow[]>;
  exportMyData(): Promise<unknown>;
  requestDeletion(): Promise<void>;
  qrDelegation(publicKey: string): Promise<SignedDelegation>;
  ingestAsMember(records: PersistRecord[]): Promise<IngestResult[]>;
}

export function localCredentialStore(storage: Storage = localStorage): CredentialStore {
  return {
    get: <T,>(key: string) => {
      const v = storage.getItem(`gymspot.${key}`);
      return v ? (JSON.parse(v) as T) : null;
    },
    set: (key, value) => storage.setItem(`gymspot.${key}`, JSON.stringify(value)),
    clear: (key) => storage.removeItem(`gymspot.${key}`),
  };
}

export function createGymApi({ baseUrl, store, fetchFn = fetch }: { baseUrl: string; store: CredentialStore; fetchFn?: typeof fetch }): GymApi {
  let deviceAccess: string | null = null;

  async function raw(method: string, path: string, body?: unknown, token?: string | null) {
    let res: Response;
    try {
      res = await fetchFn(`${baseUrl}${path}`, {
        method,
        headers: { ...(body !== undefined && { "content-type": "application/json" }), ...(token && { authorization: `Bearer ${token}` }) },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (e) {
      throw new NetworkError(String(e));
    }
    const json = res.status === 204 ? null : await res.json().catch(() => null);
    if (!res.ok) throw new ApiError(res.status, json);
    return json;
  }

  async function asDevice(method: string, path: string, body?: unknown) {
    const creds = store.get<DeviceCredentials>("device");
    if (!creds) throw new ApiError(401, { error: "not_paired" });
    for (let attempt = 0; attempt < 2; attempt++) {
      deviceAccess ??= ((await raw("POST", "/auth/device/session", { deviceToken: creds.deviceToken })) as { accessToken: string }).accessToken;
      try {
        return await raw(method, path, body, deviceAccess);
      } catch (e) {
        if (!(e instanceof ApiError) || e.status !== 401 || attempt === 1) throw e;
        deviceAccess = null; // expired: start a new device session
      }
    }
  }

  async function asMember(method: string, path: string, body?: unknown) {
    for (let attempt = 0; attempt < 2; attempt++) {
      const creds = store.get<MemberCredentials>("member");
      if (!creds) throw new ApiError(401, { error: "not_signed_in" });
      try {
        return await raw(method, path, body, creds.accessToken);
      } catch (e) {
        if (!(e instanceof ApiError) || e.status !== 401 || attempt === 1) throw e;
        try {
          store.set("member", await raw("POST", "/auth/refresh", { refreshToken: creds.refreshToken }));
        } catch (refreshError) {
          if (refreshError instanceof ApiError) store.clear("member");
          throw refreshError;
        }
      }
    }
  }

  return {
    async pairDevice(code) {
      const creds = (await raw("POST", "/auth/device/pair", { code })) as DeviceCredentials;
      store.set("device", creds);
      deviceAccess = null;
      return creds;
    },
    qrPublicKey: async () => ((await asDevice("GET", "/auth/qr-public-key")) as { publicKey: string }).publicKey,
    redeemQr: async (qr) => (await asDevice("POST", "/auth/qr/redeem", { qr })) as RedeemResult,
    ingestAsDevice: async (records) => ((await asDevice("POST", "/ingest", { records })) as { results: IngestResult[] }).results,
    memberProgram: async () => (await asMember("GET", "/me/program")) as MemberProgram,
    me: async () => (await asMember("GET", "/me")) as MemberProfile,
    requestMagicLink: async (tenantId, email) => void (await raw("POST", "/auth/member/magic-link", { tenantId, email })),
    async verifyMagicLink(token) {
      store.set("member", await raw("POST", "/auth/member/verify", { token }));
      const tenant = token.split(".")[0];
      if (tenant) store.set("tenant", tenant);
    },
    async signOutMember() {
      const creds = store.get<MemberCredentials>("member");
      store.clear("member");
      if (creds) await raw("POST", "/auth/logout", { refreshToken: creds.refreshToken }).catch(() => undefined);
    },
    giveConsent: async (version) => void (await asMember("POST", "/me/consent", { version })),
    withdrawConsent: async () => void (await asMember("DELETE", "/me/consent")),
    mySessions: async () => (await asMember("GET", "/me/sessions")) as SessionSummary[],
    mySession: async (id) => (await asMember("GET", `/me/sessions/${encodeURIComponent(id)}`)) as SessionDetail,
    myProgress: async () => (await asMember("GET", "/me/progress")) as ProgressRow[],
    exportMyData: async () => asMember("GET", "/me/export"),
    requestDeletion: async () => void (await asMember("POST", "/me/data-requests", { kind: "delete" })),
    qrDelegation: async (publicKey) => (await asMember("POST", "/auth/member/qr-delegation", { publicKey })) as SignedDelegation,
    ingestAsMember: async (records) => ((await asMember("POST", "/ingest", { records })) as { results: IngestResult[] }).results,
  };
}
