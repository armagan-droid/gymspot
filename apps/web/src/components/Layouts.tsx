import { useTranslation } from "react-i18next";
import { Link, Outlet } from "react-router";

function Header({ area }: { area: "station" | "member" | "admin" }) {
  const { t } = useTranslation();
  return (
    <header className="app-header">
      <Link to="/">{t("app.name")}</Link>
      <span className="area">{t(`areas.${area}`)}</span>
    </header>
  );
}

/** Station/session screens (A*): disclaimer and "no video stored" are always visible (specs/05, 07). */
/** Legal notes on full-screen camera views, where the page footer is covered (specs/08). */
export function LegalStrip() {
  const { t } = useTranslation();
  return (
    <p className="legal-strip" aria-hidden="true">
      📷 {t("legal.noVideoStored")} · {t("legal.medicalDisclaimer")}
    </p>
  );
}

/** Camera screens: the station tablet, and the member's phone session (`area="member"`). */
export function StationLayout({ area = "station" }: { area?: "station" | "member" }) {
  const { t } = useTranslation();
  return (
    <div className="layout layout-station">
      <Header area={area} />
      <main>
        <Outlet />
      </main>
      <footer className="station-footer">
        <span className="camera-notice" role="note">
          <span aria-hidden="true">📷</span> {t("legal.noVideoStored")}
        </span>
        <span className="disclaimer" role="note">
          {t("legal.medicalDisclaimer")}
        </span>
      </footer>
    </div>
  );
}

export function MemberLayout() {
  return (
    <div className="layout layout-member">
      <Header area="member" />
      <main>
        <Outlet />
      </main>
    </div>
  );
}

export function AdminLayout() {
  return (
    <div className="layout layout-admin">
      <Header area="admin" />
      <main>
        <Outlet />
      </main>
    </div>
  );
}
