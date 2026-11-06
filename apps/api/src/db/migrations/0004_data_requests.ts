import { type Kysely, sql } from "kysely";
import { APP_ROLE } from "./0001_init";

// Member data rights requests — specs/06, specs/07 "Üye hakları".

const CURRENT_TENANT = "nullif(current_setting('app.tenant_id', true), '')::uuid";

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    create table data_requests (
      id uuid primary key default gen_random_uuid(),
      tenant_id uuid not null references tenants(id),
      member_id uuid not null references members(id),
      kind text not null check (kind in ('export', 'delete')),
      requested_at timestamptz not null,
      completed_at timestamptz
    );
    -- at most one open deletion request per member
    create unique index data_requests_open_delete_idx on data_requests (member_id) where kind = 'delete' and completed_at is null;
    create index data_requests_tenant_idx on data_requests (tenant_id);
    alter table data_requests enable row level security;
    alter table data_requests force row level security;
    create policy tenant_isolation on data_requests
      using (tenant_id = ${sql.raw(CURRENT_TENANT)})
      with check (tenant_id = ${sql.raw(CURRENT_TENANT)});
    grant select, insert, update, delete on data_requests to ${sql.raw(APP_ROLE)};
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`drop table if exists data_requests`.execute(db);
}
