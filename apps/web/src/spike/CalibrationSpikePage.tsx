import { useMemo } from "react";
import { CalibrationPage, type CalibrationSave } from "../calibration/CalibrationPage";
import { createMediaPipeSource } from "../pose/mediapipe";

// Development-only: team-internal fixture recording (AC-4.3, "ekip içi kayıt").
// Saves the labeled landmark sequence as a local JSON file. The production C10
// uploads to the separate encrypted store instead (T3.5) and takes the role from
// the staff session (T3.2).
function download({ consent, sequence }: CalibrationSave) {
  const blob = new Blob([JSON.stringify({ consent, sequence })], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${sequence.exerciseId}-${sequence.view}-${consent.participantRef}-${Date.now()}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
}

export function CalibrationSpikePage() {
  const source = useMemo(() => createMediaPipeSource("lite"), []);
  return <CalibrationPage role="owner" source={source} onSave={download} />;
}
