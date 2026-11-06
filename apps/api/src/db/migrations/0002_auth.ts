import { type Kysely, sql } from "kysely";
import { APP_ROLE } from "./0001_init";

// Auth support tables — specs/06, specs/07 "Token ayrıntıları".

const CURRENT_TENANT = "nullif(current_setting('app.tenant_id', true), '')::uuid";
export const AUTH_TENANT_TABLES = ["login_attempts", "device_pairing_codes"] as const;

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    create table login_attempts (
      tenant_id uuid not null references tenants(id),
      email text not null,
      failed_count integer not null default 0,
      window_started_at timestamptz not null,
      locked_until timestamptz,
      primary key (tenant_id, email)
    );

    create table device_pairing_codes (
      id uuid primary key default gen_random_uuid(),
      tenant_id uuid not null references tenants(id),
      station_id uuid not null references stations(id) on delete cascade,
      code_hash text not null unique,
      expires_at timestamptz not null,
      used_at timestamptz,
      created_by uuid references users(id)
    );

    -- magic links look members up by e-mail
    create unique index members_tenant_email_idx on members (tenant_id, lower(email)) where email is not null;

    -- A pairing code carries no tenant; this narrow lookup returns only the
    -- tenant id so the rest of the pairing runs under RLS (specs/07).
    create function resolve_pairing_code(p_code_hash text) returns uuid
      language sql stable security definer set search_path = public
      as $$ select tenant_id from device_pairing_codes where code_hash = p_code_hash $$;
    revoke all on function resolve_pairing_code(text) from public;
    grant execute on function resolve_pairing_code(text) to ${sql.raw(APP_ROLE)};
  `.execute(db);

  for (const table of AUTH_TENANT_TABLES) {
    await sql`
      create index ${sql.id(`${table}_tenant_idx`)} on ${sql.table(table)} (tenant_id);
      alter table ${sql.table(table)} enable row level security;
      alter table ${sql.table(table)} force row level security;
      create policy tenant_isolation on ${sql.table(table)}
        using (tenant_id = ${sql.raw(CURRENT_TENANT)})
        with check (tenant_id = ${sql.raw(CURRENT_TENANT)});
      grant select, insert, update, delete on ${sql.table(table)} to ${sql.raw(APP_ROLE)};
    `.execute(db);
  }
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`
    drop function if exists resolve_pairing_code(text);
    drop index if exists members_tenant_email_idx;
    drop table if exists device_pairing_codes, login_attempts;
  `.execute(db);
}
