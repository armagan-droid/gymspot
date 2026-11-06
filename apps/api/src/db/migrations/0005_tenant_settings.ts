import { type Kysely, sql } from "kysely";
import { APP_ROLE } from "./0001_init";

// Gym settings (C8) — specs/06 tenant_settings, specs/05 safety pause.

const CURRENT_TENANT = "nullif(current_setting('app.tenant_id', true), '')::uuid";

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    create table tenant_settings (
      tenant_id uuid primary key references tenants(id),
      default_mode text not null default 'strict' check (default_mode in ('strict', 'lenient')),
      retention_months integer not null default 24 check (retention_months between 1 and 120),
      safety_pause boolean not null default true
    );
    alter table tenant_settings enable row level security;
    alter table tenant_settings force row level security;
    create policy tenant_isolation on tenant_settings
      using (tenant_id = ${sql.raw(CURRENT_TENANT)})
      with check (tenant_id = ${sql.raw(CURRENT_TENANT)});
    grant select, insert, update on tenant_settings to ${sql.raw(APP_ROLE)};
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`drop table if exists tenant_settings`.execute(db);
}
