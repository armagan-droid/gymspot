import {
  ExerciseEngine,
  type FaultSuggestion,
  type LoadedRulePack,
  type RepSuggestion,
  type PersonTrack,
  type Side,
  chooseNearSide,
  createMetricComputer,
  createMetricSmoother,
  detectView,
  dominantView,
  measureDemonstration,
  selectPerson,
  suggestFault,
  suggestRep,
} from "@gymspot/engine";
import type { Frame } from "@gymspot/shared";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { paintOverlay } from "../pose/overlay";
import { useServices } from "../services";

// C11 live trial (specs/11): the draft pack runs on the camera exactly as in a
// session. Frames live in memory only; nothing is stored or sent (invariant 1).

/** Frames used to pick the view and the near side before the engine starts. */
const WARMUP_FRAMES = 10;
const CHART_WINDOW_MS = 6000;
/** A demonstration keeps at most this many frames (about a minute), in memory only. */
const MAX_DEMO_FRAMES = 1800;

export interface TrialCounts {
  valid: number;
  faulty: number;
  incomplete: number;
}

export interface LiveTrialProps {
  loaded: LoadedRulePack;
  /** An attempt was completed with this pack (specs/11: publishing needs a trial). */
  onAttempt(): void;
  /** Use a suggested repetition measure and zones (specs/11 "Gösterimle öneri"). */
  onApplyRep(s: RepSuggestion): void;
  /** Add a suggested fault condition. */
  onAddFault(f: FaultSuggestion): void;
}

type Demo = "good" | "bad";

export function LiveTrial({ loaded, onAttempt, onApplyRep, onAddFault }: LiveTrialProps) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language === "en" ? "en" : "tr";
  const services = useServices();
  const videoRef = useRef<HTMLVideoElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const chartRef = useRef<HTMLCanvasElement>(null);
  const [running, setRunning] = useState(false);
  const [counts, setCounts] = useState<TrialCounts>({ valid: 0, faulty: 0, incomplete: 0 });
  const [last, setLast] = useState<string | null>(null);
  const [cue, setCue] = useState<string | null>(null);
  const [value, setValue] = useState<number | null>(null);
  const [chartMetric, setChartMetric] = useState(loaded.pack.rep.metric);
  const metricNames = Object.keys(loaded.pack.metrics);
  const [recording, setRecording] = useState<Demo | null>(null);
  const [demoFrames, setDemoFrames] = useState(0);
  const demos = useRef<Record<Demo, Frame[]>>({ good: [], bad: [] });
  const [repSuggestion, setRepSuggestion] = useState<RepSuggestion | null | undefined>(undefined);
  const [faultSuggestion, setFaultSuggestion] = useState<FaultSuggestion | null | undefined>(undefined);

  // latest props for the frame callback without restarting the camera
  const live = useRef({ loaded, onAttempt, chartMetric, recording });
  live.current = { loaded, onAttempt, chartMetric, recording };
  const engineState = useRef<{
    engine: ExerciseEngine | null;
    pack: LoadedRulePack | null;
    warmup: Frame[];
    nearSide: Side;
    view: "front" | "side";
    series: { t: number; v: number }[];
  }>({ engine: null, pack: null, warmup: [], nearSide: "left", view: "front", series: [] });

  const reset = () => {
    Object.assign(engineState.current, { engine: null, pack: null, warmup: [], series: [] });
    setCounts({ valid: 0, faulty: 0, incomplete: 0 });
    setLast(null);
    setCue(null);
  };
  // a changed draft starts over with the new rules
  useEffect(reset, [loaded]);
  useEffect(() => {
    if (!metricNames.includes(chartMetric)) setChartMetric(loaded.pack.rep.metric);
  }, [loaded]);

  useEffect(() => {
    if (!running) return;
    let cancelled = false;
    let track: PersonTrack | undefined;
    let stream: MediaStream | undefined;
    const source = services.createPoseSource();
    const metrics = { computer: createMetricComputer(live.current.loaded.pack.metrics), pack: live.current.loaded };
    let smooth = createMetricSmoother(Object.keys(metrics.pack.pack.metrics), metrics.pack.pack.smoothing);

    const onFrameSelected = (frame: Frame) => {
      const s = engineState.current;
      const pack = live.current.loaded;
      if (metrics.pack !== pack) {
        metrics.computer = createMetricComputer(pack.pack.metrics);
        metrics.pack = pack;
        smooth = createMetricSmoother(Object.keys(pack.pack.metrics), pack.pack.smoothing);
      }
      // demonstrations keep every frame, also while the engine warms up after a rule change
      const rec = live.current.recording;
      if (rec && demos.current[rec].length < MAX_DEMO_FRAMES) {
        demos.current[rec].push(frame);
        setDemoFrames(demos.current[rec].length);
      }
      if (!s.engine) {
        s.warmup.push(frame);
        if (s.warmup.length < WARMUP_FRAMES) return;
        const views = pack.pack.camera.views;
        const detected = dominantView(s.warmup.map((f) => detectView(f)));
        const view = views.length === 1 || detected === "ambiguous" ? views[0]! : detected;
        s.nearSide = chooseNearSide(s.warmup);
        s.view = view;
        s.engine = new ExerciseEngine(pack, { view, nearSide: s.nearSide }, { safetyPause: false });
        s.pack = pack;
        s.warmup = [];
      }
      for (const e of s.engine.push(frame)) {
        if (e.type === "REP_COMPLETED") {
          setCounts((c) => ({ ...c, [e.outcome]: c[e.outcome] + 1 }));
          const names = e.faults.map((id) => pack.pack.faults.find((f) => f.id === id)?.name[lang] ?? id);
          setLast(`${t(`designer.trial.outcome.${e.outcome}`)}${names.length ? ` — ${names.join(", ")}` : ""}`);
          live.current.onAttempt();
        }
        if (e.type === "FAULT_DETECTED") setCue(pack.pack.faults.find((f) => f.id === e.faultId)?.cue[lang] ?? e.faultId);
      }
      const values = smooth(metrics.computer.compute(frame, s.nearSide), frame.t);
      const v = values[live.current.chartMetric];
      if (v !== undefined && Number.isFinite(v)) {
        s.series.push({ t: frame.t, v });
        while (s.series.length && s.series[0]!.t < frame.t - CHART_WINDOW_MS) s.series.shift();
        setValue(v);
      }
      if (videoRef.current && overlayRef.current) paintOverlay(overlayRef.current, videoRef.current, frame, { minVisibility: pack.pack.camera.minVisibility });
      if (chartRef.current) paintChart(chartRef.current, s.series, live.current.chartMetric === pack.pack.rep.metric ? pack.pack.rep : undefined);
    };

    void (async () => {
      const cam = await services.requestCamera();
      if (cancelled || !cam.ok) return;
      stream = cam.stream;
      if (videoRef.current) {
        videoRef.current.srcObject = cam.stream;
        await videoRef.current.play?.()?.catch?.(() => undefined);
      }
      await source.start(videoRef.current, (candidates) => {
        const sel = selectPerson(candidates, track);
        track = sel.track;
        if (sel.frame && !cancelled) onFrameSelected(sel.frame);
      });
    })();
    return () => {
      cancelled = true;
      source.stop();
      stream?.getTracks?.().forEach((tr) => tr.stop());
    };
  }, [running, services]);

  const rep = loaded.pack.rep;
  return (
    <section className="live-trial" aria-label={t("designer.trial.title")}>
      <h2>{t("designer.trial.title")}</h2>
      <p className="hint">{t("designer.trial.hint")}</p>
      {!running ? (
        <button onClick={() => setRunning(true)}>{t("designer.trial.start")}</button>
      ) : (
        <>
          <div className="camera-stage">
            <video ref={videoRef} muted playsInline autoPlay className="camera-preview" />
            <canvas ref={overlayRef} className="pose-overlay" aria-hidden="true" />
          </div>
          <p className="rep-counter" aria-label={t("designer.trial.counted")}>
            {counts.valid}
          </p>
          <p role="status">{t("designer.trial.counts", { ...counts })}</p>
          {last && <p>{t("designer.trial.last", { text: last })}</p>}
          <p className="cue-band">{cue ?? " "}</p>
          <label>
            {t("designer.trial.chart")}
            <select value={chartMetric} onChange={(e) => setChartMetric(e.target.value)}>
              {metricNames.map((m) => (
                <option key={m}>{m}</option>
              ))}
            </select>
          </label>
          <p aria-label={t("designer.trial.value")}>
            {chartMetric}: {value === null ? "—" : value.toFixed(3)}
            {chartMetric === rep.metric && ` · ${t("designer.trial.thresholds", { start: rep.start.enter, target: rep.target.enter })}`}
          </p>
          <canvas ref={chartRef} className="metric-chart" width={600} height={160} />
          <div className="controls">
            <button onClick={reset}>{t("designer.trial.reset")}</button>
            <button onClick={() => setRunning(false)}>{t("designer.trial.stop")}</button>
          </div>
          <Demonstrations
            recording={recording}
            frames={demoFrames}
            hasGood={repSuggestion != null}
            rep={repSuggestion}
            fault={faultSuggestion}
            onStart={(d) => {
              demos.current[d] = [];
              setDemoFrames(0);
              setRecording(d);
              if (d === "good") setFaultSuggestion(undefined);
            }}
            onStop={() => {
              const d = recording!;
              setRecording(null);
              const s = engineState.current;
              const measure = (frames: Frame[]) => measureDemonstration(frames, loaded.pack, s.view, s.nearSide);
              if (d === "good") {
                setRepSuggestion(suggestRep(measure(demos.current.good)));
              } else if (repSuggestion) {
                setFaultSuggestion(suggestFault(measure(demos.current.good), measure(demos.current.bad), repSuggestion));
              }
            }}
            onApplyRep={() => repSuggestion && onApplyRep(repSuggestion)}
            onAddFault={() => faultSuggestion && onAddFault(faultSuggestion)}
          />
        </>
      )}
    </section>
  );
}

interface DemonstrationsProps {
  recording: Demo | null;
  frames: number;
  hasGood: boolean;
  /** undefined: not recorded yet; null: nothing found. */
  rep: RepSuggestion | null | undefined;
  fault: FaultSuggestion | null | undefined;
  onStart(d: Demo): void;
  onStop(): void;
  onApplyRep(): void;
  onAddFault(): void;
}

/** Record a correct and a faulty demonstration and turn them into rules (specs/11). */
function Demonstrations({ recording, frames, hasGood, rep, fault, onStart, onStop, onApplyRep, onAddFault }: DemonstrationsProps) {
  const { t } = useTranslation();
  return (
    <div className="demonstrations" aria-label={t("designer.demo.title")}>
      <h3>{t("designer.demo.title")}</h3>
      <p className="hint">{t("designer.demo.hint")}</p>
      {recording ? (
        <>
          <p role="status" className="recording-indicator">
            {t(`designer.demo.recording.${recording}`, { count: frames })}
          </p>
          <button onClick={onStop}>{t("designer.demo.stop")}</button>
        </>
      ) : (
        <div className="controls">
          <button onClick={() => onStart("good")}>{t("designer.demo.startGood")}</button>
          <button onClick={() => onStart("bad")} disabled={!hasGood}>
            {t("designer.demo.startBad")}
          </button>
        </div>
      )}
      {rep === null && <p role="alert">{t("designer.demo.noRep")}</p>}
      {rep && (
        <div className="suggestion">
          <p>
            {t("designer.demo.rep", {
              metric: rep.metric,
              cycles: rep.cycles,
              start: rep.rep.start.enter,
              target: rep.rep.target.enter,
            })}
          </p>
          <button onClick={onApplyRep}>{t("designer.demo.applyRep")}</button>
        </div>
      )}
      {fault === null && <p role="alert">{t("designer.demo.noFault")}</p>}
      {fault && (
        <div className="suggestion">
          <p>{t("designer.demo.fault", { metric: fault.metric, op: fault.op, threshold: fault.threshold })}</p>
          <button onClick={onAddFault}>{t("designer.demo.addFault")}</button>
        </div>
      )}
    </div>
  );
}

/** Last seconds of one measure, with the rep zones as lines when it is the rep measure. */
function paintChart(canvas: HTMLCanvasElement, series: readonly { t: number; v: number }[], rep?: LoadedRulePack["pack"]["rep"]): void {
  const ctx = canvas.getContext("2d");
  if (!ctx || series.length < 2) return;
  const w = canvas.width;
  const h = canvas.height;
  const lines = rep ? [rep.start.enter, rep.start.exit, rep.target.enter, rep.target.exit] : [];
  const vs = [...series.map((p) => p.v), ...lines];
  let lo = Math.min(...vs);
  let hi = Math.max(...vs);
  if (hi - lo < 1e-6) {
    hi += 0.5;
    lo -= 0.5;
  }
  const pad = (hi - lo) * 0.1;
  lo -= pad;
  hi += pad;
  const t1 = series.at(-1)!.t;
  const x = (t: number) => w - ((t1 - t) / CHART_WINDOW_MS) * w;
  const y = (v: number) => h - ((v - lo) / (hi - lo)) * h;
  ctx.clearRect(0, 0, w, h);
  if (rep) {
    ctx.lineWidth = 1;
    for (const [v, color] of [
      [rep.start.enter, "#facc15"],
      [rep.target.enter, "#4ade80"],
    ] as const) {
      ctx.strokeStyle = color;
      ctx.setLineDash([6, 4]);
      ctx.beginPath();
      ctx.moveTo(0, y(v));
      ctx.lineTo(w, y(v));
      ctx.stroke();
    }
    ctx.setLineDash([]);
  }
  ctx.strokeStyle = "#60a5fa";
  ctx.lineWidth = 2;
  ctx.beginPath();
  series.forEach((p, i) => (i === 0 ? ctx.moveTo(x(p.t), y(p.v)) : ctx.lineTo(x(p.t), y(p.v))));
  ctx.stroke();
}
