import { type Kysely, sql } from "kysely";

// Initial schema — specs/06-data-model.md. Every tenant table carries tenant_id
// and is protected by FORCE ROW LEVEL SECURITY; the app works as the
// gymspot_app role, which cannot bypass RLS (specs/06, 07).

export const APP_ROLE = "gymspot_app";

/** Tables isolated by `tenant_id = app.tenant_id`. */
export const TENANT_TABLES = [
  "branches",
  "users",
  "members",
  "trainer_members",
  "stations",
  "devices",
  "member_login_tokens",
  "auth_refresh_tokens",
  "qr_tokens",
  "program_templates",
  "program_template_blocks",
  "member_programs",
  "sessions",
  "session_blocks",
  "sets",
  "rep_events",
  "calibration_consents",
  "calibration_recordings",
  "audit_log",
] as const;

const CURRENT_TENANT = "nullif(current_setting('app.tenant_id', true), '')::uuid";

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    do $$ begin
      if not exists (select from pg_roles where rolname = ${sql.lit(APP_ROLE)}) then
        create role ${sql.raw(APP_ROLE)} nologin;
      end if;
    end $$;

    create table tenants (
      id uuid primary key default gen_random_uuid(),
      name text not null,
      plan text not null default 'pilot',
      status text not null default 'active' check (status in ('active', 'suspended')),
      created_at timestamptz not null default now()
    );

    create table platform_admins (
      id uuid primary key default gen_random_uuid(),
      email text not null unique,
      password_hash text not null,
      status text not null default 'active' check (status in ('active', 'disabled'))
    );

    create table branches (
      id uuid primary key default gen_random_uuid(),
      tenant_id uuid not null references tenants(id),
      name text not null,
      address text,
      timezone text not null default 'Europe/Istanbul'
    );

    create table users (
      id uuid primary key default gen_random_uuid(),
      tenant_id uuid not null references tenants(id),
      email text not null,
      password_hash text not null,
      role text not null check (role in ('owner', 'manager', 'trainer')),
      status text not null default 'active' check (status in ('active', 'disabled')),
      unique (tenant_id, email)
    );

    create table members (
      id uuid primary key default gen_random_uuid(),
      tenant_id uuid not null references tenants(id),
      branch_id uuid references branches(id),
      display_name text not null,
      email text,
      phone text,
      external_ref text,
      consent_at timestamptz,
      consent_version text,
      consent_withdrawn_at timestamptz,
      status text not null default 'active' check (status in ('active', 'inactive', 'anonymized'))
    );

    create table trainer_members (
      tenant_id uuid not null references tenants(id),
      trainer_user_id uuid not null references users(id),
      member_id uuid not null references members(id),
      primary key (trainer_user_id, member_id)
    );

    create table stations (
      id uuid primary key default gen_random_uuid(),
      tenant_id uuid not null references tenants(id),
      branch_id uuid references branches(id),
      name text not null,
      exercise_ids text[] not null default '{}',
      device_status text not null default 'unknown',
      last_heartbeat_at timestamptz
    );

    create table devices (
      id uuid primary key default gen_random_uuid(),
      tenant_id uuid not null references tenants(id),
      station_id uuid references stations(id),
      kind text not null check (kind in ('tablet', 'phone')),
      token_hash text not null,
      last_seen_at timestamptz
    );

    create table member_login_tokens (
      id uuid primary key default gen_random_uuid(),
      tenant_id uuid not null references tenants(id),
      member_id uuid not null references members(id),
      token_hash text not null unique,
      expires_at timestamptz not null,
      used_at timestamptz
    );

    create table auth_refresh_tokens (
      id uuid primary key default gen_random_uuid(),
      tenant_id uuid not null references tenants(id),
      subject_kind text not null check (subject_kind in ('user', 'member', 'device')),
      subject_id uuid not null,
      token_hash text not null unique,
      expires_at timestamptz not null,
      revoked_at timestamptz
    );

    create table qr_tokens (
      id uuid primary key default gen_random_uuid(),
      tenant_id uuid not null references tenants(id),
      member_id uuid not null references members(id),
      session_id uuid,
      jti text not null unique,
      expires_at timestamptz not null,
      used_at timestamptz
    );

    create table exercises (
      id text not null,
      version integer not null check (version >= 1),
      definition_json jsonb not null,
      status text not null check (status in ('draft', 'calibrated')),
      tenant_id uuid references tenants(id),
      primary key (id, version)
    );

    create table program_templates (
      id uuid primary key default gen_random_uuid(),
      tenant_id uuid not null references tenants(id),
      name text not null,
      created_by uuid references users(id)
    );

    create table program_template_blocks (
      id uuid primary key default gen_random_uuid(),
      tenant_id uuid not null references tenants(id),
      template_id uuid not null references program_templates(id) on delete cascade,
      day_index integer not null check (day_index >= 0),
      position integer not null check (position >= 0),
      exercise_id text not null,
      sets integer not null check (sets >= 1),
      reps integer check (reps >= 1),
      duration_sec integer check (duration_sec >= 1),
      rest_sec integer not null check (rest_sec >= 0),
      mode text not null check (mode in ('strict', 'lenient')),
      station_hint text,
      check ((reps is null) <> (duration_sec is null))
    );

    create table member_programs (
      id uuid primary key default gen_random_uuid(),
      tenant_id uuid not null references tenants(id),
      member_id uuid not null references members(id),
      template_id uuid references program_templates(id),
      assigned_by uuid references users(id),
      start_date date not null,
      end_date date
    );

    create table sessions (
      id uuid primary key,
      tenant_id uuid not null references tenants(id),
      member_id uuid not null references members(id),
      member_program_id uuid references member_programs(id),
      workout_day_index integer not null check (workout_day_index >= 0),
      started_at timestamptz not null,
      ended_at timestamptz,
      status text not null check (status in ('active', 'paused', 'done', 'abandoned', 'aborted'))
    );

    create table session_blocks (
      id uuid primary key,
      tenant_id uuid not null references tenants(id),
      session_id uuid not null references sessions(id),
      position integer not null check (position >= 0),
      exercise_id text not null,
      exercise_version integer not null check (exercise_version >= 1),
      planned_sets integer not null check (planned_sets >= 1),
      executed_by_device_id text not null,
      station_id uuid references stations(id),
      status text not null check (status in ('done', 'skipped', 'partial', 'delegated'))
    );

    create table sets (
      id uuid primary key,
      tenant_id uuid not null references tenants(id),
      session_block_id uuid not null references session_blocks(id),
      set_index integer not null check (set_index >= 0),
      planned_reps integer check (planned_reps >= 1),
      valid_reps integer not null check (valid_reps >= 0),
      faulty_reps integer not null check (faulty_reps >= 0),
      incomplete_reps integer not null check (incomplete_reps >= 0),
      source text not null check (source in ('camera', 'manual')),
      view text check (view in ('front', 'side', 'ambiguous')),
      below_target boolean not null,
      started_at timestamptz not null,
      ended_at timestamptz not null,
      check (source = 'camera' or view is null)
    );

    create table rep_events (
      id uuid primary key,
      tenant_id uuid not null references tenants(id),
      set_id uuid not null references sets(id),
      rep_index integer not null check (rep_index >= 0),
      outcome text not null check (outcome in ('valid', 'faulty', 'incomplete')),
      duration_ms integer not null check (duration_ms >= 0),
      faults text[] not null default '{}'
    );

    -- derived, so it can never drift from rep_events; security_invoker keeps RLS in force
    create view fault_summaries with (security_invoker = true) as
      select tenant_id, set_id, fault_id, count(*)::integer as count
      from (select tenant_id, set_id, unnest(faults) as fault_id from rep_events) f
      group by tenant_id, set_id, fault_id;

    create table calibration_consents (
      id uuid primary key default gen_random_uuid(),
      tenant_id uuid not null references tenants(id),
      participant_ref text not null,
      consent_version text not null,
      consented_at timestamptz not null,
      withdrawn_at timestamptz,
      recorded_by uuid references users(id)
    );

    create table calibration_recordings (
      id uuid primary key default gen_random_uuid(),
      tenant_id uuid not null references tenants(id),
      consent_id uuid not null references calibration_consents(id),
      exercise_id text not null,
      exercise_version integer not null,
      labels_json jsonb not null,
      storage_ref text not null,
      created_at timestamptz not null default now()
    );

    create table audit_log (
      id uuid primary key default gen_random_uuid(),
      tenant_id uuid not null references tenants(id),
      actor text not null,
      action text not null,
      target text,
      at timestamptz not null default now()
    );
  `.execute(db);

  for (const table of TENANT_TABLES) {
    await sql`
      create index ${sql.id(`${table}_tenant_idx`)} on ${sql.table(table)} (tenant_id);
      alter table ${sql.table(table)} enable row level security;
      alter table ${sql.table(table)} force row level security;
      create policy tenant_isolation on ${sql.table(table)}
        using (tenant_id = ${sql.raw(CURRENT_TENANT)})
        with check (tenant_id = ${sql.raw(CURRENT_TENANT)});
    `.execute(db);
  }

  // tenants: a tenant sees only itself. exercises: global packs (tenant_id null) are readable by all.
  await sql`
    alter table tenants enable row level security;
    alter table tenants force row level security;
    create policy tenant_self on tenants using (id = ${sql.raw(CURRENT_TENANT)});

    alter table exercises enable row level security;
    alter table exercises force row level security;
    create policy exercises_read on exercises for select using (tenant_id is null or tenant_id = ${sql.raw(CURRENT_TENANT)});
    create policy exercises_write on exercises for all
      using (tenant_id = ${sql.raw(CURRENT_TENANT)})
      with check (tenant_id = ${sql.raw(CURRENT_TENANT)});

    grant usage on schema public to ${sql.raw(APP_ROLE)};
    grant select on tenants to ${sql.raw(APP_ROLE)};
    grant select, insert, update, delete on exercises to ${sql.raw(APP_ROLE)};
    grant select on fault_summaries to ${sql.raw(APP_ROLE)};
  `.execute(db);
  for (const table of TENANT_TABLES) {
    await sql`grant select, insert, update, delete on ${sql.table(table)} to ${sql.raw(APP_ROLE)}`.execute(db);
  }
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`
    drop view if exists fault_summaries;
    drop table if exists audit_log, calibration_recordings, calibration_consents, rep_events, sets, session_blocks,
      sessions, member_programs, program_template_blocks, program_templates, exercises, qr_tokens,
      auth_refresh_tokens, member_login_tokens, devices, stations, trainer_members, members, users, branches,
      platform_admins, tenants;
    revoke usage on schema public from ${sql.raw(APP_ROLE)};
  `.execute(db);
  // the role is cluster-wide and may serve other databases, so it is kept
}
