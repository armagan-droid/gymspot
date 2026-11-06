import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export const EXERCISES_DIR = fileURLToPath(new URL("../../../exercises/", import.meta.url));

export function listExerciseFiles(): string[] {
  return readdirSync(EXERCISES_DIR).filter((f) => f.endsWith(".json"));
}

export function readExercise(file: string): unknown {
  return JSON.parse(readFileSync(join(EXERCISES_DIR, file), "utf8"));
}

/** Fresh mutable copy of the squat rule pack, used as a valid baseline in tests. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function squat(): any {
  return structuredClone(readExercise("squat.json"));
}
