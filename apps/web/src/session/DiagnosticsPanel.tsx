import type { LandmarkName } from "@gymspot/shared";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { PoseModelVariant } from "../pose/mediapipe";
import type { PoseSourceStats } from "../pose/source";
import type { SessionRunner, TrackingProblem } from "./runner";

// A5 diagnostics (specs/08): frame rate, pose model and how well each required
// landmark is seen, to find out on the device why tracking drops. Local only.

export interface DiagnosticsSnapshot {
  fps: number;
  stats?: PoseSourceStats;
  nearSide?: string;
  landmarks: { name: LandmarkName; visibility: number | null }[];
  problem: TrackingProblem | null;
}

export interface DiagnosticsPanelProps {
  read(): DiagnosticsSnapshot;
  model: PoseModelVariant;
  onModel(m: PoseModelVariant): void;
  /** Visibility needed at setup; half of it during a set (specs/04). */
  minVisibility: number;
}

export const DIAGNOSTICS_REFRESH_MS = 250;

export function snapshotOf(runner: SessionRunner, fps: number, stats?: PoseSourceStats): DiagnosticsSnapshot {
  const d = runner.diagnostics;
  return { fps, stats, nearSide: d?.nearSide, landmarks: d?.landmarks ?? [], problem: runner.trackingProblem };
}

export function DiagnosticsPanel({ read, model, onModel, minVisibility }: DiagnosticsPanelProps) {
  const { t } = useTranslation();
  const [snap, setSnap] = useState(read);
  useEffect(() => {
    const id = setInterval(() => setSnap(read()), DIAGNOSTICS_REFRESH_MS);
    return () => clearInterval(id);
  }, [read]);

  const level = (v: number | null) => (v === null || v < minVisibility / 2 ? "bad" : v < minVisibility ? "weak" : "good");
  const part = (n: LandmarkName) => {
    const side = n.startsWith("left_") ? t("diagnostics.left") : n.startsWith("right_") ? t("diagnostics.right") : "";
    return `${side} ${t(`tracking.part.${n.replace(/^(left|right)_/, "")}`)}`.trim();
  };
  const { stats, problem } = snap;

  return (
    <aside className="diagnostics" aria-label={t("diagnostics.title")}>
      <dl>
        <dt>{t("diagnostics.fps")}</dt>
        <dd data-testid="diag-fps">{Math.round(snap.fps)}</dd>
        <dt>{t("diagnostics.model")}</dt>
        <dd>
          {[stats?.model, stats?.delegate, stats?.inferenceMs !== undefined ? `${Math.round(stats.inferenceMs)} ms` : undefined]
            .filter(Boolean)
            .join(" · ")}
        </dd>
        {snap.nearSide && (
          <>
            <dt>{t("diagnostics.side")}</dt>
            <dd>{t(snap.nearSide === "right" ? "diagnostics.right" : "diagnostics.left")}</dd>
          </>
        )}
        <dt>{t("diagnostics.tracking")}</dt>
        <dd data-testid="diag-tracking">{problem ? t(`diagnostics.problem.${problem.cause}`) : t("diagnostics.ok")}</dd>
      </dl>
      <ul>
        {snap.landmarks.map((l) => (
          <li key={l.name} className={`vis-${level(l.visibility)}`}>
            <span>{part(l.name)}</span>
            <span>{l.visibility === null ? "–" : l.visibility.toFixed(2)}</span>
          </li>
        ))}
      </ul>
      <label>
        {t("diagnostics.modelChoice")}
        <select value={model} onChange={(e) => onModel(e.target.value as PoseModelVariant)}>
          <option value="lite">{t("diagnostics.models.lite")}</option>
          <option value="full">{t("diagnostics.models.full")}</option>
        </select>
      </label>
    </aside>
  );
}
