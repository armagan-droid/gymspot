import { type Kysely, sql } from "kysely";
import { APP_ROLE } from "./0001_init";

// Ingestion support — specs/06 "Kayıt alımı".

const CURRENT_TENANT = "nullif(current_setting('app.tenant_id', true), '')::uuid";

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    create table ingest_conflicts (
      tenant_id uuid not null references tenants(id),
      record_id uuid not null,
      kind text not null check (kind in ('session_block', 'set', 'rep')),
      reason text not null,
      at timestamptz not null default now(),
      primary key (tenant_id, record_id)
    );
    alter table ingest_conflicts enable row level security;
    alter table ingest_conflicts force row level security;
    create policy tenant_isolation on ingest_conflicts
      using (tenant_id = ${sql.raw(CURRENT_TENANT)})
      with check (tenant_id = ${sql.raw(CURRENT_TENANT)});
    grant select, insert on ingest_conflicts to ${sql.raw(APP_ROLE)};

    -- one block per session position: the first device to report it wins (specs/03)
    create unique index session_blocks_position_idx on session_blocks (session_id, position);
    create index qr_tokens_session_idx on qr_tokens (session_id);
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`
    drop index if exists qr_tokens_session_idx;
    drop index if exists session_blocks_position_idx;
    drop table if exists ingest_conflicts;
  `.execute(db);
}
