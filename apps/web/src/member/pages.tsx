import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, Navigate, Outlet, useNavigate, useParams } from "react-router";
import type { MemberProfile, MemberProgram, ProgressRow, SessionDetail, SessionSummary } from "../api/client";
import { SettingsPanel } from "../components/Settings";
import { RULE_PACKS } from "../rules";
import { useServices } from "../services";
import { CONSENT_VERSION } from "./consent";

// Member area B2–B6 (specs/08). Data comes from /me endpoints (apps/api).

function useLang() {
  const { i18n } = useTranslation();
  return i18n.language === "en" ? "en" : "tr";
}

/** Loads with the API; renders nothing until ready. */
function useLoad<T>(load: () => Promise<T>, deps: unknown[]): T | null | "error" {
  const [data, setData] = useState<T | null | "error">(null);
  useEffect(() => {
    let cancelled = false;
    load().then(
      (d) => !cancelled && setData(d),
      () => !cancelled && setData("error"),
    );
    return () => {
      cancelled = true;
    };
  }, deps);
  return data;
}

export function RequireMember() {
  const { store } = useServices();
  return store.get("member") ? <Outlet /> : <Navigate to="/member/login" replace />;
}

const exerciseName = (id: string, lang: "tr" | "en") => RULE_PACKS[id]?.pack.name[lang] ?? id;
const faultName = (exerciseId: string, faultId: string, lang: "tr" | "en") =>
  RULE_PACKS[exerciseId]?.pack.faults.find((f) => f.id === faultId)?.name[lang] ?? faultId;

function Blocks({ blocks }: { blocks: MemberProgram["days"][number]["blocks"] }) {
  const lang = useLang();
  return (
    <ol>
      {blocks.map((b, i) => (
        <li key={i}>
          {exerciseName(b.exerciseId, lang)} · {b.sets} × {b.reps ?? `${b.durationSec}s`}
          {b.stationHint && ` · ${b.stationHint}`}
        </li>
      ))}
    </ol>
  );
}

const Loading = () => {
  const { t } = useTranslation();
  return <p role="status">{t("phone.loading")}</p>;
};
const Failed = () => {
  const { t } = useTranslation();
  return <p role="alert">{t("member.loadFailed")}</p>;
};

/** Monday 00:00 UTC of the week containing `now`. */
function weekStart(now: number) {
  const d = new Date(now);
  const day = (d.getUTCDay() + 6) % 7;
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - day);
}

export function MemberHome() {
  const { t } = useTranslation();
  const { api, now } = useServices();
  const data = useLoad(async () => {
    const [program, sessions] = await Promise.all([api.memberProgram().catch(() => null), api.mySessions()]);
    return { program, sessions };
  }, [api]);
  if (data === null) return <Loading />;
  if (data === "error") return <Failed />;
  const today = data.program?.days.find((d) => d.id.endsWith(`:${data.program!.nextDayIndex}`)) ?? data.program?.days[0];
  const doneThisWeek = data.sessions.filter((s) => s.status === "done" && Date.parse(s.startedAt) >= weekStart(now())).length;
  return (
    <section data-screen="B2">
      <h1>{t("screens.B2")}</h1>
      {today ? (
        <>
          <h2>{today.name}</h2>
          <Blocks blocks={today.blocks} />
          <Link to="/member/session" className="primary">
            {t("member.startSession")}
          </Link>
        </>
      ) : (
        <p>{t("phone.noProgram")}</p>
      )}
      <p>{t("member.weekDone", { count: doneThisWeek })}</p>
      <nav className="member-nav">
        <Link to="/member/program">{t("screens.B3")}</Link>
        <Link to="/member/history">{t("screens.B4")}</Link>
        <Link to="/member/progress">{t("screens.B5")}</Link>
        <Link to="/member/settings">{t("screens.B6")}</Link>
      </nav>
    </section>
  );
}

export function MemberProgramPage() {
  const { t } = useTranslation();
  const { api } = useServices();
  const program = useLoad(() => api.memberProgram(), [api]);
  if (program === null) return <Loading />;
  if (program === "error") return <p>{t("phone.noProgram")}</p>;
  return (
    <section data-screen="B3">
      <h1>{t("screens.B3")}</h1>
      {program.days.map((d) => (
        <article key={d.id}>
          <h2>{d.name}</h2>
          <Blocks blocks={d.blocks} />
        </article>
      ))}
    </section>
  );
}

export function MemberHistory() {
  const { t, i18n } = useTranslation();
  const { api } = useServices();
  const sessions = useLoad(() => api.mySessions(), [api]);
  if (sessions === null) return <Loading />;
  if (sessions === "error") return <Failed />;
  return (
    <section data-screen="B4">
      <h1>{t("screens.B4")}</h1>
      {sessions.length === 0 && <p>{t("member.noSessions")}</p>}
      <ul>
        {sessions.map((s: SessionSummary) => (
          <li key={s.id}>
            <Link to={`/member/history/${s.id}`}>
              {new Date(s.startedAt).toLocaleDateString(i18n.language)} · {t(`member.status.${s.status}`)}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function MemberSessionDetail() {
  const { t, i18n } = useTranslation();
  const lang = useLang();
  const { api } = useServices();
  const { sessionId = "" } = useParams();
  const detail = useLoad<SessionDetail>(() => api.mySession(sessionId), [api, sessionId]);
  if (detail === null) return <Loading />;
  if (detail === "error") return <Failed />;
  return (
    <section data-screen="B4">
      <h1>{new Date(detail.startedAt).toLocaleDateString(i18n.language)}</h1>
      {detail.blocks.map((b) => (
        <article key={b.position}>
          <h2>{exerciseName(b.exerciseId, lang)}</h2>
          <ul>
            {b.sets.map((s) => (
              <li key={s.setIndex}>
                {t("member.setLine", { n: s.setIndex + 1, valid: s.validReps, faulty: s.faultyReps, incomplete: s.incompleteReps })}
                {s.faults.length > 0 && <> · {s.faults.map((f) => `${faultName(b.exerciseId, f.faultId, lang)} × ${f.count}`).join(", ")}</>}
              </li>
            ))}
          </ul>
        </article>
      ))}
      <Link to="/member/history">{t("screens.B4")}</Link>
    </section>
  );
}

export function MemberProgress() {
  const { t } = useTranslation();
  const lang = useLang();
  const { api } = useServices();
  const rows = useLoad<ProgressRow[]>(() => api.myProgress(), [api]);
  if (rows === null) return <Loading />;
  if (rows === "error") return <Failed />;
  return (
    <section data-screen="B5">
      <h1>{t("screens.B5")}</h1>
      <table>
        <thead>
          <tr>
            <th>{t("member.progress.week")}</th>
            <th>{t("calibration.exercise")}</th>
            <th>{t("member.progress.valid")}</th>
            <th>{t("member.progress.faulty")}</th>
            <th>{t("member.progress.incomplete")}</th>
            <th>{t("member.progress.clean")}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={`${r.week}-${r.exerciseId}`}>
              <td>{r.week}</td>
              <td>{exerciseName(r.exerciseId, lang)}</td>
              <td>{r.valid}</td>
              <td>{r.faulty}</td>
              <td>{r.incomplete}</td>
              <td>{r.cleanRatio === null ? "–" : t("member.progress.percent", { value: Math.round(r.cleanRatio * 100) })}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

export function MemberSettings() {
  const { t } = useTranslation();
  const services = useServices();
  const navigate = useNavigate();
  const [me, setMe] = useState<MemberProfile | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deletionRequested, setDeletionRequested] = useState(false);
  useEffect(() => {
    void services.api.me().then(setMe, () => undefined);
  }, [services]);

  return (
    <section data-screen="B6">
      <h1>{t("screens.B6")}</h1>
      <SettingsPanel />
      <h2>{t("member.settings.camera")}</h2>
      {me && (
        <>
          <p>{t(me.cameraConsent ? "member.settings.consentOn" : "member.settings.consentOff")}</p>
          {me.cameraConsent ? (
            <button onClick={async () => (await services.api.withdrawConsent(), setMe({ ...me, cameraConsent: false }))}>
              {t("member.settings.withdraw")}
            </button>
          ) : (
            <button onClick={async () => (await services.api.giveConsent(CONSENT_VERSION), setMe({ ...me, cameraConsent: true, consentVersion: CONSENT_VERSION }))}>
              {t("member.settings.give")}
            </button>
          )}
        </>
      )}
      <h2>{t("member.settings.data")}</h2>
      <button onClick={async () => services.download("gymspot-verilerim.json", JSON.stringify(await services.api.exportMyData(), null, 2))}>
        {t("member.settings.export")}
      </button>
      {deletionRequested ? (
        <p role="status">{t("member.settings.deletionRequested")}</p>
      ) : confirmDelete ? (
        <div role="alertdialog" aria-label={t("member.settings.deleteConfirm")}>
          <p>{t("member.settings.deleteConfirm")}</p>
          <button onClick={async () => (await services.api.requestDeletion(), setDeletionRequested(true))}>{t("member.settings.deleteYes")}</button>
          <button onClick={() => setConfirmDelete(false)}>{t("member.settings.deleteNo")}</button>
        </div>
      ) : (
        <button onClick={() => setConfirmDelete(true)}>{t("member.settings.delete")}</button>
      )}
      <h2>{t("member.settings.account")}</h2>
      <button
        onClick={async () => {
          await services.api.signOutMember();
          navigate("/member/login", { replace: true });
        }}
      >
        {t("member.settings.signOut")}
      </button>
    </section>
  );
}
