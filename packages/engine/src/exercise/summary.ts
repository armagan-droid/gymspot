import type { Fault, RepOutcome } from "@gymspot/shared";

// Set summary — specs/05 "Set sonu özeti" (AC-5.4).

export interface SetSummary {
  /** Reps counted toward the target: valid, plus faulty in lenient mode. */
  counted: number;
  valid: number;
  faulty: number;
  incomplete: number;
  mostFrequentFault: string | null;
  /** Faults seen in ≥ 3 consecutive attempts, in rule pack order. */
  frequentFaults: string[];
}

export const FREQUENT_FAULT_STREAK = 3;

export function summarizeSet(
  reps: readonly { outcome: RepOutcome; faults: readonly string[] }[],
  faults: readonly Pick<Fault, "id" | "severity">[],
  mode: "strict" | "lenient",
): SetSummary {
  const count = (o: RepOutcome) => reps.filter((r) => r.outcome === o).length;
  const valid = count("valid");
  const faulty = count("faulty");

  // rank: major first, then rule pack order
  const rank = (id: string) => {
    const i = faults.findIndex((f) => f.id === id);
    return (faults[i]?.severity === "major" ? 0 : 1) * 1000 + (i === -1 ? 999 : i);
  };
  const totals = new Map<string, number>();
  const streak = new Map<string, number>();
  const frequent = new Set<string>();
  for (const rep of reps) {
    for (const id of rep.faults) totals.set(id, (totals.get(id) ?? 0) + 1);
    for (const f of faults) {
      const s = rep.faults.includes(f.id) ? (streak.get(f.id) ?? 0) + 1 : 0;
      streak.set(f.id, s);
      if (s >= FREQUENT_FAULT_STREAK) frequent.add(f.id);
    }
  }
  const mostFrequentFault =
    [...totals.entries()].sort((a, b) => b[1] - a[1] || rank(a[0]) - rank(b[0]))[0]?.[0] ?? null;

  return {
    counted: valid + (mode === "lenient" ? faulty : 0),
    valid,
    faulty,
    incomplete: count("incomplete"),
    mostFrequentFault,
    frequentFaults: faults.map((f) => f.id).filter((id) => frequent.has(id)),
  };
}
