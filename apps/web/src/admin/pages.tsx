import QRCode from "qrcode";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, NavLink, Navigate, Outlet, useNavigate, useParams, useSearchParams } from "react-router";
import { ApiError, type SessionSummary } from "../api/client";
import type { MemberRow, StaffApi, StaffRole, StationRow, TemplateBlock, TenantSettings } from "../api/staff";
import { CalibrationPage, type CalibrationSave } from "../calibration/CalibrationPage";
import { RULE_PACKS } from "../rules";
import { useServices } from "../services";

// Admin panel C1–C6, C8, C10 (specs/08). Role checks here only shape the UI;
// the API enforces every rule (specs/06).

const useLang = () => (useTranslation().i18n.language === "en" ? "en" : "tr");
const exerciseName = (id: string, lang: "tr" | "en") => RULE_PACKS[id]?.pack.name[lang] ?? id;

function useLoad<T>(load: () => Promise<T>, deps: unknown[]): [T | null, () => void] {
  const [data, setData] = useState<T | null>(null);
  const [n, setN] = useState(0);
  useEffect(() => {
    let cancelled = false;
    load().then(
      (d) => !cancelled && setData(d),
      () => undefined,
    );
    return () => {
      cancelled = true;
    };
  }, [...deps, n]);
  return [data, () => setN((x) => x + 1)];
}

const MANAGERS: StaffRole[] = ["owner", "manager"];

// ------------------------------------------------------------------ C1

export function AdminLogin() {
  const { t } = useTranslation();
  const { staff, store } = useServices();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const known = params.get("tenant") ?? store.get<string>("staffTenant");
  const [tenant, setTenant] = useState(known ?? "");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  return (
    <section data-screen="C1">
      <h1>{t("screens.C1")}</h1>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          try {
            await staff.login(tenant.trim(), email.trim(), password);
            navigate("/admin", { replace: true });
          } catch (err) {
            setError(t(err instanceof ApiError && err.status === 429 ? "admin.login.locked" : "admin.login.failed"));
          }
        }}
      >
        {!known && (
          <label>
            {t("admin.login.tenant")}
            <input value={tenant} onChange={(e) => setTenant(e.target.value)} required />
          </label>
        )}
        <label>
          {t("member.login.email")}
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" required />
        </label>
        <label>
          {t("admin.login.password")}
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
        </label>
        <button type="submit">{t("admin.login.submit")}</button>
      </form>
      {error && <p role="alert">{error}</p>}
    </section>
  );
}

/** Signed-in staff only; optionally restricted to roles. Renders the admin nav. */
export function RequireStaff({ roles }: { roles?: StaffRole[] }) {
  const { t } = useTranslation();
  const { staff, store } = useServices();
  const navigate = useNavigate();
  const role = staff.role();
  if (!store.get("staff") || !role) return <Navigate to="/admin/login" replace />;
  if (roles && !roles.includes(role)) return <Navigate to={MANAGERS.includes(role) ? "/admin" : "/admin/members"} replace />;
  const isManager = MANAGERS.includes(role);
  return (
    <div className="admin-shell">
      <nav className="admin-nav">
        {isManager && (
          <NavLink to="/admin" end>
            {t("screens.C2")}
          </NavLink>
        )}
        {isManager && <NavLink to="/admin/stations">{t("screens.C3")}</NavLink>}
        <NavLink to="/admin/members">{t("screens.C4")}</NavLink>
        <NavLink to="/admin/templates">{t("screens.C5")}</NavLink>
        {isManager && <NavLink to="/admin/calibration">{t("screens.C10")}</NavLink>}
        {role === "owner" && <NavLink to="/admin/settings">{t("screens.C8")}</NavLink>}
        <button className="nav-signout" onClick={async () => (await staff.signOut(), navigate("/admin/login", { replace: true }))}>{t("member.settings.signOut")}</button>
      </nav>
      <div className="admin-content">
        <Outlet />
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ C2, C3

export function AdminOverview() {
  const { t } = useTranslation();
  const { staff } = useServices();
  const [data] = useLoad(() => staff.overview(), [staff]);
  return (
    <section data-screen="C2">
      <h1>{t("screens.C2")}</h1>
      {data && (
        <>
          <div className="stat-grid">
            <p className="stat">{t("admin.overview.active", { count: data.activeSessions })}</p>
            <p className="stat">{t("admin.overview.today", { count: data.sessionsToday })}</p>
          </div>
          <h2>{t("screens.C3")}</h2>
          <ul>
            {data.stations.map((s) => (
              <li key={s.id}>
                {s.name} · {t("admin.stations.devices", { count: s.devices })} ·{" "}
                {s.lastSeenAt ? t("admin.stations.lastSeen", { at: new Date(s.lastSeenAt).toLocaleString() }) : t("admin.stations.neverSeen")}
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

export function AdminStations() {
  const { t } = useTranslation();
  const { staff } = useServices();
  const [stations, reload] = useLoad<StationRow[]>(() => staff.stations(), [staff]);
  const [codes, setCodes] = useState<Record<string, { code: string; expiresAt: string }>>({});
  const [name, setName] = useState("");
  return (
    <section data-screen="C3">
      <h1>{t("screens.C3")}</h1>
      <ul>
        {stations?.map((s) => (
          <li key={s.id}>
            <strong>{s.name}</strong> · {t("admin.stations.devices", { count: s.devices.length })}
            <button onClick={async () => setCodes({ ...codes, [s.id]: await staff.pairingCode(s.id) })}>{t("admin.stations.pairingCode")}</button>
            {codes[s.id] && (
              <span className="pairing-code">
                <code>{codes[s.id]!.code}</code> {t("admin.stations.expires", { at: new Date(codes[s.id]!.expiresAt).toLocaleTimeString() })}
              </span>
            )}
            <ul>
              {s.devices.map((d) => (
                <li key={d.id}>
                  {d.kind} · {d.lastSeenAt ? new Date(d.lastSeenAt).toLocaleString() : t("admin.stations.neverSeen")}
                  <button onClick={async () => (await staff.removeDevice(d.id), reload())}>{t("admin.stations.removeDevice")}</button>
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          await staff.createStation(name.trim(), []);
          setName("");
          reload();
        }}
      >
        <label>
          {t("admin.stations.name")}
          <input value={name} onChange={(e) => setName(e.target.value)} required />
        </label>
        <button type="submit">{t("admin.stations.add")}</button>
      </form>
    </section>
  );
}

// ------------------------------------------------------------------ C4, C6

export function AdminMembers() {
  const { t } = useTranslation();
  const { staff } = useServices();
  const [q, setQ] = useState("");
  const [members, reload] = useLoad<MemberRow[]>(() => staff.members(q || undefined), [staff, q]);
  const [form, setForm] = useState({ displayName: "", email: "", invite: false });
  const isManager = MANAGERS.includes(staff.role() ?? "trainer");
  return (
    <section data-screen="C4">
      <h1>{t("screens.C4")}</h1>
      <label>
        {t("admin.members.search")}
        <input value={q} onChange={(e) => setQ(e.target.value)} type="search" />
      </label>
      <ul>
        {members?.map((m) => (
          <li key={m.id}>
            <Link to={`/admin/members/${m.id}`}>{m.displayName}</Link>
            {!m.cameraConsent && <small> · {t("admin.members.noConsent")}</small>}
          </li>
        ))}
      </ul>
      {isManager && (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            await staff.createMember({ displayName: form.displayName.trim(), ...(form.email && { email: form.email.trim() }), ...(form.invite && { invite: true }) });
            setForm({ displayName: "", email: "", invite: false });
            reload();
          }}
        >
          <h2>{t("admin.members.add")}</h2>
          <label>
            {t("admin.members.name")}
            <input value={form.displayName} onChange={(e) => setForm({ ...form, displayName: e.target.value })} required />
          </label>
          <label>
            {t("member.login.email")}
            <input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          </label>
          <label>
            <input type="checkbox" checked={form.invite} onChange={(e) => setForm({ ...form, invite: e.target.checked })} />
            {t("admin.members.invite")}
          </label>
          <button type="submit">{t("admin.members.add")}</button>
        </form>
      )}
    </section>
  );
}

export function AdminMemberDetail() {
  const { t, i18n } = useTranslation();
  const lang = useLang();
  const { staff, now } = useServices();
  const { memberId = "" } = useParams();
  const isManager = MANAGERS.includes(staff.role() ?? "trainer");
  const [data] = useLoad(async () => {
    const [member, sessions, insights, templates] = await Promise.all([
      staff.member(memberId),
      staff.memberSessions(memberId),
      staff.memberInsights(memberId),
      staff.templates(),
    ]);
    const trainers = isManager ? await staff.trainers() : [];
    return { member, sessions, insights, templates, trainers };
  }, [staff, memberId]);
  const [templateId, setTemplateId] = useState("");
  const [startDate, setStartDate] = useState(() => new Date(now()).toISOString().slice(0, 10));
  const [trainerId, setTrainerId] = useState("");
  const [done, setDone] = useState<string | null>(null);
  if (!data) return <p role="status">{t("phone.loading")}</p>;
  const faultName = (ex: string, f: string) => RULE_PACKS[ex]?.pack.faults.find((x) => x.id === f)?.name[lang] ?? f;
  return (
    <section data-screen="C6">
      <h1>{data.member.displayName}</h1>
      <p>
        {data.member.email} · {t(data.member.cameraConsent ? "member.settings.consentOn" : "admin.members.noConsent")}
      </p>
      {isManager && <LoginLinkPanel memberId={memberId} />}
      <h2>{t("admin.detail.topFaults")}</h2>
      <ul>
        {data.insights.topFaults.map((f) => (
          <li key={`${f.exerciseId}.${f.faultId}`}>
            {faultName(f.exerciseId, f.faultId)} ({exerciseName(f.exerciseId, lang)}): {f.count}
          </li>
        ))}
      </ul>
      <h2>{t("admin.detail.weekly")}</h2>
      <ul>
        {data.insights.weeklySessions.map((w) => (
          <li key={w.week}>
            {w.week}: {w.sessions}
          </li>
        ))}
      </ul>
      <h2>{t("screens.B4")}</h2>
      <ul>
        {data.sessions.map((s: SessionSummary) => (
          <li key={s.id}>
            {new Date(s.startedAt).toLocaleDateString(i18n.language)} · {t(`member.status.${s.status}`)}
          </li>
        ))}
      </ul>
      <h2>{t("admin.detail.assignProgram")}</h2>
      <label>
        {t("admin.detail.template")}
        <select value={templateId} onChange={(e) => setTemplateId(e.target.value)}>
          <option value="" />
          {data.templates.map((tp) => (
            <option key={tp.id} value={tp.id}>
              {tp.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        {t("admin.detail.startDate")}
        <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
      </label>
      <button disabled={!templateId} onClick={async () => (await staff.assignProgram(memberId, templateId, startDate), setDone(t("admin.detail.programAssigned")))}>
        {t("admin.detail.assignProgram")}
      </button>
      {isManager && (
        <>
          <h2>{t("admin.detail.trainer")}</h2>
          <label>
            {t("admin.detail.trainer")}
            <select value={trainerId} onChange={(e) => setTrainerId(e.target.value)}>
              <option value="" />
              {data.trainers.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.email}
                </option>
              ))}
            </select>
          </label>
          <button disabled={!trainerId} onClick={async () => (await staff.assignTrainer(memberId, trainerId), setDone(t("admin.detail.trainerAssigned")))}>
            {t("admin.detail.assignTrainer")}
          </button>
        </>
      )}
      {done && <p role="status">{done}</p>}
    </section>
  );
}

/** AC-7.7: a fresh sign-in link for the member, shown once (link, copy, QR). */
function LoginLinkPanel({ memberId }: { memberId: string }) {
  const { t } = useTranslation();
  const { staff } = useServices();
  const [issued, setIssued] = useState<{ link: string; expiresAt: string; qr: string } | null>(null);
  const [copied, setCopied] = useState(false);
  return (
    <div className="login-link">
      <button
        onClick={async () => {
          const r = await staff.memberLoginLink(memberId);
          const svg = await QRCode.toString(r.link, { type: "svg", errorCorrectionLevel: "M", margin: 2 });
          setCopied(false);
          setIssued({ ...r, qr: `data:image/svg+xml;utf8,${encodeURIComponent(svg)}` });
        }}
      >
        {t("admin.detail.loginLink")}
      </button>
      {issued && (
        <>
          <p className="disclaimer">{t("admin.detail.loginLinkHint")}</p>
          <img className="login-link-qr" src={issued.qr} alt={t("admin.detail.loginLinkQr")} width={220} height={220} />
          <label>
            {t("admin.detail.loginLinkLabel")}
            <input readOnly value={issued.link} onFocus={(e) => e.target.select()} />
          </label>
          <button
            onClick={async () => {
              await navigator.clipboard?.writeText(issued.link);
              setCopied(true);
            }}
          >
            {t(copied ? "admin.detail.copied" : "admin.detail.copy")}
          </button>{" "}
          <span>{t("admin.stations.expires", { at: new Date(issued.expiresAt).toLocaleTimeString() })}</span>
        </>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ C5

export function AdminTemplates() {
  const { t } = useTranslation();
  const { staff } = useServices();
  const [templates, reload] = useLoad(() => staff.templates(), [staff]);
  const [error, setError] = useState<string | null>(null);
  return (
    <section data-screen="C5">
      <h1>{t("screens.C5")}</h1>
      <Link to="/admin/templates/new">{t("admin.templates.new")}</Link>
      <ul>
        {templates?.map((tp) => (
          <li key={tp.id}>
            <Link to={`/admin/templates/${tp.id}`}>{tp.name}</Link> · {t("admin.templates.blocks", { count: tp.blockCount })}
            <button
              onClick={async () => {
                try {
                  await staff.deleteTemplate(tp.id);
                  reload();
                } catch (e) {
                  setError(t(e instanceof ApiError && e.status === 409 ? "admin.templates.inUse" : "member.loadFailed"));
                }
              }}
            >
              {t("admin.templates.delete")}
            </button>
          </li>
        ))}
      </ul>
      {error && <p role="alert">{error}</p>}
    </section>
  );
}

interface BlockForm {
  dayIndex: number;
  exerciseId: string;
  sets: number;
  reps: number;
  restSec: number;
  mode: "strict" | "lenient";
  stationHint: string;
}

export function AdminTemplateEdit() {
  const { t } = useTranslation();
  const lang = useLang();
  const { staff } = useServices();
  const navigate = useNavigate();
  const { templateId } = useParams();
  const id = templateId && templateId !== "new" ? templateId : null;
  const [settings] = useLoad<TenantSettings>(() => staff.settings(), [staff]);
  const [name, setName] = useState("");
  const [blocks, setBlocks] = useState<BlockForm[]>([]);
  const [error, setError] = useState<string | null>(null);
  const exercises = useMemo(() => Object.keys(RULE_PACKS), []);

  useEffect(() => {
    if (!id) return;
    void staff.template(id).then((tp) => {
      setName(tp.name);
      setBlocks(tp.blocks.map((b) => ({ dayIndex: b.dayIndex, exerciseId: b.exerciseId, sets: b.sets, reps: b.reps ?? 10, restSec: b.restSec, mode: b.mode, stationHint: b.stationHint ?? "" })));
    });
  }, [id, staff]);

  const defaultMode = settings?.defaultMode ?? "strict";
  // blocks added before settings loaded follow the gym default too
  useEffect(() => {
    if (!settings) return;
    setBlocks((bs) => bs.map((b) => ({ ...b, mode: b.mode === "strict" && settings.defaultMode !== "strict" ? settings.defaultMode : b.mode })));
  }, [settings]);

  const update = (i: number, patch: Partial<BlockForm>) => setBlocks((bs) => bs.map((b, j) => (j === i ? { ...b, ...patch } : b)));
  const toPayload = (): TemplateBlock[] => {
    const perDay = new Map<number, number>();
    return blocks.map((b) => {
      const position = perDay.get(b.dayIndex) ?? 0;
      perDay.set(b.dayIndex, position + 1);
      return { dayIndex: b.dayIndex, position, exerciseId: b.exerciseId, sets: b.sets, reps: b.reps, restSec: b.restSec, mode: b.mode, ...(b.stationHint.trim() && { stationHint: b.stationHint.trim() }) };
    });
  };

  return (
    <section data-screen="C5">
      <h1>{t("screens.C5")}</h1>
      <label>
        {t("admin.templates.name")}
        <input value={name} onChange={(e) => setName(e.target.value)} required />
      </label>
      {blocks.map((b, i) => (
        <fieldset key={i}>
          <legend>{t("admin.templates.block", { n: i + 1 })}</legend>
          <label>
            {t("admin.templates.day")}
            <input type="number" min={1} max={14} value={b.dayIndex + 1} onChange={(e) => update(i, { dayIndex: Math.max(0, Number(e.target.value) - 1) })} />
          </label>
          <label>
            {t("calibration.exercise")}
            <select value={b.exerciseId} onChange={(e) => update(i, { exerciseId: e.target.value })}>
              {exercises.map((x) => (
                <option key={x} value={x}>
                  {exerciseName(x, lang)}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t("admin.templates.sets")}
            <input type="number" min={1} max={20} value={b.sets} onChange={(e) => update(i, { sets: Number(e.target.value) })} />
          </label>
          <label>
            {t("admin.templates.reps")}
            <input type="number" min={1} max={200} value={b.reps} onChange={(e) => update(i, { reps: Number(e.target.value) })} />
          </label>
          <label>
            {t("admin.templates.rest")}
            <input type="number" min={0} max={1800} value={b.restSec} onChange={(e) => update(i, { restSec: Number(e.target.value) })} />
          </label>
          <label>
            {t("admin.templates.mode")}
            <select value={b.mode} onChange={(e) => update(i, { mode: e.target.value as "strict" | "lenient" })}>
              <option value="strict">{t("admin.templates.strict")}</option>
              <option value="lenient">{t("admin.templates.lenient")}</option>
            </select>
          </label>
          <label>
            {t("admin.templates.station")}
            <input value={b.stationHint} onChange={(e) => update(i, { stationHint: e.target.value })} />
          </label>
          <button onClick={() => setBlocks((bs) => bs.filter((_, j) => j !== i))}>{t("admin.templates.removeBlock")}</button>
        </fieldset>
      ))}
      <button onClick={() => setBlocks((bs) => [...bs, { dayIndex: bs.at(-1)?.dayIndex ?? 0, exerciseId: "squat", sets: 3, reps: 10, restSec: 60, mode: defaultMode, stationHint: "" }])}>
        {t("admin.templates.addBlock")}
      </button>
      <button
        className="primary"
        disabled={!name.trim() || blocks.length === 0}
        onClick={async () => {
          try {
            await staff.saveTemplate(id, { name: name.trim(), blocks: toPayload() });
            navigate("/admin/templates");
          } catch {
            setError(t("admin.templates.saveFailed"));
          }
        }}
      >
        {t("calibration.save")}
      </button>
      {error && <p role="alert">{error}</p>}
    </section>
  );
}

// ------------------------------------------------------------------ C8

export function AdminSettings() {
  const { t } = useTranslation();
  const { staff } = useServices();
  const [settings, setSettings] = useState<TenantSettings | null>(null);
  const [users, reloadUsers] = useLoad(() => staff.users(), [staff]);
  const [requests, reloadRequests] = useLoad(() => staff.dataRequests(), [staff]);
  const [form, setForm] = useState({ email: "", role: "trainer" as StaffRole, password: "" });
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    void staff.settings().then(setSettings, () => undefined);
  }, [staff]);

  return (
    <section data-screen="C8">
      <h1>{t("screens.C8")}</h1>
      {settings && (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setSettings(await staff.saveSettings(settings));
            setSaved(true);
          }}
        >
          <label>
            {t("admin.settings.defaultMode")}
            <select value={settings.defaultMode} onChange={(e) => setSettings({ ...settings, defaultMode: e.target.value as "strict" | "lenient" })}>
              <option value="strict">{t("admin.templates.strict")}</option>
              <option value="lenient">{t("admin.templates.lenient")}</option>
            </select>
          </label>
          <label>
            {t("admin.settings.retention")}
            <input type="number" min={1} max={120} value={settings.retentionMonths} onChange={(e) => setSettings({ ...settings, retentionMonths: Number(e.target.value) })} />
          </label>
          <label>
            <input type="checkbox" checked={settings.safetyPause} onChange={(e) => setSettings({ ...settings, safetyPause: e.target.checked })} />
            {t("admin.settings.safetyPause")}
          </label>
          <button type="submit">{t("admin.settings.save")}</button>
          {saved && <span role="status"> {t("admin.settings.saved")}</span>}
        </form>
      )}
      <h2>{t("admin.settings.staff")}</h2>
      <ul>
        {users?.map((u) => (
          <li key={u.id}>
            {u.email} · {t(`admin.roles.${u.role}`)}
          </li>
        ))}
      </ul>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          await staff.createUser({ email: form.email.trim(), role: form.role, password: form.password });
          setForm({ email: "", role: "trainer", password: "" });
          reloadUsers();
        }}
      >
        <label>
          {t("admin.settings.staffEmail")}
          <input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required />
        </label>
        <label>
          {t("admin.settings.role")}
          <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as StaffRole })}>
            {(["trainer", "manager", "owner"] as const).map((r) => (
              <option key={r} value={r}>
                {t(`admin.roles.${r}`)}
              </option>
            ))}
          </select>
        </label>
        <label>
          {t("admin.settings.tempPassword")}
          <input type="text" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} minLength={12} required />
        </label>
        <button type="submit">{t("admin.settings.addStaff")}</button>
      </form>
      <h2>{t("admin.settings.dataRequests")}</h2>
      <ul>
        {requests?.map((r) => (
          <li key={r.id}>
            {r.memberName} · {t(`admin.settings.requestKind.${r.kind}`)} · {new Date(r.requestedAt).toLocaleDateString()}
            {r.completedAt ? ` · ${t("admin.settings.completed")}` : ` · ${t("admin.settings.open")}`}
            {!r.completedAt && r.kind === "delete" && (
              <button
                onClick={async () => {
                  if (!globalThis.confirm(t("admin.settings.eraseConfirm", { name: r.memberName }))) return;
                  await staff.completeDataRequest(r.id);
                  reloadRequests();
                }}
              >
                {t("admin.settings.erase")}
              </button>
            )}
          </li>
        ))}
      </ul>
      <h2>{t("admin.settings.notice")}</h2>
      <blockquote className="notice-template">
        {(t("admin.settings.noticeText", { returnObjects: true }) as string[]).map((p) => (
          <p key={p}>{p}</p>
        ))}
        <p className="disclaimer">{t("legal.medicalDisclaimer")}</p>
      </blockquote>
    </section>
  );
}

// ------------------------------------------------------------------ C10

/** Consent first, then the encrypted upload (specs/07, AC-7.5). */
export async function uploadCalibrationSave(staff: StaffApi, save: CalibrationSave): Promise<void> {
  const { id } = await staff.calibrationConsent(save.consent);
  await staff.uploadCalibration(id, save.sequence);
}

export function AdminCalibration() {
  const { t } = useTranslation();
  const services = useServices();
  const source = useMemo(() => services.createPoseSource(), [services]);
  const [status, setStatus] = useState<string | null>(null);
  const role = services.staff.role() ?? "trainer";
  return (
    <>
      <CalibrationPage
        role={role}
        source={source}
        requestCamera={services.requestCamera}
        now={services.now}
        onSave={async (save) => {
          try {
            await uploadCalibrationSave(services.staff, save);
            setStatus(t("admin.calibration.uploaded"));
          } catch {
            setStatus(t("admin.calibration.failed"));
          }
        }}
      />
      {status && <p role="status">{status}</p>}
    </>
  );
}
