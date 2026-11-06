import { afterAll, describe, expect, inject, test } from "vitest";
import { buildApp } from "../src/app";
import { createDb } from "../src/db/db";

const db = createDb(inject("databaseUrl"));
afterAll(() => db.destroy());

describe("API skeleton", () => {
  test("GET /health reports the database", async () => {
    const app = buildApp({ db });
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "ok", db: "ok" });
    await app.close();
  });

  test("GET /health returns 503 when the database is unreachable", async () => {
    const broken = createDb("postgres://nobody:wrong@127.0.0.1:1/none");
    const app = buildApp({ db: broken });
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(503);
    await app.close();
    await broken.destroy();
  });
});
