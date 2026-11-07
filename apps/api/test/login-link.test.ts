import { type Kysely, sql } from "kysely";
import { afterAll, beforeAll, beforeEach, describe, expect, inject, test } from "vitest";
import { MAGIC_LINK_TTL_MS } from "../src/auth/tokens";
import { type Database, createDb } from "../src/db/db";
import { B, type TestApi, seedTenants, testApi } from "./helpers";

// AC-7.7: staff-generated sign-in links (specs/07, C6).

let db: Kysely<Database>;
let api: TestApi;
let manager: string;
let memberId: string;

beforeAll(async () => {
  db = createDb(inject("databaseUrl"));
});
afterAll(async () => db.destroy());
beforeEach(async () => {
  await seedTenants(db);
  api = testApi(db);
  manager = await api.staffToken("yonetici@a.test");
  memberId = (await api.call("POST", "/members", manager, { displayName: "Ayşe", email: "ayse@a.test" })).json().id;
});

const tokenOf = (link: string) => new URL(link).searchParams.get("token")!;

describe("POST /members/:id/login-link (AC-7.7)", () => {
  test("a manager gets a fresh single-use link; it signs the member in once", async () => {
    const res = await api.call("POST", `/members/${memberId}/login-link`, manager);
    expect(res.status).toBe(201);
    const { link, expiresAt } = res.json();
    expect(link).toMatch(/^https:\/\/app\.test\/member\/login\?token=/);
    expect(Date.parse(expiresAt) - api.clock.now).toBe(MAGIC_LINK_TTL_MS);
    expect(api.sent).toEqual([]); // shown, not e-mailed

    const first = await api.call("POST", "/auth/member/verify", undefined, { token: tokenOf(link) });
    expect(first.status).toBe(200);
    expect((await api.call("POST", "/auth/member/verify", undefined, { token: tokenOf(link) })).status).toBe(401);
  });

  test("it expires after 15 minutes", async () => {
    const { link } = (await api.call("POST", `/members/${memberId}/login-link`, manager)).json();
    api.clock.now += MAGIC_LINK_TTL_MS + 1;
    expect((await api.call("POST", "/auth/member/verify", undefined, { token: tokenOf(link) })).status).toBe(401);
  });

  test("every link is written to the audit log", async () => {
    await api.call("POST", `/members/${memberId}/login-link`, manager);
    const rows = (await sql<{ action: string; target: string; actor: string }>`select action, target, actor from audit_log where action = 'member_login_link_created'`.execute(db)).rows;
    expect(rows).toEqual([{ action: "member_login_link_created", target: `member:${memberId}`, actor: expect.stringMatching(/^user:/) }]);
  });

  test("trainers cannot create links; other gyms cannot see the member", async () => {
    const trainer = await api.staffToken("pt@a.test");
    const managerB = await api.staffToken("yonetici@b.test", B);
    expect((await api.call("POST", `/members/${memberId}/login-link`, trainer)).status).toBe(403);
    expect((await api.call("POST", `/members/${memberId}/login-link`, managerB)).status).toBe(404);
    expect((await api.call("POST", `/members/${memberId}/login-link`)).status).toBe(401);
  });

  test("no link for an erased member", async () => {
    await sql`update members set status = 'anonymized', email = null where id = ${memberId}`.execute(db);
    expect((await api.call("POST", `/members/${memberId}/login-link`, manager)).status).toBe(404);
  });
});
