import { useMemo, useState } from "react";
import { useSearchParams } from "react-router";
import { createMediaPipeSource } from "../pose/mediapipe";
import { RULE_PACKS, rulePack } from "../rules";
import { SetupWizard } from "../setup/SetupWizard";

// Development-only harness to try the A3 setup wizard on a real device
// (`/spike/setup?exercise=pushup`). Consent is assumed here; the real
// station flow (T4.1) takes it from the member's record (specs/07).
export function SetupSpikePage() {
  const [params] = useSearchParams();
  const id = params.get("exercise") ?? "squat";
  const source = useMemo(() => createMediaPipeSource("lite"), []);
  const [result, setResult] = useState<string | null>(null);
  if (!RULE_PACKS[id]) return <p role="alert">Unknown exercise: {id}</p>;
  return (
    <main>
      <SetupWizard
        pack={rulePack(id)}
        consent
        source={source}
        onReady={(setup) => setResult(JSON.stringify(setup))}
        onManualEntry={() => setResult("manual entry")}
      />
      {result && <pre>{result}</pre>}
    </main>
  );
}
