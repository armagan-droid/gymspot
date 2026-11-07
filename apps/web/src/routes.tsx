import { type ReactNode, Suspense, lazy } from "react";
import { useTranslation } from "react-i18next";
import { Link, Route, Routes } from "react-router";
import { AdminLayout, MemberLayout, StationLayout } from "./components/Layouts";
import { SettingsPanel } from "./components/Settings";


// Route skeleton for the three areas in specs/08. Screens are placeholders
// until their roadmap tasks (T2.3+, T4.x). C7 and C9 are outside the MVP (specs/09).


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

// Camera/engine screens are split out of the main bundle (specs/02 first-load budget).
const StationApp = lazy(() => import("./station/StationApp").then((m) => ({ default: m.StationApp })));
const PhoneSessionPage = lazy(() => import("./phone/PhoneSessionPage").then((m) => ({ default: m.PhoneSessionPage })));
const suspended = (el: ReactNode) => <Suspense>{el}</Suspense>;

const adminPages = () => import("./admin/pages");
const AdminLogin = lazy(() => adminPages().then((m) => ({ default: m.AdminLogin })));
const RequireStaff = lazy(() => adminPages().then((m) => ({ default: m.RequireStaff })));
const AdminOverview = lazy(() => adminPages().then((m) => ({ default: m.AdminOverview })));
const AdminStations = lazy(() => adminPages().then((m) => ({ default: m.AdminStations })));
const AdminMembers = lazy(() => adminPages().then((m) => ({ default: m.AdminMembers })));
const AdminMemberDetail = lazy(() => adminPages().then((m) => ({ default: m.AdminMemberDetail })));
const AdminTemplates = lazy(() => adminPages().then((m) => ({ default: m.AdminTemplates })));
const AdminTemplateEdit = lazy(() => adminPages().then((m) => ({ default: m.AdminTemplateEdit })));
const AdminSettings = lazy(() => adminPages().then((m) => ({ default: m.AdminSettings })));
const AdminCalibration = lazy(() => adminPages().then((m) => ({ default: m.AdminCalibration })));

const MemberLogin = lazy(() => import("./member/login").then((m) => ({ default: m.MemberLogin })));
const member = (name: "RequireMember" | "MemberHome" | "MemberProgramPage" | "MemberHistory" | "MemberSessionDetail" | "MemberProgress" | "MemberSettings") =>
  lazy(() => import("./member/pages").then((m) => ({ default: m[name] })));
const RequireMember = member("RequireMember");
const MemberHome = member("MemberHome");
const MemberProgramPage = member("MemberProgramPage");
const MemberHistory = member("MemberHistory");
const MemberSessionDetail = member("MemberSessionDetail");
const MemberProgress = member("MemberProgress");
const MemberSettings = member("MemberSettings");

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

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      {/* A1–A9: the station tablet is one state-driven app (T4.1) */}
      <Route element={<StationLayout />}>
        <Route path="/station" element={suspended(<StationApp />)} />
        <Route path="/station/pair" element={suspended(<StationApp />)} />
      </Route>
      <Route element={<StationLayout area="member" />}>
        <Route path="/member/session" element={suspended(<PhoneSessionPage />)} />
      </Route>
      {/* B1–B6 member area (T4.2) */}
      <Route element={<MemberLayout />}>
        <Route path="/member/login" element={suspended(<MemberLogin />)} />
        <Route element={suspended(<RequireMember />)}>
          <Route path="/member" element={suspended(<MemberHome />)} />
          <Route path="/member/program" element={suspended(<MemberProgramPage />)} />
          <Route path="/member/history" element={suspended(<MemberHistory />)} />
          <Route path="/member/history/:sessionId" element={suspended(<MemberSessionDetail />)} />
          <Route path="/member/progress" element={suspended(<MemberProgress />)} />
          <Route path="/member/settings" element={suspended(<MemberSettings />)} />
        </Route>
      </Route>
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
      {/* C1–C10 admin panel (T4.3); C7/C9 are outside the MVP (specs/09) */}
      <Route element={<AdminLayout />}>
        <Route path="/admin/login" element={suspended(<AdminLogin />)} />
        <Route element={suspended(<RequireStaff roles={["owner", "manager"]} />)}>
          <Route path="/admin" element={suspended(<AdminOverview />)} />
          <Route path="/admin/stations" element={suspended(<AdminStations />)} />
        </Route>
        <Route element={suspended(<RequireStaff />)}>
          <Route path="/admin/members" element={suspended(<AdminMembers />)} />
          <Route path="/admin/members/:memberId" element={suspended(<AdminMemberDetail />)} />
          <Route path="/admin/templates" element={suspended(<AdminTemplates />)} />
          <Route path="/admin/templates/:templateId" element={suspended(<AdminTemplateEdit />)} />
          {/* any staff: the page itself refuses trainers (specs/07) */}
          <Route path="/admin/calibration" element={suspended(<AdminCalibration />)} />
        </Route>
        <Route element={suspended(<RequireStaff roles={["owner"]} />)}>
          <Route path="/admin/settings" element={suspended(<AdminSettings />)} />
        </Route>
      </Route>
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}
