import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { FastifyInstance } from "fastify";
import { type Kysely, sql } from "kysely";
import { buildApp } from "../src/app";
import { hashPassword } from "../src/auth/password";
import type { AppConfig } from "../src/config";
import type { Database } from "../src/db/db";

export const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
export const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
export const PASSWORD = "doğru-parola-123";
export const T0 = Date.UTC(2026, 10, 6, 10);

export const rulePackJson = (id: string) =>
  readFileSync(fileURLToPath(new URL(`../../../exercises/${id}.json`, import.meta.url)), "utf8");

/** Two tenants, staff in each role, global rule packs. Returns ids. */
export async function seedTenants(db: Kysely<Database>) {
  const pw = await hashPassword(PASSWORD);
  const ids = {
    ownerA: "a1000000-0000-4000-8000-000000000001",
    managerA: "a1000000-0000-4000-8000-000000000003",
    trainerA: "a1000000-0000-4000-8000-000000000002",
    trainer2A: "a1000000-0000-4000-8000-000000000004",
    managerB: "b1000000-0000-4000-8000-000000000003",
  };
  for (const q of [
    sql`truncate tenants, exercises cascade`,
    sql`insert into tenants (id, name) values (${A}, 'Salon A'), (${B}, 'Salon B')`,
    sql`insert into users (id, tenant_id, email, password_hash, role) values
          (${ids.ownerA}, ${A}, 'sahip@a.test', ${pw}, 'owner'),
          (${ids.managerA}, ${A}, 'yonetici@a.test', ${pw}, 'manager'),
          (${ids.trainerA}, ${A}, 'pt@a.test', ${pw}, 'trainer'),
          (${ids.trainer2A}, ${A}, 'pt2@a.test', ${pw}, 'trainer'),
          (${ids.managerB}, ${B}, 'yonetici@b.test', ${pw}, 'manager')`,
    sql`insert into exercises (id, version, definition_json, status, tenant_id) values
          ('squat', 1, ${rulePackJson("squat")}::jsonb, 'draft', null),
          ('pushup', 1, ${rulePackJson("pushup")}::jsonb, 'draft', null)`,
  ]) {
    await q.execute(db);
  }
  return ids;
}

export interface TestApi {
  app: FastifyInstance;
  sent: { to: string; link: string }[];
  clock: { now: number };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- tests read arbitrary JSON responses
  call(method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE", url: string, token?: string, body?: unknown): Promise<{ status: number; json: () => any }>;
  staffToken(email: string, tenantId?: string): Promise<string>;
  memberToken(email: string, tenantId?: string): Promise<string>;
}

export function testApi(db: Kysely<Database>, overrides: Partial<AppConfig> = {}): TestApi {
  const sent: { to: string; link: string }[] = [];
  const clock = { now: T0 };
  const app = buildApp({
    db,
    config: {
      jwtSecret: "test-jwt-secret-at-least-32-bytes-long!!",
      qrMasterSecret: "test-qr-master-secret",
      appBaseUrl: "https://app.test",
      now: () => clock.now,
      sendMagicLink: async (to, link) => void sent.push({ to, link }),
      authRateLimit: 10_000,
      ...overrides,
    },
  });
  const call: TestApi["call"] = async (method, url, token, body) => {
    const res = await app.inject({ method, url, payload: body as object, headers: token ? { authorization: `Bearer ${token}` } : {} });
    return { status: res.statusCode, json: () => res.json() };
  };
  return {
    app,
    sent,
    clock,
    call,
    async staffToken(email, tenantId = A) {
      const r = await call("POST", "/auth/staff/login", undefined, { tenantId, email, password: PASSWORD });
      if (r.status !== 200) throw new Error(`login failed for ${email}: ${r.status}`);
      return r.json().accessToken;
    },
    async memberToken(email, tenantId = A) {
      await call("POST", "/auth/member/magic-link", undefined, { tenantId, email });
      const token = new URL(sent.at(-1)!.link).searchParams.get("token")!;
      return (await call("POST", "/auth/member/verify", undefined, { token })).json().accessToken;
    },
  };
}
