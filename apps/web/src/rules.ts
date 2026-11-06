import { type LoadedRulePack, loadRulePack } from "@gymspot/engine";
import type { RulePack } from "@gymspot/shared";

// Rule packs bundled from the repo's exercises/*.json. They will come from the
// API (`exercises` table, specs/06) once T3.3 lands; every pack is validated on load.
const files = import.meta.glob<unknown>("../../../exercises/*.json", { eager: true, import: "default" });

export const RULE_PACKS: Readonly<Record<string, LoadedRulePack>> = Object.fromEntries(
  Object.values(files).map((json) => {
    const loaded = loadRulePack(json);
    return [loaded.pack.id, loaded];
  }),
);

export function rulePack(id: string): RulePack {
  const loaded = RULE_PACKS[id];
  if (!loaded) throw new Error(`unknown exercise '${id}'`);
  return loaded.pack;
}
