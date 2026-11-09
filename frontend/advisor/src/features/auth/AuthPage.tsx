import { useState } from "react";
import { advisorApi, type RecordData } from "@have/shared/api/advisor";
import { useTranslation } from "@have/shared/i18n";
import { useAdvisorSession } from "../../app/session";
import { ErrorNotice, Input, useOperation } from "../../components/ui";
import { RegistrationWizard } from "./RegistrationWizard";

export function AuthPage() {
  const { t } = useTranslation("advisor"),
    { session } = useAdvisorSession(),
    task = useOperation();
  const [mode, setMode] = useState("login"),
    [data, setData] = useState<RecordData>({}),
    [step, setStep] = useState<RecordData | null>(null),
    [code, setCode] = useState(""),
    [notice, setNotice] = useState("");
  const changeMode = (value: string) => {
    setMode(value);
    setData({});
    setStep(null);
    setCode("");
    task.setError("");
    setNotice("");
  };
  const field = (key: string, type = "text") => (
    <Input
      key={key}
      label={key}
      type={type}
      required
      disabled={task.busy}
      value={String(data[key] ?? "")}
      onChange={(event) =>
        setData((before) => ({ ...before, [key]: event.target.value }))
      }
      dir={
        [
          "phone_number",
          "email",
          "password",
          "new_password",
          "confirm_password",
        ].includes(key)
          ? "ltr"
          : "auto"
      }
      maxLength={
        key.includes("password") ? 128 : key === "clinic_address" ? 1000 : 200
      }
      autoComplete={
        key === "password"
          ? mode === "login"
            ? "current-password"
            : "new-password"
          : key === "phone_number"
            ? "tel"
            : "off"
      }
    />
  );
  async function submit() {
    if (step?.status === "WAITING_FOR_APPROVAL" || step?.status === "REJECTED")
      return;
    if (mode === "login") {
      if (step?.mfa_token) {
        await session.login({ mfa_token: String(step.mfa_token), code });
        return;
      }
      const result = await advisorApi.login(data);
      setStep(result);
      setData({});
      setCode("");
      return;
    }
    if (!step) {
      setStep(await advisorApi.requestReset(String(data.phone_number)));
      return;
    }
    if (!step.reset_token) {
      setStep(
        await advisorApi.verifyReset({
          phone_number: data.phone_number,
          challenge_id: step.challenge_id,
          code,
        }),
      );
      setCode("");
      return;
    }
    await advisorApi.completeReset({
      reset_token: step.reset_token,
      new_password: data.new_password,
      confirm_password: data.confirm_password,
    });
    changeMode("login");
    setNotice(t("resetDone"));
  }
  const status = step?.status;
  const blocked = status === "WAITING_FOR_APPROVAL" || status === "REJECTED";
  if (mode === "signup") return <RegistrationWizard back={(submitted) => { changeMode("login"); if (submitted) setNotice(t("submitted")); }} />;
  return (
    <main className="advisor-auth">
      <div className="advisor-auth-brand">
        <span className="advisor-brand-mark">H⁺</span>
        <h1>
          H.A.V.E <span>{t("advisor")}</span>
        </h1>
        <p>{t("patientVisit")}</p>
      </div>
      <section className="advisor-auth-card">
        <h2>
          {t(
            mode === "login"
              ? step?.mfa_token
                ? "mfa"
                : "signIn"
              : "recover",
          )}
        </h2>
        {notice && (
          <p className="advisor-success" role="status">
            {notice}
          </p>
        )}
        <ErrorNotice message={task.error} />
        {blocked ? (
          <div className="advisor-status-card">
            <h3>
              {t(status === "WAITING_FOR_APPROVAL" ? "waiting" : "rejected")}
            </h3>
            <p>{String(step?.detail ?? "")}</p>
            {!!step?.rejection_reason && <p>{String(step.rejection_reason)}</p>}
            {step?.can_reapply === true && (
              <button
                className="advisor-primary"
                onClick={() => changeMode("signup")}
              >
                {t("signup")}
              </button>
            )}
            <button onClick={() => changeMode("login")}>{t("back")}</button>
          </div>
        ) : (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void task.run(submit);
            }}
          >
            {step?.secret ? (
              <div className="advisor-enrollment">
                <p>{t("enroll")}</p>
                <code dir="ltr">{String(step.secret)}</code>
              </div>
            ) : null}
            {!step && (
              <>
                {field("phone_number", "tel")}
                {mode !== "reset" && field("password", "password")}
                {mode === "login" && (
                  <label className="advisor-check">
                    <input
                      type="checkbox"
                      checked={data.remember_me === true}
                      onChange={(event) =>
                        setData((before) => ({
                          ...before,
                          remember_me: event.target.checked,
                        }))
                      }
                    />
                    {t("remember")}
                  </label>
                )}
              </>
            )}
            {step && !step.reset_token && (
              <>
                {!step.mfa_token && (
                  <p>{t(step.next_step === "email" ? "emailCode" : "sms")}</p>
                )}
                <Input
                  label="code"
                  value={code}
                  onChange={(event) =>
                    setCode(event.target.value.replace(/\D/g, ""))
                  }
                  required
                  inputMode="numeric"
                  pattern="[0-9]{6}"
                  maxLength={6}
                  autoComplete="one-time-code"
                  dir="ltr"
                />
              </>
            )}
            {!!step?.reset_token && (
              <>
                {field("new_password", "password")}
                {field("confirm_password", "password")}
              </>
            )}
            <button className="advisor-primary" disabled={task.busy}>
              {t(
                task.busy
                  ? "working"
                  : step
                    ? "verify"
                    : mode === "login"
                      ? "signIn"
                      : "continue",
              )}
            </button>
          </form>
        )}
        <div className="advisor-auth-links">
          {mode === "login" && (
            <>
              <button disabled={task.busy} onClick={() => changeMode("signup")}>
                {t("signup")}
              </button>
              <button disabled={task.busy} onClick={() => changeMode("reset")}>
                {t("recover")}
              </button>
            </>
          )}
          {mode !== "login" && (
            <button disabled={task.busy} onClick={() => changeMode("login")}>
              {t("back")}
            </button>
          )}
        </div>
      </section>
    </main>
  );
}
