import { useEffect, useState } from "react";
import { advisorApi, type Doctor } from "@have/shared/api/advisor";
import { useTranslation } from "@have/shared/i18n";
import { useAdvisorSession } from "../../app/session";
import { ErrorNotice, useOperation } from "../../components/ui";
import "./profile.css";

const editable = ["specialty", "specialty_ar", "clinic_name", "clinic_name_ar", "clinic_address", "clinic_address_ar"] as const;

export function DoctorProfile({ saved }: { saved: () => void }) {
  const { t } = useTranslation("advisor");
  const { customer, authorized, session } = useAdvisorSession();
  const [doctor, setDoctor] = useState<Doctor | null>(customer);
  const [values, setValues] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState("");
  const [phone, setPhone] = useState("");
  const [challenge, setChallenge] = useState("");
  const [code, setCode] = useState("");
  const [resendSeconds, setResendSeconds] = useState(0);
  const task = useOperation();
  function adopt(value: Doctor) {
    setDoctor(value);
    setValues(Object.fromEntries(editable.map(key => [key, String(value[key] ?? "")])));
  }
  useEffect(() => { void task.run(() => authorized(advisorApi.readProfile, true), adopt); }, []);
  useEffect(() => {
    if (!resendSeconds) return;
    const timer = window.setTimeout(() => setResendSeconds(value => Math.max(0, value - 1)), 1000);
    return () => window.clearTimeout(timer);
  }, [resendSeconds]);
  return <details className="advisor-profile advisor-panel">
    <summary><span className="advisor-profile-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><circle cx="12" cy="7" r="3.5"/><path d="M4 21v-3a8 8 0 0 1 16 0v3M8 16v4m8-4v4M8 18h8"/></svg></span><span><strong>{t("profile.title")}</strong><small>{t("profile.subtitle")}</small></span></summary>
    <div className="advisor-profile-body">
      <ErrorNotice message={task.error}/>
      {notice && <p className="advisor-success" role="status">{notice}</p>}
      {doctor && <>
        <div className="advisor-profile-identity"><div><small>{t("profile.registeredName")}</small><strong dir="ltr">{doctor.first_name} {doctor.last_name}</strong><span dir="rtl">{doctor.name_ar}</span></div><div><small>{t("profile.education")}</small><strong>{doctor.medical_school || "—"}</strong></div><div><small>{t("email")}</small><span dir="ltr">{doctor.email}</span></div></div>
        <p className="advisor-profile-hint">{t("profile.locked")}</p>
        <form onSubmit={event => { event.preventDefault(); setNotice(""); void task.run(() => authorized(token => advisorApi.updateProfile(token, values)), result => { adopt(result); session.setCustomer(result); setNotice(t("saved")); saved(); }); }}>
          <h3>{t("profile.clinicTitle")}</h3>
          <div className="advisor-form-grid">{editable.map(key => <label className="advisor-field" key={key}><span>{t(`profile.${key}`)}</span>{key.startsWith("clinic_address") ? <textarea dir={key.endsWith("_ar") ? "rtl" : "ltr"} required maxLength={1000} value={values[key] ?? ""} onChange={event => setValues(before => ({...before, [key]: event.target.value}))}/> : <input dir={key.endsWith("_ar") ? "rtl" : "ltr"} required={!key.startsWith("specialty")} maxLength={key.startsWith("specialty") ? 100 : 200} value={values[key] ?? ""} onChange={event => setValues(before => ({...before, [key]: event.target.value}))}/>}</label>)}</div>
          <p className="advisor-profile-hint">{t("profile.futurePrescriptions")}</p>
          <button className="advisor-primary" disabled={task.busy}>{t(task.busy ? "working" : "save")}</button>
        </form>
        <section className="advisor-profile-phone">
          <h3>{t("profile.phoneTitle")}</h3><p><span dir="ltr">{doctor.phone_number}</span></p><p className="advisor-profile-hint">{t("profile.phoneHelp")}</p>
          <form onSubmit={event => { event.preventDefault(); setNotice(""); void task.run(() => authorized(token => advisorApi.requestPhoneChange(token, phone)), result => { setChallenge(result.challenge_id); setCode(""); setResendSeconds(result.resend_after); setNotice(t("profile.codeSent")); }); }}>
            <div className="advisor-profile-phone-row"><label className="advisor-field"><span>{t("profile.newPhone")}</span><input type="tel" dir="ltr" autoComplete="tel" required value={phone} onChange={event => { setPhone(event.target.value); setChallenge(""); setCode(""); }}/></label><button disabled={task.busy || resendSeconds > 0}>{t(challenge ? "profile.resend" : "profile.sendCode")}{resendSeconds > 0 && ` (${resendSeconds})`}</button></div>
          </form>
          {challenge && <form className="advisor-profile-verification" onSubmit={event => { event.preventDefault(); void task.run(() => authorized(token => advisorApi.verifyPhoneChange(token, {phone_number: phone, challenge_id: challenge, code})), () => { setValues({}); setDoctor(null); setPhone(""); setCode(""); session.invalidate(); }); }}>
            <label className="advisor-field"><span>{t("code")}</span><input dir="ltr" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required value={code} onChange={event => setCode(event.target.value.replace(/\D/g, ""))}/></label><button className="advisor-primary" disabled={task.busy}>{t("profile.confirmPhone")}</button><small>{t("profile.signInAgain")}</small>
          </form>}
        </section>
      </>}
    </div>
  </details>;
}
