import { type LoadedRulePack, loadRulePack } from "@gymspot/engine";
import type { RulePack } from "@gymspot/shared";
import type { ExerciseDto } from "./api/client";

// Rule packs: the ones bundled from the repo's exercises/*.json, updated from
// the API (GET /exercises, T6.3) so a new exercise needs no redeploy
// (invariant 3). Every pack is validated on load; the last good set is cached
// on the device for offline stations.

const files = import.meta.glob<unknown>("../../../exercises/*.json", { eager: true, import: "default" });

const registry: Record<string, LoadedRulePack> = Object.fromEntries(
  Object.values(files).map((json) => {
    const loaded = loadRulePack(json);
    return [loaded.pack.id, loaded];
  }),
);

/** Live registry: screens read it when they need a pack, so updates apply to the next screen. */
export const RULE_PACKS: Readonly<Record<string, LoadedRulePack>> = registry;

let revision = 0;
let view: { revision: number; packs: Readonly<Record<string, RulePack>> } | undefined;

/** Plain rule packs by id; the same object until the registry changes (stable for memo deps). */
export function rulePacks(): Readonly<Record<string, RulePack>> {
  if (view?.revision !== revision) {
    view = { revision, packs: Object.fromEntries(Object.entries(registry).map(([id, l]) => [id, l.pack])) };
  }
  return view.packs;
}

export function rulePack(id: string): RulePack {
  const loaded = registry[id];
  if (!loaded) throw new Error(`unknown exercise '${id}'`);
  return loaded.pack;
}

/**
 * Adds or replaces packs from raw definitions. Invalid packs are skipped and
 * an older version never replaces a newer one. Returns the ids that changed.
 */
export function applyRulePacks(definitions: readonly unknown[]): string[] {
  const changed: string[] = [];
  for (const def of definitions) {
    let loaded: LoadedRulePack;
    try {
      loaded = loadRulePack(def);
    } catch {
      continue; // a broken pack must not take the app down
    }
    const current = registry[loaded.pack.id];
    if (current && current.pack.version > loaded.pack.version) continue;
    if (current && JSON.stringify(current.pack) === JSON.stringify(loaded.pack)) continue;
    registry[loaded.pack.id] = loaded;
    changed.push(loaded.pack.id);
  }
  if (changed.length > 0) revision++;
  return changed;
}

export const RULE_PACK_CACHE_KEY = "gymspot.rulePacks";

interface SyncDeps {
  storage: Pick<Storage, "getItem" | "setItem">;
  /** Fetches packs with whatever credentials the device has; null when signed out. */
  fetch(): Promise<ExerciseDto[] | null>;
}

/** Cached packs first (offline), then the API; network errors keep the cache. */
export async function syncRulePacks({ storage, fetch }: SyncDeps): Promise<void> {
  try {
    const cached = storage.getItem(RULE_PACK_CACHE_KEY);
    if (cached) applyRulePacks(JSON.parse(cached) as unknown[]);
  } catch {
    // unreadable cache: ignore, the API refills it
  }
  let fresh: ExerciseDto[] | null;
  try {
    fresh = await fetch();
  } catch {
    return; // offline: bundled + cached packs stay
  }
  if (!fresh) return;
  const definitions = fresh.map((e) => e.definition);
  applyRulePacks(definitions);
  storage.setItem(RULE_PACK_CACHE_KEY, JSON.stringify(definitions));
}
