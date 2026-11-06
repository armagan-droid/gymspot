import { WorkoutSchema } from "@gymspot/shared";
import { type Kysely, sql } from "kysely";
import { afterAll, beforeAll, beforeEach, describe, expect, inject, test } from "vitest";
import { type Database, createDb } from "../src/db/db";
import { B, type TestApi, seedTenants, testApi } from "./helpers";

let db: Kysely<Database>;
let api: TestApi;
let ids: Awaited<ReturnType<typeof seedTenants>>;
let manager: string;
let trainer: string;
let trainer2: string;
let managerB: string;

beforeAll(async () => {
  db = createDb(inject("databaseUrl"));
});
afterAll(async () => db.destroy());

beforeEach(async () => {
  ids = await seedTenants(db);
  api = testApi(db);
  [manager, trainer, trainer2, managerB] = await Promise.all([
    api.staffToken("yonetici@a.test"),
    api.staffToken("pt@a.test"),
    api.staffToken("pt2@a.test"),
    api.staffToken("yonetici@b.test", B),
  ]);
});

const template = {
  name: "Başlangıç 2 gün",
  blocks: [
    { dayIndex: 0, position: 0, exerciseId: "squat", sets: 3, reps: 10, restSec: 90, mode: "strict" },
    { dayIndex: 0, position: 1, exerciseId: "pushup", sets: 3, reps: 8, restSec: 60, mode: "lenient", stationHint: "Şınav Alanı" },
    { dayIndex: 1, position: 0, exerciseId: "squat", sets: 4, reps: 8, restSec: 120, mode: "strict" },
  ],
};

async function createMember(token = manager, body: object = { displayName: "Ayşe", email: "ayse@a.test" }) {
  return api.call("POST", "/members", token, body);
}

describe("members (C4)", () => {
  test("managers create members; an invite sends a magic link", async () => {
    const r = await createMember(manager, { displayName: "Ayşe", email: "ayse@a.test", invite: true });
    expect(r.status).toBe(201);
    expect(r.json()).toMatchObject({ id: expect.any(String), displayName: "Ayşe", email: "ayse@a.test", cameraConsent: false });
    expect(api.sent.at(-1)!.to).toBe("ayse@a.test");
  });

  test("trainers cannot create members", async () => {
    expect((await createMember(trainer)).status).toBe(403);
  });

  test("duplicate e-mail in the same tenant is a conflict", async () => {
    await createMember();
    expect((await createMember()).status).toBe(409);
  });

  test("trainers only list and see members assigned to them (AC-6.4)", async () => {
    const m1 = (await createMember(manager, { displayName: "Ayşe" })).json();
    const m2 = (await createMember(manager, { displayName: "Burak" })).json();
    expect((await api.call("PUT", `/members/${m1.id}/trainers/${ids.trainerA}`, manager)).status).toBe(204);

    const list = (await api.call("GET", "/members", trainer)).json();
    expect(list.map((m: { id: string }) => m.id)).toEqual([m1.id]);
    expect((await api.call("GET", `/members/${m1.id}`, trainer)).status).toBe(200);
    expect((await api.call("GET", `/members/${m2.id}`, trainer)).status).toBe(404);
    expect((await api.call("GET", "/members", manager)).json()).toHaveLength(2);
  });

  test("search by name", async () => {
    await createMember(manager, { displayName: "Ayşe Yılmaz" });
    await createMember(manager, { displayName: "Burak Demir" });
    const r = (await api.call("GET", "/members?q=yıl", manager)).json();
    expect(r.map((m: { displayName: string }) => m.displayName)).toEqual(["Ayşe Yılmaz"]);
  });

  test("unassigning removes trainer access", async () => {
    const m = (await createMember()).json();
    await api.call("PUT", `/members/${m.id}/trainers/${ids.trainerA}`, manager);
    await api.call("DELETE", `/members/${m.id}/trainers/${ids.trainerA}`, manager);
    expect((await api.call("GET", `/members/${m.id}`, trainer)).status).toBe(404);
  });
});

describe("AC-6.1: cross-tenant access through the API is 404", () => {
  test("member, template and program of tenant A are invisible to tenant B", async () => {
    const m = (await createMember()).json();
    const t = (await api.call("POST", "/program-templates", manager, template)).json();
    expect((await api.call("GET", `/members/${m.id}`, managerB)).status).toBe(404);
    expect((await api.call("PATCH", `/members/${m.id}`, managerB, { displayName: "x" })).status).toBe(404);
    expect((await api.call("GET", `/program-templates/${t.id}`, managerB)).status).toBe(404);
    expect((await api.call("DELETE", `/program-templates/${t.id}`, managerB)).status).toBe(404);
    expect((await api.call("POST", `/members/${m.id}/programs`, managerB, { templateId: t.id, startDate: "2026-11-06" })).status).toBe(404);
    expect((await api.call("GET", "/members", managerB)).json()).toEqual([]);
  });

  test("B cannot assign A's template to its own member", async () => {
    const t = (await api.call("POST", "/program-templates", manager, template)).json();
    const mb = (await api.call("POST", "/members", managerB, { displayName: "Bora" })).json();
    expect((await api.call("POST", `/members/${mb.id}/programs`, managerB, { templateId: t.id, startDate: "2026-11-06" })).status).toBe(404);
  });
});

describe("program templates (C5)", () => {
  test("create, read with ordered blocks, replace, delete", async () => {
    const created = await api.call("POST", "/program-templates", trainer, template);
    expect(created.status).toBe(201);
    const id = created.json().id;
    const got = (await api.call("GET", `/program-templates/${id}`, manager)).json();
    expect(got.blocks.map((b: { exerciseId: string; dayIndex: number }) => `${b.dayIndex}:${b.exerciseId}`)).toEqual(["0:squat", "0:pushup", "1:squat"]);
    expect(got.blocks[1]).toMatchObject({ stationHint: "Şınav Alanı", mode: "lenient" });

    const put = await api.call("PUT", `/program-templates/${id}`, trainer, { name: "Tek gün", blocks: [template.blocks[0]] });
    expect(put.status).toBe(200);
    expect((await api.call("GET", `/program-templates/${id}`, trainer)).json()).toMatchObject({ name: "Tek gün", blocks: [{ exerciseId: "squat" }] });

    expect((await api.call("GET", "/program-templates", trainer)).json()).toHaveLength(1);
    expect((await api.call("DELETE", `/program-templates/${id}`, manager)).status).toBe(204);
    expect((await api.call("GET", `/program-templates/${id}`, manager)).status).toBe(404);
  });

  test("a block needs exactly one of reps or durationSec", async () => {
    const bad = { name: "x", blocks: [{ ...template.blocks[0], durationSec: 30 }] };
    expect((await api.call("POST", "/program-templates", trainer, bad)).status).toBe(400);
  });

  test("unknown exercises are rejected", async () => {
    const bad = { name: "x", blocks: [{ ...template.blocks[0], exerciseId: "deadlift" }] };
    expect((await api.call("POST", "/program-templates", trainer, bad)).json()).toMatchObject({ error: "unknown_exercise" });
  });

  test("members cannot manage templates", async () => {
    const m = (await createMember()).json();
    await sql`update members set email = 'ayse@a.test' where id = ${m.id}`.execute(db);
    const memberToken = await api.memberToken("ayse@a.test");
    expect((await api.call("POST", "/program-templates", memberToken, template)).status).toBe(403);
  });
});

describe("member programs and /me (B2, B3)", () => {
  async function memberWithProgram() {
    const m = (await createMember()).json();
    await api.call("PUT", `/members/${m.id}/trainers/${ids.trainerA}`, manager);
    const t = (await api.call("POST", "/program-templates", trainer, template)).json();
    const assigned = await api.call("POST", `/members/${m.id}/programs`, trainer, { templateId: t.id, startDate: "2026-11-06" });
    expect(assigned.status).toBe(201);
    return { member: m, memberProgramId: assigned.json().id as string, token: await api.memberToken("ayse@a.test") };
  }

  test("an unassigned trainer cannot assign programs", async () => {
    const m = (await createMember()).json();
    const t = (await api.call("POST", "/program-templates", trainer2, template)).json();
    expect((await api.call("POST", `/members/${m.id}/programs`, trainer2, { templateId: t.id, startDate: "2026-11-06" })).status).toBe(404);
  });

  test("the member gets the active program as engine workouts", async () => {
    const { token, memberProgramId } = await memberWithProgram();
    const r = await api.call("GET", "/me/program", token);
    expect(r.status).toBe(200);
    const body = r.json();
    expect(body).toMatchObject({ memberProgramId, nextDayIndex: 0 });
    expect(body.days).toHaveLength(2);
    for (const w of body.days) expect(WorkoutSchema.safeParse(w).success).toBe(true);
    expect(body.days[0].blocks[1]).toMatchObject({ exerciseId: "pushup", exerciseVersion: 1, reps: 8, stationHint: "Şınav Alanı", mode: "lenient" });
  });

  test("next day follows the last completed session and wraps around", async () => {
    const { token, member, memberProgramId } = await memberWithProgram();
    const done = (id: string, day: number, at: string) =>
      sql`insert into sessions (id, tenant_id, member_id, member_program_id, workout_day_index, started_at, ended_at, status)
          values (${id}, (select tenant_id from members where id = ${member.id}), ${member.id}, ${memberProgramId}, ${day}, ${at}, ${at}, 'done')`.execute(db);
    await done("c0000000-0000-4000-8000-000000000001", 0, "2026-11-01T10:00:00Z");
    expect((await api.call("GET", "/me/program", token)).json().nextDayIndex).toBe(1);
    await done("c0000000-0000-4000-8000-000000000002", 1, "2026-11-03T10:00:00Z");
    expect((await api.call("GET", "/me/program", token)).json().nextDayIndex).toBe(0);
  });

  test("no program → 404", async () => {
    await createMember();
    const token = await api.memberToken("ayse@a.test");
    expect((await api.call("GET", "/me/program", token)).status).toBe(404);
  });

  test("member sessions: own via /me, staff via /members/:id/sessions with trainer scoping (AC-6.4)", async () => {
    const { token, member, memberProgramId } = await memberWithProgram();
    await sql`insert into sessions (id, tenant_id, member_id, member_program_id, workout_day_index, started_at, status)
              values ('c0000000-0000-4000-8000-000000000009', (select tenant_id from members where id = ${member.id}), ${member.id}, ${memberProgramId}, 0, now(), 'done')`.execute(db);
    expect((await api.call("GET", "/me/sessions", token)).json()).toHaveLength(1);
    expect((await api.call("GET", `/members/${member.id}/sessions`, trainer)).json()).toHaveLength(1);
    expect((await api.call("GET", `/members/${member.id}/sessions`, trainer2)).status).toBe(404);
    expect((await api.call("GET", `/members/${member.id}/sessions`, managerB)).status).toBe(404);
  });
});

describe("consent (specs/07, B1/B6)", () => {
  test("give and withdraw camera consent", async () => {
    await createMember();
    const token = await api.memberToken("ayse@a.test");
    expect((await api.call("GET", "/me", token)).json()).toMatchObject({ displayName: "Ayşe", cameraConsent: false });
    expect((await api.call("POST", "/me/consent", token, { version: "2026-11-v1" })).status).toBe(204);
    expect((await api.call("GET", "/me", token)).json()).toMatchObject({ cameraConsent: true, consentVersion: "2026-11-v1" });
    expect((await api.call("DELETE", "/me/consent", token)).status).toBe(204);
    expect((await api.call("GET", "/me", token)).json()).toMatchObject({ cameraConsent: false });
  });
});

describe("stations (C3)", () => {
  test("managers create and list stations; trainers cannot create", async () => {
    const r = await api.call("POST", "/stations", manager, { name: "Squat Rafı 2", exerciseIds: ["squat"] });
    expect(r.status).toBe(201);
    expect((await api.call("GET", "/stations", manager)).json()).toMatchObject([{ name: "Squat Rafı 2", exerciseIds: ["squat"] }]);
    expect((await api.call("POST", "/stations", trainer, { name: "x" })).status).toBe(403);
  });
});
