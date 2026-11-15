import { safeLoadRulePack } from "@gymspot/engine";
import { CHECK_POSITIONS, type CheckPosition } from "@gymspot/shared";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate, useParams } from "react-router";
import { ApiError } from "../api/client";
import type { GymExerciseRow } from "../api/staff";
import { RULE_PACKS, applyRulePacks, rulePack } from "../rules";
import { useServices } from "../services";
import {
  type Clause,
  type Condition,
  type Definition,
  GYM_EXERCISE_ID,
  type Operand,
  type Path,
  STARTERS,
  type StarterId,
  checkFromText,
  checkToText,
  getIn,
  gymExerciseId,
  issuesUnder,
  readyPoseFromText,
  readyPoseToText,
  setIn,
  startFrom,
} from "./model";

// Exercise designer C11 (specs/11): list, new exercise, form editor + JSON view.
// The pack JSON is the single source of truth; the form only reads/writes paths.

const useLang = () => (useTranslation().i18n.language === "en" ? "en" : "tr");
const isManager = (role: string | null) => role === "owner" || role === "manager";

// ------------------------------------------------------------------ list

export function ExercisesPage() {
  const { t } = useTranslation();
  const lang = useLang();
  const { staff } = useServices();
  const [rows, setRows] = useState<GymExerciseRow[] | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    staff.gymExercises().then(setRows, () => setError(true));
  }, [staff]);
  const manager = isManager(staff.role());
  return (
    <section data-screen="C11">
      <h1>{t("screens.C11")}</h1>
      <p className="hint">{t("designer.intro")}</p>
      {manager && (
        <Link className="button" to="/admin/exercises/new">
          {t("designer.new")}
        </Link>
      )}
      {error && <p role="alert">{t("member.loadFailed")}</p>}
      {rows?.length === 0 && <p>{t("designer.empty")}</p>}
      <ul>
        {rows?.map((r) => {
          const label = r.name?.[lang] ?? r.id;
          return (
            <li key={r.id}>
              {manager ? <Link to={`/admin/exercises/${r.id}`}>{label}</Link> : label} <code>{r.id}</code>
              {r.publishedVersion !== null && <span className="badge"> {t("designer.published", { version: r.publishedVersion })}</span>}
              {r.draft && <span className="badge badge-draft"> {t("designer.draft")}</span>}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

// ------------------------------------------------------------------ new

export function NewExercisePage() {
  const { t } = useTranslation();
  const lang = useLang();
  const { staff } = useServices();
  const navigate = useNavigate();
  const [nameTr, setNameTr] = useState("");
  const [nameEn, setNameEn] = useState("");
  const [id, setId] = useState("");
  const [idEdited, setIdEdited] = useState(false);
  const [source, setSource] = useState<{ kind: "starter"; id: StarterId } | { kind: "copy"; id: string }>({ kind: "starter", id: "joint" });
  const [error, setError] = useState<string | null>(null);
  const copyable = useMemo(() => Object.keys(RULE_PACKS).sort(), []);
  const effectiveId = idEdited ? id : gymExerciseId(nameTr);

  const create = async () => {
    if (!GYM_EXERCISE_ID.test(effectiveId)) return setError(t("designer.badId"));
    const taken = (await staff.gymExercises().catch(() => [])).some((r) => r.id === effectiveId);
    if (taken) return setError(t("designer.idTaken"));
    const name = { tr: nameTr.trim(), en: nameEn.trim() || nameTr.trim() };
    const def =
      source.kind === "starter"
        ? startFrom(rulePack(STARTERS.find((s) => s.id === source.id)!.from), effectiveId, name, false)
        : startFrom(rulePack(source.id), effectiveId, name, true);
    try {
      await staff.saveExerciseDraft(effectiveId, def);
      navigate(`/admin/exercises/${effectiveId}`);
    } catch {
      setError(t("designer.saveFailed"));
    }
  };

  return (
    <section data-screen="C11">
      <h1>{t("designer.new")}</h1>
      <label>
        {t("designer.nameTr")}
        <input value={nameTr} onChange={(e) => setNameTr(e.target.value)} required />
      </label>
      <label>
        {t("designer.nameEn")}
        <input value={nameEn} onChange={(e) => setNameEn(e.target.value)} placeholder={nameTr} />
      </label>
      <label>
        {t("designer.id")}
        <input
          value={effectiveId}
          onChange={(e) => {
            setIdEdited(true);
            setId(e.target.value);
          }}
        />
      </label>
      <fieldset>
        <legend>{t("designer.startFrom")}</legend>
        {STARTERS.map((s) => (
          <label key={s.id} className="inline">
            <input type="radio" name="start" checked={source.kind === "starter" && source.id === s.id} onChange={() => setSource({ kind: "starter", id: s.id })} />
            {t(`designer.starter.${s.id}`)}
          </label>
        ))}
        <label className="inline">
          <input type="radio" name="start" checked={source.kind === "copy"} onChange={() => setSource({ kind: "copy", id: copyable[0]! })} />
          {t("designer.copyOf")}
        </label>
        {source.kind === "copy" && (
          <select aria-label={t("designer.copyOf")} value={source.id} onChange={(e) => setSource({ kind: "copy", id: e.target.value })}>
            {copyable.map((x) => (
              <option key={x} value={x}>
                {RULE_PACKS[x]!.pack.name[lang]}
              </option>
            ))}
          </select>
        )}
      </fieldset>
      <button className="primary" disabled={!nameTr.trim()} onClick={() => void create()}>
        {t("designer.create")}
      </button>
      {error && <p role="alert">{error}</p>}
    </section>
  );
}

// ------------------------------------------------------------------ editor

type Load = { state: "loading" } | { state: "draft"; def: Definition } | { state: "none" } | { state: "error" };

export function ExerciseEditorPage() {
  const { t } = useTranslation();
  const lang = useLang();
  const { staff } = useServices();
  const navigate = useNavigate();
  const { exerciseId = "" } = useParams();
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const [def, setDef] = useState<Definition | null>(null);
  const [dirty, setDirty] = useState(false);
  const [tab, setTab] = useState<"form" | "json">("form");
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  useEffect(() => {
    staff.exerciseDraft(exerciseId).then(
      (d) => {
        setLoad({ state: "draft", def: d.definition });
        setDef(d.definition);
      },
      (e) => setLoad(e instanceof ApiError && e.status === 404 ? { state: "none" } : { state: "error" }),
    );
  }, [staff, exerciseId]);

  const issues = useMemo(() => {
    if (!def) return [];
    const r = safeLoadRulePack(def);
    return r.success ? [] : r.issues;
  }, [def]);

  if (load.state === "loading") return <section data-screen="C11" />;
  if (load.state === "error") return <p role="alert">{t("member.loadFailed")}</p>;
  if (load.state === "none" || !def) {
    const published = RULE_PACKS[exerciseId];
    return (
      <section data-screen="C11">
        <h1>{published?.pack.name.tr ?? exerciseId}</h1>
        {published ? (
          <button
            onClick={async () => {
              const d = structuredClone(published.pack) as unknown as Definition;
              await staff.saveExerciseDraft(exerciseId, d);
              setLoad({ state: "draft", def: d });
              setDef(d);
            }}
          >
            {t("designer.newVersion", { version: published.pack.version + 1 })}
          </button>
        ) : (
          <p>{t("designer.notFound")}</p>
        )}
      </section>
    );
  }

  const set = (path: Path, value: unknown) => {
    setDef((d) => setIn(d!, path, value));
    setDirty(true);
    setMessage(null);
  };
  const save = async () => {
    try {
      await staff.saveExerciseDraft(exerciseId, def);
      setDirty(false);
      setMessage({ kind: "ok", text: t("designer.saved") });
    } catch {
      setMessage({ kind: "error", text: t("designer.saveFailed") });
    }
  };
  const publish = async () => {
    try {
      await staff.publishExercise(exerciseId);
      applyRulePacks((await staff.exercises().catch(() => [])).map((e) => e.definition));
      navigate("/admin/exercises", { replace: true });
    } catch (e) {
      const list = e instanceof ApiError && Array.isArray((e.body as { issues?: unknown })?.issues) ? (e.body as { issues: string[] }).issues : [];
      setMessage({ kind: "error", text: list.length ? `${t("designer.invalid")} ${list.join("; ")}` : t("designer.publishFailed") });
    }
  };
  const discard = async () => {
    if (!window.confirm(t("designer.discardConfirm"))) return;
    await staff.deleteExerciseDraft(exerciseId).catch(() => undefined);
    navigate("/admin/exercises", { replace: true });
  };

  const title = (getIn(def, ["name", lang]) as string | undefined) || exerciseId;
  return (
    <section data-screen="C11" className="designer">
      <h1>{title}</h1>
      <p className="disclaimer">{t("designer.disclaimer")}</p>
      <div role="tablist">
        <button role="tab" aria-selected={tab === "form"} onClick={() => setTab("form")}>
          {t("designer.tabForm")}
        </button>
        <button role="tab" aria-selected={tab === "json"} onClick={() => setTab("json")}>
          {t("designer.tabJson")}
        </button>
      </div>
      {issues.length > 0 ? (
        <div className="alert alert-danger" role="status" aria-label={t("designer.issues")}>
          <strong>{t("designer.issues")}</strong>
          <ul>
            {issues.map((i) => (
              <li key={i}>{i}</li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="alert alert-ok" role="status">
          {t("designer.valid")}
        </p>
      )}
      {tab === "form" ? <DefinitionForm def={def} issues={issues} set={set} /> : <JsonView def={def} onChange={(d) => { setDef(d); setDirty(true); }} />}
      <div className="controls">
        <button className="primary" onClick={() => void save()} disabled={!dirty}>
          {t("designer.save")}
        </button>
        <button onClick={() => void publish()} disabled={dirty || issues.length > 0}>
          {t("designer.publish")}
        </button>
        <button onClick={() => void discard()}>{t("designer.discard")}</button>
      </div>
      {message && (
        <p role={message.kind === "error" ? "alert" : "status"} className={message.kind === "error" ? "alert alert-danger" : undefined}>
          {message.text}
        </p>
      )}
    </section>
  );
}

function JsonView({ def, onChange }: { def: Definition; onChange(d: Definition): void }) {
  const { t } = useTranslation();
  const [text, setText] = useState(() => JSON.stringify(def, null, 2));
  const [error, setError] = useState(false);
  useEffect(() => setText(JSON.stringify(def, null, 2)), [def]);
  return (
    <div>
      <textarea
        aria-label={t("designer.tabJson")}
        className="json"
        spellCheck={false}
        rows={30}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          try {
            const parsed: unknown = JSON.parse(e.target.value);
            if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("not an object");
            setError(false);
            onChange(parsed as Definition);
          } catch {
            setError(true);
          }
        }}
      />
      {error && <p role="alert">{t("designer.badJson")}</p>}
    </div>
  );
}

// ------------------------------------------------------------------ form

interface FormProps {
  def: Definition;
  issues: readonly string[];
  set(path: Path, value: unknown): void;
}

function Issues({ issues, prefix }: { issues: readonly string[]; prefix: string }) {
  const mine = issuesUnder(issues, prefix);
  if (mine.length === 0) return null;
  return (
    <ul className="field-issues">
      {mine.map((i) => (
        <li key={i}>{i}</li>
      ))}
    </ul>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <fieldset>
      <legend>{title}</legend>
      {children}
    </fieldset>
  );
}

function TextField({ label, def, path, set, multiline }: { label: string; def: Definition; path: Path; set: FormProps["set"]; multiline?: boolean }) {
  const value = (getIn(def, path) as string | undefined) ?? "";
  return (
    <label>
      {label}
      {multiline ? <textarea value={value} onChange={(e) => set(path, e.target.value)} rows={3} /> : <input value={value} onChange={(e) => set(path, e.target.value)} />}
    </label>
  );
}

function NumberField({ label, def, path, set, step = "any", optional }: { label: string; def: Definition; path: Path; set: FormProps["set"]; step?: string; optional?: boolean }) {
  const value = getIn(def, path) as number | undefined;
  return (
    <label>
      {label}
      <input
        type="number"
        step={step}
        value={value ?? ""}
        onChange={(e) => set(path, e.target.value === "" ? (optional ? undefined : 0) : Number(e.target.value))}
      />
    </label>
  );
}

function DefinitionForm({ def, issues, set }: FormProps) {
  const { t } = useTranslation();
  const metrics = Object.keys((getIn(def, ["metrics"]) as Record<string, unknown> | undefined) ?? {});
  return (
    <div className="designer-form">
      <GeneralSection def={def} issues={issues} set={set} />
      <MetricsSection def={def} issues={issues} set={set} />
      <Section title={t("designer.section.rep")}>
        <label>
          {t("designer.rep.metric")}
          <select value={(getIn(def, ["rep", "metric"]) as string) ?? ""} onChange={(e) => set(["rep", "metric"], e.target.value)}>
            {metrics.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </label>
        <div className="row">
          <NumberField label={t("designer.rep.startEnter")} def={def} path={["rep", "start", "enter"]} set={set} />
          <NumberField label={t("designer.rep.startExit")} def={def} path={["rep", "start", "exit"]} set={set} />
          <NumberField label={t("designer.rep.targetEnter")} def={def} path={["rep", "target", "enter"]} set={set} />
          <NumberField label={t("designer.rep.targetExit")} def={def} path={["rep", "target", "exit"]} set={set} />
        </div>
        <div className="row">
          <NumberField label={t("designer.rep.excursion")} def={def} path={["rep", "attemptMinExcursion"]} set={set} />
          <NumberField label={t("designer.rep.minMs")} def={def} path={["rep", "minDurationMs"]} set={set} step="1" />
          <NumberField label={t("designer.rep.maxMs")} def={def} path={["rep", "maxDurationMs"]} set={set} step="1" />
        </div>
        <p className="hint">{t("designer.rep.hint")}</p>
        <Issues issues={issues} prefix="rep" />
      </Section>
      <ReadyPoseSection def={def} issues={issues} set={set} metrics={metrics} />
      <FaultsSection def={def} issues={issues} set={set} metrics={metrics} />
    </div>
  );
}

const BODY_PARTS = ["shoulder", "elbow", "wrist", "hip", "knee", "ankle", "heel", "foot_index"] as const;
const LANDMARK_CHOICES = ["nose", ...(["near", "far", "left", "right"] as const).flatMap((s) => BODY_PARTS.map((p) => `${s}_${p}`))];

function useLandmarkLabel() {
  const { t } = useTranslation();
  return (ref: string) => {
    if (ref === "nose") return t("designer.lm.nose");
    const [side, ...rest] = ref.split("_");
    const part = rest.join("_");
    return `${t(`designer.lm.side.${side}`, { defaultValue: side })} ${t(`designer.lm.part.${part}`, { defaultValue: part })}`;
  };
}

function GeneralSection({ def, issues, set }: FormProps) {
  const { t } = useTranslation();
  const label = useLandmarkLabel();
  const views = (getIn(def, ["camera", "views"]) as string[] | undefined) ?? [];
  const visible = (getIn(def, ["camera", "minVisibleLandmarks"]) as string[] | undefined) ?? [];
  const choices = [...new Set([...LANDMARK_CHOICES, ...visible])];
  const toggle = (list: string[], x: string) => (list.includes(x) ? list.filter((y) => y !== x) : [...list, x]);
  return (
    <Section title={t("designer.section.general")}>
      <div className="row">
        <TextField label={t("designer.nameTr")} def={def} path={["name", "tr"]} set={set} />
        <TextField label={t("designer.nameEn")} def={def} path={["name", "en"]} set={set} />
      </div>
      <div className="row">
        <TextField label={t("designer.howToTr")} def={def} path={["howTo", "tr"]} set={set} multiline />
        <TextField label={t("designer.howToEn")} def={def} path={["howTo", "en"]} set={set} multiline />
      </div>
      <Issues issues={issues} prefix="name" />
      <Issues issues={issues} prefix="howTo" />
      <fieldset>
        <legend>{t("designer.camera.views")}</legend>
        {(["front", "side"] as const).map((v) => (
          <label key={v} className="inline">
            <input type="checkbox" checked={views.includes(v)} onChange={() => set(["camera", "views"], toggle(views, v))} />
            {t(`designer.camera.${v}`)}
          </label>
        ))}
      </fieldset>
      <label>
        {t("designer.camera.posture")}
        <select value={(getIn(def, ["camera", "posture"]) as string) ?? "standing"} onChange={(e) => set(["camera", "posture"], e.target.value)}>
          <option value="standing">{t("designer.camera.standing")}</option>
          <option value="horizontal">{t("designer.camera.horizontal")}</option>
        </select>
      </label>
      <div className="row">
        <TextField label={t("designer.camera.hintTr")} def={def} path={["camera", "setupHint", "tr"]} set={set} multiline />
        <TextField label={t("designer.camera.hintEn")} def={def} path={["camera", "setupHint", "en"]} set={set} multiline />
      </div>
      <NumberField label={t("designer.camera.minVisibility")} def={def} path={["camera", "minVisibility"]} set={set} />
      <fieldset>
        <legend>{t("designer.camera.visible")}</legend>
        <div className="checkgrid">
          {choices.map((x) => (
            <label key={x} className="inline">
              <input type="checkbox" checked={visible.includes(x)} onChange={() => set(["camera", "minVisibleLandmarks"], toggle(visible, x))} />
              {label(x)}
            </label>
          ))}
        </div>
      </fieldset>
      <Issues issues={issues} prefix="camera" />
    </Section>
  );
}

type FnName = "angle" | "angleFromVertical" | "diffY" | "kneeInwardRatio" | "signedOffset" | "lateralLean" | "chainHeight" | "avg" | "absDiff" | "max";
const FUNCTIONS: Record<FnName, { args: "landmark" | "metric"; count: number | readonly [number, number] }> = {
  angle: { args: "landmark", count: 3 },
  angleFromVertical: { args: "landmark", count: 2 },
  diffY: { args: "landmark", count: 2 },
  kneeInwardRatio: { args: "landmark", count: 3 },
  signedOffset: { args: "landmark", count: 3 },
  lateralLean: { args: "landmark", count: 2 },
  chainHeight: { args: "landmark", count: [2, 6] },
  avg: { args: "metric", count: 2 },
  absDiff: { args: "metric", count: 2 },
  max: { args: "metric", count: 2 },
};
const FN_NAMES = Object.keys(FUNCTIONS) as FnName[];

function MetricsSection({ def, issues, set }: FormProps) {
  const { t } = useTranslation();
  const label = useLandmarkLabel();
  const all = (getIn(def, ["metrics"]) as Record<string, Record<string, string[]>> | undefined) ?? {};
  const names = Object.keys(all);
  const [newName, setNewName] = useState("");
  const defaultArgs = (fn: FnName): string[] => {
    const spec = FUNCTIONS[fn];
    const n = typeof spec.count === "number" ? spec.count : spec.count[0];
    return Array.from({ length: n }, (_, i) => (spec.args === "metric" ? (names[i] ?? names[0] ?? "") : (["near_hip", "near_knee", "near_ankle"][i] ?? "near_ankle")));
  };
  return (
    <Section title={t("designer.section.metrics")}>
      <p className="hint">{t("designer.metrics.hint")}</p>
      {names.map((name) => {
        const m = all[name]!;
        const fn = Object.keys(m)[0] as FnName;
        const args = m[fn] ?? [];
        const spec = FUNCTIONS[fn];
        const options = spec?.args === "metric" ? names.filter((n) => n !== name) : [...new Set([...LANDMARK_CHOICES, ...args])];
        return (
          <div key={name} className="metric-row">
            <code>{name}</code>
            <select aria-label={t("designer.metrics.function", { name })} value={fn} onChange={(e) => set(["metrics", name], { [e.target.value]: defaultArgs(e.target.value as FnName) })}>
              {FN_NAMES.map((f) => (
                <option key={f} value={f}>
                  {t(`designer.fn.${f}`)}
                </option>
              ))}
            </select>
            {args.map((a, i) => (
              <select key={i} aria-label={t("designer.metrics.arg", { name, n: i + 1 })} value={a} onChange={(e) => set(["metrics", name, fn, i], e.target.value)}>
                {options.map((o) => (
                  <option key={o} value={o}>
                    {spec?.args === "metric" ? o : label(o)}
                  </option>
                ))}
              </select>
            ))}
            {spec && typeof spec.count !== "number" && (
              <>
                <button disabled={args.length >= spec.count[1]} onClick={() => set(["metrics", name, fn], [...args, args.at(-1) ?? "nose"])}>
                  +
                </button>
                <button disabled={args.length <= spec.count[0]} onClick={() => set(["metrics", name, fn], args.slice(0, -1))}>
                  −
                </button>
              </>
            )}
            <button onClick={() => set(["metrics", name], undefined)}>{t("designer.remove")}</button>
            <Issues issues={issues} prefix={`metrics.${name}`} />
          </div>
        );
      })}
      <div className="row">
        <label>
          {t("designer.metrics.newName")}
          <input value={newName} onChange={(e) => setNewName(e.target.value.toLowerCase())} placeholder="knee" />
        </label>
        <button
          disabled={!/^[a-z][a-z0-9_]*$/.test(newName) || names.includes(newName)}
          onClick={() => {
            set(["metrics", newName], { angle: defaultArgs("angle") });
            setNewName("");
          }}
        >
          {t("designer.metrics.add")}
        </button>
      </div>
      <Issues issues={issues} prefix="metrics" />
    </Section>
  );
}

// ------------------------------------------------------------------ conditions

const OPS = [">", "<", ">=", "<="] as const;

function OperandEditor({ value, metrics, allowCall, onChange, label }: { value: Operand; metrics: string[]; allowCall: boolean; onChange(o: Operand): void; label: string }) {
  const { t } = useTranslation();
  const kinds = allowCall ? (["metric", "min", "max", "avg", "abs", "number"] as const) : (["number", "metric"] as const);
  const kind = value.kind === "call" ? value.fn : value.kind;
  const first = metrics[0] ?? "";
  return (
    <span className="operand">
      <select
        aria-label={label}
        value={kind}
        onChange={(e) => {
          const k = e.target.value;
          onChange(k === "number" ? { kind: "number", value: 0 } : k === "metric" ? { kind: "metric", name: first } : { kind: "call", fn: k as "min", metrics: k === "abs" ? [first] : metrics.slice(0, 2) });
        }}
      >
        {kinds.map((k) => (
          <option key={k} value={k}>
            {t(`designer.cond.kind.${k}`)}
          </option>
        ))}
      </select>
      {value.kind === "number" && <input type="number" step="any" aria-label={`${label} ${t("designer.cond.kind.number")}`} value={value.value} onChange={(e) => onChange({ kind: "number", value: Number(e.target.value) })} />}
      {value.kind === "metric" && (
        <select aria-label={`${label} ${t("designer.cond.kind.metric")}`} value={value.name} onChange={(e) => onChange({ kind: "metric", name: e.target.value })}>
          {[...new Set([...metrics, value.name])].map((m) => (
            <option key={m}>{m}</option>
          ))}
        </select>
      )}
      {value.kind === "call" &&
        (value.fn === "abs" ? (
          <select value={value.metrics[0]} onChange={(e) => onChange({ ...value, metrics: [e.target.value] })}>
            {[...new Set([...metrics, ...value.metrics])].map((m) => (
              <option key={m}>{m}</option>
            ))}
          </select>
        ) : (
          metrics.map((m) => (
            <label key={m} className="inline">
              <input
                type="checkbox"
                checked={value.metrics.includes(m)}
                onChange={() => {
                  const next = value.metrics.includes(m) ? value.metrics.filter((x) => x !== m) : [...value.metrics, m];
                  if (next.length > 0) onChange({ ...value, metrics: next });
                }}
              />
              {m}
            </label>
          ))
        ))}
    </span>
  );
}

function ConditionEditor({ condition, text, metrics, onChange }: { condition: Condition | null; text: string; metrics: string[]; onChange(c: Condition): void }) {
  const { t } = useTranslation();
  const fresh = (): Clause => ({ left: { kind: "metric", name: metrics[0] ?? "" }, op: "<", right: { kind: "number", value: 0 } });
  if (!condition) {
    return (
      <div className="condition">
        <code>{text}</code>
        <p className="hint">{t("designer.cond.asText")}</p>
        <button onClick={() => onChange({ join: "and", clauses: [fresh()] })}>{t("designer.cond.rewrite")}</button>
      </div>
    );
  }
  const update = (i: number, c: Clause | null) =>
    onChange({ ...condition, clauses: c ? condition.clauses.map((x, j) => (j === i ? c : x)) : condition.clauses.filter((_, j) => j !== i) });
  return (
    <div className="condition">
      {condition.clauses.map((c, i) => (
        <div key={i} className="clause">
          {i > 0 && (
            <select aria-label={t("designer.cond.join")} value={condition.join} onChange={(e) => onChange({ ...condition, join: e.target.value as "and" | "or" })}>
              <option value="and">{t("designer.cond.and")}</option>
              <option value="or">{t("designer.cond.or")}</option>
            </select>
          )}
          <OperandEditor label={t("designer.cond.left", { n: i + 1 })} value={c.left} metrics={metrics} allowCall onChange={(left) => update(i, { ...c, left })} />
          <select aria-label={t("designer.cond.op", { n: i + 1 })} value={c.op} onChange={(e) => update(i, { ...c, op: e.target.value as Clause["op"] })}>
            {OPS.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </select>
          <OperandEditor label={t("designer.cond.right", { n: i + 1 })} value={c.right} metrics={metrics} allowCall={false} onChange={(right) => update(i, { ...c, right })} />
          {condition.clauses.length > 1 && <button onClick={() => update(i, null)}>{t("designer.remove")}</button>}
        </div>
      ))}
      <button onClick={() => onChange({ ...condition, clauses: [...condition.clauses, fresh()] })}>{t("designer.cond.add")}</button>
    </div>
  );
}

function ReadyPoseSection({ def, issues, set, metrics }: FormProps & { metrics: string[] }) {
  const { t } = useTranslation();
  const src = (getIn(def, ["readyPose"]) as string | undefined) ?? "";
  const form = readyPoseFromText(src);
  return (
    <Section title={t("designer.section.ready")}>
      <p className="hint">{t("designer.ready.hint")}</p>
      <ConditionEditor condition={form.condition} text={form.text} metrics={metrics} onChange={(c) => set(["readyPose"], readyPoseToText(c, form.durationMs))} />
      <label>
        {t("designer.ready.holdMs")}
        <input type="number" min={1} step={100} value={form.durationMs} onChange={(e) => set(["readyPose"], readyPoseToText(form.condition ?? form.text, Number(e.target.value)))} />
      </label>
      <Issues issues={issues} prefix="readyPose" />
    </Section>
  );
}

function FaultsSection({ def, issues, set, metrics }: FormProps & { metrics: string[] }) {
  const { t } = useTranslation();
  const faults = (getIn(def, ["faults"]) as Record<string, unknown>[] | undefined) ?? [];
  const add = () => {
    const n = faults.length + 1;
    set(["faults"], [
      ...faults,
      {
        id: `fault_${n}`,
        name: { tr: "", en: "" },
        severity: "minor",
        check: `at_turn: ${metrics[0] ?? "x"} < 0`,
        cue: { tr: "", en: "" },
        affectsValidity: false,
        cooldownMs: 4000,
        minConsecutiveReps: 1,
      },
    ]);
  };
  return (
    <Section title={t("designer.section.faults")}>
      <p className="hint">{t("designer.faults.hint")}</p>
      {faults.map((f, i) => {
        const check = checkFromText((f.check as string) ?? "at_turn: ");
        const setCheck = (position: CheckPosition, c: Condition | string) => {
          set(["faults", i, "check"], checkToText(position, c));
          if (position !== "during_rep" && f.holdMs !== undefined) set(["faults", i, "holdMs"], undefined);
        };
        return (
          <fieldset key={i}>
            <legend>{t("designer.faults.title", { n: i + 1 })}</legend>
            <div className="row">
              <TextField label={t("designer.faults.id")} def={def} path={["faults", i, "id"]} set={set} />
              <TextField label={t("designer.faults.nameTr")} def={def} path={["faults", i, "name", "tr"]} set={set} />
              <TextField label={t("designer.faults.nameEn")} def={def} path={["faults", i, "name", "en"]} set={set} />
            </div>
            <div className="row">
              <TextField label={t("designer.faults.cueTr")} def={def} path={["faults", i, "cue", "tr"]} set={set} />
              <TextField label={t("designer.faults.cueEn")} def={def} path={["faults", i, "cue", "en"]} set={set} />
            </div>
            <div className="row">
              <label>
                {t("designer.faults.severity")}
                <select value={f.severity as string} onChange={(e) => set(["faults", i, "severity"], e.target.value)}>
                  <option value="minor">{t("designer.faults.minor")}</option>
                  <option value="major">{t("designer.faults.major")}</option>
                </select>
              </label>
              <label className="inline">
                <input type="checkbox" checked={f.affectsValidity === true} onChange={(e) => set(["faults", i, "affectsValidity"], e.target.checked)} />
                {t("designer.faults.affectsValidity")}
              </label>
              <label>
                {t("designer.faults.when")}
                <select value={check.position} onChange={(e) => setCheck(e.target.value as CheckPosition, check.condition ?? check.text)}>
                  {CHECK_POSITIONS.map((p) => (
                    <option key={p} value={p}>
                      {t(`designer.faults.at.${p}`)}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <ConditionEditor condition={check.condition} text={check.text} metrics={metrics} onChange={(c) => setCheck(check.position, c)} />
            <div className="row">
              {check.position === "during_rep" && <NumberField label={t("designer.faults.holdMs")} def={def} path={["faults", i, "holdMs"]} set={set} step="1" optional />}
              <NumberField label={t("designer.faults.cooldownMs")} def={def} path={["faults", i, "cooldownMs"]} set={set} step="1" />
              <NumberField label={t("designer.faults.minReps")} def={def} path={["faults", i, "minConsecutiveReps"]} set={set} step="1" />
            </div>
            <button onClick={() => set(["faults", i], undefined)}>{t("designer.faults.remove")}</button>
            <Issues issues={issues} prefix={`faults.${i}`} />
          </fieldset>
        );
      })}
      <button onClick={add}>{t("designer.faults.add")}</button>
    </Section>
  );
}
