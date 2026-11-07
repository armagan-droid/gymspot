import type { LandmarkSequence } from "@gymspot/shared";
import { ApiError, type CredentialStore, type SessionSummary, NetworkError } from "./client";

// Staff API for the admin panel (C1–C10). Separate from the device/member client.

export type StaffRole = "owner" | "manager" | "trainer";

export interface StaffCredentials {
  accessToken: string;
  refreshToken: string;
}

export interface MemberRow {
  id: string;
  displayName: string;
  email: string | null;
  phone: string | null;
  status: string;
  cameraConsent: boolean;
}

export interface StationRow {
  id: string;
  name: string;
  exerciseIds: string[];
  devices: { id: string; kind: string; lastSeenAt: string | null }[];
}

export interface TemplateBlock {
  dayIndex: number;
  position: number;
  exerciseId: string;
  sets: number;
  reps?: number;
  durationSec?: number;
  restSec: number;
  mode: "strict" | "lenient";
  stationHint?: string;
}

export interface Template {
  id: string;
  name: string;
  blocks: TemplateBlock[];
}

export interface TenantSettings {
  defaultMode: "strict" | "lenient";
  retentionMonths: number;
  safetyPause: boolean;
}

export interface StaffApi {
  login(tenantId: string, email: string, password: string): Promise<void>;
  signOut(): Promise<void>;
  /** Role from the access token (UI gating only; the API enforces it). */
  role(): StaffRole | null;
  overview(): Promise<{ activeSessions: number; sessionsToday: number; stations: { id: string; name: string; devices: number; lastSeenAt: string | null }[] }>;
  stations(): Promise<StationRow[]>;
  createStation(name: string, exerciseIds: string[]): Promise<{ id: string }>;
  pairingCode(stationId: string): Promise<{ code: string; expiresAt: string }>;
  removeDevice(deviceId: string): Promise<void>;
  members(q?: string): Promise<MemberRow[]>;
  createMember(body: { displayName: string; email?: string; invite?: boolean }): Promise<MemberRow>;
  member(id: string): Promise<MemberRow>;
  /** AC-7.7: a fresh single-use sign-in link (15 min), shown once to a manager. */
  memberLoginLink(id: string): Promise<{ link: string; expiresAt: string }>;
  memberSessions(id: string): Promise<SessionSummary[]>;
  memberInsights(id: string): Promise<{ topFaults: { exerciseId: string; faultId: string; count: number }[]; weeklySessions: { week: string; sessions: number }[] }>;
  trainers(): Promise<{ id: string; email: string }[]>;
  assignTrainer(memberId: string, userId: string): Promise<void>;
  templates(): Promise<{ id: string; name: string; blockCount: number }[]>;
  template(id: string): Promise<Template>;
  saveTemplate(id: string | null, body: { name: string; blocks: TemplateBlock[] }): Promise<{ id: string }>;
  deleteTemplate(id: string): Promise<void>;
  assignProgram(memberId: string, templateId: string, startDate: string): Promise<void>;
  settings(): Promise<TenantSettings>;
  saveSettings(s: TenantSettings): Promise<TenantSettings>;
  users(): Promise<{ id: string; email: string; role: StaffRole; status: string }[]>;
  createUser(body: { email: string; role: StaffRole; password: string }): Promise<void>;
  /** AC-7.2: carry out a deletion request. */
  completeDataRequest(id: string): Promise<void>;
  dataRequests(): Promise<{ id: string; kind: string; memberName: string; requestedAt: string; completedAt: string | null }[]>;
  calibrationConsent(body: { participantRef: string; consentVersion: string; consentedAt: string }): Promise<{ id: string }>;
  uploadCalibration(consentId: string, sequence: LandmarkSequence): Promise<{ id: string }>;
}

function decodeRole(token: string): StaffRole | null {
  try {
    const payload = JSON.parse(atob(token.split(".")[1]!.replace(/-/g, "+").replace(/_/g, "/"))) as { role?: StaffRole };
    return payload.role ?? null;
  } catch {
    return null;
  }
}

export function createStaffApi({ baseUrl, store, fetchFn = fetch }: { baseUrl: string; store: CredentialStore; fetchFn?: typeof fetch }): StaffApi {
  async function raw(method: string, path: string, body?: unknown, token?: string) {
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

  async function call(method: string, path: string, body?: unknown) {
    for (let attempt = 0; attempt < 2; attempt++) {
      const creds = store.get<StaffCredentials>("staff");
      if (!creds) throw new ApiError(401, { error: "not_signed_in" });
      try {
        return await raw(method, path, body, creds.accessToken);
      } catch (e) {
        if (!(e instanceof ApiError) || e.status !== 401 || attempt === 1) throw e;
        try {
          store.set("staff", await raw("POST", "/auth/refresh", { refreshToken: creds.refreshToken }));
        } catch (refreshError) {
          if (refreshError instanceof ApiError) store.clear("staff");
          throw refreshError;
        }
      }
    }
  }

  const q = (s: string) => encodeURIComponent(s);
  return {
    async login(tenantId, email, password) {
      store.set("staff", await raw("POST", "/auth/staff/login", { tenantId, email, password }));
      store.set("staffTenant", tenantId);
    },
    async signOut() {
      const creds = store.get<StaffCredentials>("staff");
      store.clear("staff");
      if (creds) await raw("POST", "/auth/logout", { refreshToken: creds.refreshToken }).catch(() => undefined);
    },
    role: () => {
      const creds = store.get<StaffCredentials>("staff");
      return creds ? decodeRole(creds.accessToken) : null;
    },
    overview: () => call("GET", "/admin/overview"),
    stations: () => call("GET", "/stations"),
    createStation: (name, exerciseIds) => call("POST", "/stations", { name, exerciseIds }),
    pairingCode: (id) => call("POST", `/stations/${q(id)}/pairing-code`, {}),
    removeDevice: async (id) => void (await call("DELETE", `/devices/${q(id)}`)),
    members: (s) => call("GET", `/members${s ? `?q=${q(s)}` : ""}`),
    createMember: (body) => call("POST", "/members", body),
    member: (id) => call("GET", `/members/${q(id)}`),
    memberLoginLink: (id) => call("POST", `/members/${q(id)}/login-link`),
    memberSessions: (id) => call("GET", `/members/${q(id)}/sessions`),
    memberInsights: (id) => call("GET", `/members/${q(id)}/insights`),
    trainers: () => call("GET", "/trainers"),
    assignTrainer: async (m, u) => void (await call("PUT", `/members/${q(m)}/trainers/${q(u)}`)),
    templates: () => call("GET", "/program-templates"),
    template: (id) => call("GET", `/program-templates/${q(id)}`),
    saveTemplate: (id, body) => (id ? call("PUT", `/program-templates/${q(id)}`, body) : call("POST", "/program-templates", body)),
    deleteTemplate: async (id) => void (await call("DELETE", `/program-templates/${q(id)}`)),
    assignProgram: async (m, templateId, startDate) => void (await call("POST", `/members/${q(m)}/programs`, { templateId, startDate })),
    settings: () => call("GET", "/settings"),
    saveSettings: (s) => call("PUT", "/settings", s),
    users: () => call("GET", "/users"),
    createUser: async (body) => void (await call("POST", "/users", body)),
    dataRequests: () => call("GET", "/data-requests"),
    completeDataRequest: async (id) => void (await call("POST", `/data-requests/${q(id)}/complete`, {})),
    calibrationConsent: (body) => call("POST", "/calibration/consents", body),
    uploadCalibration: (consentId, sequence) => call("POST", "/calibration/recordings", { consentId, sequence }),
  };
}
