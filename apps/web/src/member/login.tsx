import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useSearchParams } from "react-router";
import { NetworkError } from "../api/client";
import { useServices } from "../services";
import { CONSENT_VERSION, ConsentStep, needsConsent } from "./consent";

// B1: magic-link sign-in (specs/07), gym remembered from the invite link (specs/08).

type Phase = "checking" | "consent" | "email" | "sent" | "invite" | "invalid" | "offline";

export function MemberLogin() {
  const { t } = useTranslation();
  const { api, store } = useServices();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [phase, setPhase] = useState<Phase>("checking");
  const [email, setEmail] = useState("");
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const token = params.get("token");
    void (async () => {
      if (token) {
        try {
          await api.verifyMagicLink(token);
        } catch (e) {
          // unreachable server: the link is still unused, so it is not "invalid" (specs/08 B1)
          if (!cancelled) setPhase(e instanceof NetworkError ? "offline" : "invalid");
          return;
        }
      }
      if (!store.get("member")) {
        if (!cancelled) setPhase(store.get("tenant") ? "email" : "invite");
        return;
      }
      try {
        const me = await api.me();
        if (cancelled) return;
        if (needsConsent(me)) setPhase("consent");
        else navigate("/member", { replace: true });
      } catch {
        if (!cancelled) setPhase(store.get("tenant") ? "email" : "invite");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [api, store, params, navigate, attempt]);

  if (phase === "checking") return <p role="status">{t("phone.loading")}</p>;
  if (phase === "offline") {
    return (
      <section data-screen="B1">
        <h1>{t("screens.B1")}</h1>
        <p role="alert">{t("member.login.offline")}</p>
        <button
          type="button"
          onClick={() => {
            setPhase("checking");
            setAttempt((n) => n + 1);
          }}
        >
          {t("member.login.retry")}
        </button>
      </section>
    );
  }
  if (phase === "consent") {
    return (
      <ConsentStep
        onAccept={async () => {
          await api.giveConsent(CONSENT_VERSION);
          navigate("/member", { replace: true });
        }}
        onSkip={() => navigate("/member", { replace: true })}
      />
    );
  }

  const tenant = store.get<string>("tenant");
  return (
    <section data-screen="B1">
      <h1>{t("screens.B1")}</h1>
      {phase === "invalid" && <p role="alert">{t("member.login.invalid")}</p>}
      {phase === "sent" && <p role="status">{t("member.login.sent")}</p>}
      {phase === "invite" && <p>{t("member.login.useInvite")}</p>}
      {tenant && phase !== "sent" && (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            await api.requestMagicLink(tenant, email.trim()).catch(() => undefined);
            setPhase("sent"); // same answer either way (specs/07)
          }}
        >
          <label>
            {t("member.login.email")}
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required />
          </label>
          <button type="submit">{t("member.login.send")}</button>
        </form>
      )}
    </section>
  );
}
