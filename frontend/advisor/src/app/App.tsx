import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "@have/shared/i18n";
import { useScreenReady } from "@have/shared/telemetry/react";
import type { Prescription } from "@have/shared/api/advisor";
import { AdvisorSessionProvider, useAdvisorSession } from "./session";
import { AuthPage } from "../features/auth/AuthPage";
import { NewPrescription } from "../features/prescriptions/NewPrescription";
import { History } from "../features/prescriptions/History";
import { Letterhead } from "../features/letterhead/Letterhead";
import "./advisor.css";

function AdvisorApp() {
  const { t, i18n } = useTranslation("advisor"),
    { status, customer: doctor, session } = useAdvisorSession();
  const [tab, setTab] = useState("newPrescription"),
    [dirty, setDirty] = useState(false),
    [replacement, setReplacement] = useState<Prescription | null>(null),
    [selected, setSelected] = useState<Prescription | null>(null),
    [editorKey, setEditorKey] = useState(0);
  const markDirty = useCallback((value: boolean) => setDirty(value), []);
  useEffect(() => {
    if (status !== 'authenticated') {
      setDirty(false);
      setSelected(null);
      setReplacement(null);
      setTab('newPrescription');
      setEditorKey(value => value + 1);
    }
  }, [status]);
  useScreenReady(status !== "loading");
  const navigate = (next: string) => {
    if (next === tab) return;
    if (dirty && !window.confirm(t("discard"))) return;
    setDirty(false);
    setSelected(null);
    setReplacement(null);
    setTab(next);
    setEditorKey((value) => value + 1);
  };
  const language = (
    <button
      className="advisor-language"
      lang={i18n.language === "ar" ? "en" : "ar"}
      onClick={() =>
        void i18n.changeLanguage(i18n.language === "ar" ? "en" : "ar")
      }
    >
      {i18n.language === "ar" ? "English" : "العربية"}
    </button>
  );
  if (status === "loading")
    return (
      <div className="advisor-loading" role="status">
        {t("loading")}
      </div>
    );
  if (status !== "authenticated")
    return (
      <div key="anonymous">
        <div className="advisor-auth-language">{language}</div>
        <AuthPage />
      </div>
    );
  return (
    <div className="advisor-shell" key="authenticated">
      <a className="advisor-skip" href="#advisor-content">
        {t("continue")}
      </a>
      <aside className="advisor-sidebar">
        <div className="advisor-brand">
          <span className="advisor-brand-mark">H⁺</span>
          <div>
            <strong>H.A.V.E</strong>
            <small>{t("advisor")}</small>
          </div>
        </div>
        <nav aria-label={t("workspace")}>
          {["newPrescription", "history", "letterhead"].map((value, index) => (
            <button
              key={value}
              aria-current={tab === value ? "page" : undefined}
              onClick={() => navigate(value)}
            >
              <span aria-hidden="true">{["＋", "▤", "▧"][index]}</span>
              {t(value)}
            </button>
          ))}
        </nav>
        <div className="advisor-clinic">
          <span>{doctor?.clinic_name}</span>
          <small>{doctor?.specialty}</small>
        </div>
      </aside>
      <div className="advisor-main">
        <header className="advisor-topbar">
          <span>{t("workspace")}</span>
          <div>
            {language}
            <span className="advisor-doctor-name">
              {doctor?.first_name} {doctor?.last_name}
            </span>
            <button
              onClick={() => {
                if (!dirty || window.confirm(t("discard"))) {
                  setDirty(false);
                  setSelected(null);
                  setReplacement(null);
                  void session.logout().catch(() => {});
                }
              }}
            >
              {t("signOut")}
            </button>
          </div>
        </header>
        <main id="advisor-content" className="advisor-content">
          <div className="advisor-page-heading">
            <h1>{t(tab)}</h1>
          </div>
          {tab === "newPrescription" && (
            <NewPrescription
              key={editorKey}
              replacement={replacement}
              dirty={markDirty}
              view={(record) => {
                setSelected(record);
                setTab("history");
              }}
            />
          )}
          {tab === "history" && (
            <History
              selected={selected}
              select={setSelected}
              replace={(record) => {
                setReplacement(record);
                setSelected(null);
                setEditorKey((value) => value + 1);
                setTab("newPrescription");
              }}
            />
          )}
          {tab === "letterhead" && <Letterhead />}
        </main>
        <footer className="advisor-footer">
          H.A.V.E · Health Access & Vending Everywhere
        </footer>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <AdvisorSessionProvider>
      <AdvisorApp />
    </AdvisorSessionProvider>
  );
}
