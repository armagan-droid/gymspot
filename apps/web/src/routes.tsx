import { Suspense, lazy } from "react";
import { useTranslation } from "react-i18next";
import { Link, Route, Routes } from "react-router";
import { AdminLayout, MemberLayout, StationLayout } from "./components/Layouts";
import { SettingsPanel } from "./components/Settings";

// Route skeleton for the three areas in specs/08. Screens are placeholders
// until their roadmap tasks (T2.3+, T4.x). C7 and C9 are outside the MVP (specs/09).

export type ScreenId = `A${1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9}` | `B${1 | 2 | 3 | 4 | 5 | 6}` | `C${1 | 2 | 3 | 4 | 5 | 6 | 8 | 10}`;

export const SCREEN_ROUTES: { path: string; screen: ScreenId }[] = [
  { path: "/station", screen: "A2" },
  { path: "/station/pair", screen: "A1" },
  // A3–A9 are states of one session view driven by the program engine (T2.4, T4.1)
  { path: "/station/session", screen: "A5" },
  { path: "/member", screen: "B2" },
  { path: "/member/login", screen: "B1" },
  { path: "/member/program", screen: "B3" },
  { path: "/member/history", screen: "B4" },
  { path: "/member/progress", screen: "B5" },
  { path: "/member/settings", screen: "B6" },
  { path: "/admin", screen: "C2" },
  { path: "/admin/login", screen: "C1" },
  { path: "/admin/stations", screen: "C3" },
  { path: "/admin/members", screen: "C4" },
  { path: "/admin/templates", screen: "C5" },
  { path: "/admin/members/:memberId", screen: "C6" },
  { path: "/admin/settings", screen: "C8" },
  { path: "/admin/calibration", screen: "C10" },
];

// T2.2 pose spike: development builds only. Lazy so production drops the import entirely.
const SpikePage = import.meta.env.DEV ? lazy(() => import("./spike/SpikePage").then((m) => ({ default: m.SpikePage }))) : null;
const CalibrationSpikePage = import.meta.env.DEV
  ? lazy(() => import("./spike/CalibrationSpikePage").then((m) => ({ default: m.CalibrationSpikePage })))
  : null;
const SessionSpikePage = import.meta.env.DEV
  ? lazy(() => import("./spike/SessionSpikePage").then((m) => ({ default: m.SessionSpikePage })))
  : null;
const SetupSpikePage = import.meta.env.DEV
  ? lazy(() => import("./spike/SetupSpikePage").then((m) => ({ default: m.SetupSpikePage })))
  : null;

const SETTINGS_SCREENS: ReadonlySet<ScreenId> = new Set(["B6", "C8"]);

function Screen({ id }: { id: ScreenId }) {
  const { t } = useTranslation();
  return (
    <section data-screen={id}>
      <h1>{t(`screens.${id}`)}</h1>
      {SETTINGS_SCREENS.has(id) && <SettingsPanel />}
    </section>
  );
}

function Home() {
  const { t } = useTranslation();
  return (
    <main className="home">
      <h1>{t("app.name")}</h1>
      <nav>
        <Link to="/station">{t("areas.station")}</Link>
        <Link to="/member">{t("areas.member")}</Link>
        <Link to="/admin">{t("areas.admin")}</Link>
      </nav>
      <SettingsPanel />
    </main>
  );
}

function NotFound() {
  const { t } = useTranslation();
  return <h1>{t("app.notFound")}</h1>;
}

const layoutFor = { station: <StationLayout />, member: <MemberLayout />, admin: <AdminLayout /> } as const;

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      {CalibrationSpikePage && (
        <Route
          path="/spike/calibration"
          element={
            <Suspense>
              <CalibrationSpikePage />
            </Suspense>
          }
        />
      )}
      {SessionSpikePage && (
        <Route
          path="/spike/session"
          element={
            <Suspense>
              <SessionSpikePage />
            </Suspense>
          }
        />
      )}
      {SetupSpikePage && (
        <Route
          path="/spike/setup"
          element={
            <Suspense>
              <SetupSpikePage />
            </Suspense>
          }
        />
      )}
      {SpikePage && (
        <Route
          path="/spike"
          element={
            <Suspense>
              <SpikePage />
            </Suspense>
          }
        />
      )}
      {(["station", "member", "admin"] as const).map((area) => (
        <Route key={area} element={layoutFor[area]}>
          {SCREEN_ROUTES.filter((r) => r.path.startsWith(`/${area}`)).map((r) => (
            <Route key={r.path} path={r.path} element={<Screen id={r.screen} />} />
          ))}
        </Route>
      ))}
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}
