import { type Kysely, sql } from "kysely";
import { APP_ROLE } from "./0001_init";

// Exercise designer — specs/11, specs/06: gym packs are t_-prefixed and unique
// per gym (two gyms may share an id), plus one editable draft per gym exercise.

const CURRENT_TENANT = "nullif(current_setting('app.tenant_id', true), '')::uuid";

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    alter table exercises drop constraint exercises_pkey;
    create unique index exercises_global_key on exercises (id, version) where tenant_id is null;
    create unique index exercises_tenant_key on exercises (tenant_id, id, version) where tenant_id is not null;
    alter table exercises add constraint exercises_id_scope check ((tenant_id is null) = (id !~ '^t_'));

    create table exercise_drafts (
      tenant_id uuid not null references tenants(id),
      id text not null check (id ~ '^t_[a-z0-9_]{2,40}$'),
      definition_json jsonb not null,
      updated_by uuid not null references users(id),
      updated_at timestamptz not null,
      primary key (tenant_id, id)
    );
    alter table exercise_drafts enable row level security;
    alter table exercise_drafts force row level security;
    create policy tenant_isolation on exercise_drafts
      using (tenant_id = ${sql.raw(CURRENT_TENANT)})
      with check (tenant_id = ${sql.raw(CURRENT_TENANT)});
    grant select, insert, update, delete on exercise_drafts to ${sql.raw(APP_ROLE)};
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`
    drop table if exists exercise_drafts;
    delete from exercises where tenant_id is not null and id ~ '^t_';
    alter table exercises drop constraint if exists exercises_id_scope;
    drop index if exists exercises_tenant_key;
    drop index if exists exercises_global_key;
    alter table exercises add primary key (id, version);
  `.execute(db);
}
