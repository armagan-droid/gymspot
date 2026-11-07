import { useTranslation } from "react-i18next";
import { Link, Outlet } from "react-router";

/** GymSpot mark: a spot in a ring (same as public/icon.svg). */
export function BrandMark({ size = 28 }: { size?: number }) {
  return (
    <svg className="brand-mark" width={size} height={size} viewBox="0 0 512 512" aria-hidden="true">
      <rect width="512" height="512" rx="112" fill="#0b0d10" />
      <circle cx="256" cy="256" r="150" fill="none" stroke="#c4f82a" strokeWidth="44" />
      <circle cx="256" cy="256" r="58" fill="#c4f82a" />
    </svg>
  );
}

function Header({ area }: { area: "station" | "member" | "admin" }) {
  const { t } = useTranslation();
  return (
    <header className="app-header">
      <Link to="/" className="brand" aria-label={t("app.name")}>
        <BrandMark />
        <span className="wordmark" aria-hidden="true">
          Gym<span>Spot</span>
        </span>
      </Link>
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
