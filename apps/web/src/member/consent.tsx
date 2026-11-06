import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { MemberProfile } from "../api/client";

// Information notice and explicit consent (specs/07 "Rıza ve şeffaflık").
// Bump the version when the text changes: members are asked again.
export const CONSENT_VERSION = "2026-11-v1";

export const needsConsent = (p: MemberProfile) => !p.cameraConsent || p.consentVersion !== CONSENT_VERSION;

export function ConsentStep({ onAccept, onSkip }: { onAccept(): void | Promise<void>; onSkip(): void }) {
  const { t } = useTranslation();
  const [read, setRead] = useState(false);
  return (
    <section data-screen="B1" className="consent">
      <h1>{t("member.consent.title")}</h1>
      <ul>
        {(t("member.consent.points", { returnObjects: true }) as string[]).map((p) => (
          <li key={p}>{p}</li>
        ))}
      </ul>
      <p className="disclaimer">{t("legal.medicalDisclaimer")}</p>
      <label>
        <input type="checkbox" checked={read} onChange={(e) => setRead(e.target.checked)} />
        {t("member.consent.checkbox")}
      </label>
      <div className="controls">
        <button disabled={!read} onClick={() => void onAccept()}>
          {t("member.consent.accept")}
        </button>
        <button onClick={onSkip}>{t("member.consent.skip")}</button>
      </div>
    </section>
  );
}
