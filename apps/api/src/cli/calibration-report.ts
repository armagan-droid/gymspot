import { readFileSync, readdirSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { type CalibrationSummary, type SweepRow, evaluateSequence, summarize, sweep } from "@gymspot/engine";
import { type LandmarkSequence, LandmarkSequenceSchema } from "@gymspot/shared";
import { type Kysely, sql } from "kysely";
import { type BlobStore, FileBlobStore, decryptBlob } from "../calibration/store";
import { type Database, createDb } from "../db/db";

// Pilot calibration report (T5.3, specs/09): replays labeled recordings through
// the engine with the current rule packs. Product team tooling (specs/07):
// reading encrypted recordings needs the database and CALIBRATION_ENCRYPTION_KEY.
//
//   pnpm --filter @gymspot/api calibration:report -- --files ./recordings
//   pnpm --filter @gymspot/api calibration:report -- --db [--exercise squat] [--sweep rep.target.enter=95,100,105]

export function loadRulePacks(dir: string): Record<string, unknown> {
  return Object.fromEntries(
    readdirSync(dir)
      .filter((f) => f.endsWith(".json"))
      .map((f) => [basename(f, ".json"), JSON.parse(readFileSync(join(dir, f), "utf8"))]),
  );
}

/** A downloaded recording ({ consent, sequence }) or a bare sequence. */
export function parseRecordingFile(text: string): LandmarkSequence {
  const json = JSON.parse(text) as { sequence?: unknown };
  return LandmarkSequenceSchema.parse(json.sequence ?? json);
}

export async function loadRecordingsFromDb(db: Kysely<Database>, store: BlobStore, key: Uint8Array): Promise<LandmarkSequence[]> {
  const rows = (await sql<{ id: string; tenant_id: string; storage_ref: string }>`select id, tenant_id, storage_ref from calibration_recordings order by created_at`.execute(db)).rows;
  const out: LandmarkSequence[] = [];
  for (const r of rows) {
    const blob = await store.get(r.storage_ref);
    if (!blob) continue;
    out.push(LandmarkSequenceSchema.parse(JSON.parse(decryptBlob(blob, key, `${r.tenant_id}/${r.id}`).toString("utf8"))));
  }
  return out;
}

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

export function formatReport(results: { exerciseId: string; summary: CalibrationSummary; sweep?: { path: string; rows: SweepRow[] } }[]): string {
  const lines = ["# Kalibrasyon raporu", ""];
  for (const { exerciseId, summary: s, sweep: sw } of results) {
    lines.push(`## ${exerciseId}`, "");
    lines.push(`- Kayıt: ${s.sequences}, deneme: ${s.attempts}`);
    lines.push(`- Sayım doğruluğu: ${pct(s.countAccuracy)} (hedef ≥ 95%)`);
    lines.push(`- Yanlış alarm oranı: ${pct(s.falseAlarmRate)} (hedef ≤ 10%)`);
    lines.push(`- Pilot hedefleri: ${s.meetsTargets ? "karşılanıyor" : "KARŞILANMIYOR"}`, "");
    lines.push("| Hata | İsabet | Kaçırma | Yanlış alarm |", "|---|---|---|---|");
    for (const [id, f] of Object.entries(s.faults).sort()) lines.push(`| ${id} | ${f.hits} | ${f.misses} | ${f.falseAlarms} |`);
    if (sw) {
      lines.push("", `### Tarama: \`${sw.path}\``, "", "| Değer | Sayım | Yanlış alarm | Hedef |", "|---|---|---|---|");
      for (const r of sw.rows) {
        lines.push("summary" in r ? `| ${r.value} | ${pct(r.summary.countAccuracy)} | ${pct(r.summary.falseAlarmRate)} | ${r.summary.meetsTargets ? "✓" : "✗"} |` : `| ${r.value} | – | – | geçersiz: ${r.error} |`);
      }
    }
    lines.push("");
  }
  return lines.join("\n");
}

export function buildReport(packs: Record<string, unknown>, sequences: LandmarkSequence[], o: { exercise?: string; sweep?: string } = {}): string {
  const byExercise = new Map<string, LandmarkSequence[]>();
  for (const s of sequences) {
    if (!s.labels || (o.exercise && s.exerciseId !== o.exercise)) continue;
    byExercise.set(s.exerciseId, [...(byExercise.get(s.exerciseId) ?? []), s]);
  }
  const [path, valueList] = o.sweep?.split("=") ?? [];
  const results = [...byExercise].flatMap(([exerciseId, seqs]) => {
    const pack = packs[exerciseId];
    if (!pack) return [];
    return [
      {
        exerciseId,
        summary: summarize(seqs.map((s) => evaluateSequence(pack, s))),
        ...(path && valueList && { sweep: { path, rows: sweep(pack, seqs, path, valueList.split(",").map(Number)) } }),
      },
    ];
  });
  return formatReport(results);
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : (process.argv[i + 1] ?? "");
}

async function main() {
  const packs = loadRulePacks(resolve(arg("rules") ?? "../../exercises"));
  let sequences: LandmarkSequence[];
  const files = arg("files");
  if (files !== undefined) {
    const dir = resolve(files);
    sequences = readdirSync(dir)
      .filter((f) => f.endsWith(".json"))
      .map((f) => parseRecordingFile(readFileSync(join(dir, f), "utf8")));
  } else if (process.argv.includes("--db")) {
    const key = Buffer.from(process.env.CALIBRATION_ENCRYPTION_KEY ?? "", "base64url");
    if (key.length !== 32) throw new Error("CALIBRATION_ENCRYPTION_KEY (32 bytes, base64url) is required");
    const db = createDb(process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:54329/gymspot");
    try {
      sequences = await loadRecordingsFromDb(db, new FileBlobStore(process.env.CALIBRATION_STORE_DIR ?? "data/calibration"), key);
    } finally {
      await db.destroy();
    }
  } else {
    throw new Error("use --files <dir> or --db");
  }
  console.log(buildReport(packs, sequences, { exercise: arg("exercise"), sweep: arg("sweep") }));
}

if (process.argv[1] && resolve(process.argv[1]).endsWith("calibration-report.ts")) {
  main().catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
