import platformLogo from "../../assets/autopharm-logo.png";
import { useEffect, useRef, useState } from "react";
import { DoctorProfile } from "./DoctorProfile";
import {
  advisorApi,
  type Letterhead as LetterheadData,
} from "@have/shared/api/advisor";
import { useTranslation } from "@have/shared/i18n";
import { useAdvisorSession } from "../../app/session";
import {
  ErrorNotice,
  Input,
  downloadBlob,
  useOperation,
} from "../../components/ui";

export function Letterhead() {
  const { t } = useTranslation("advisor"),
    { authorized } = useAdvisorSession(),
    task = useOperation();
  const [logoUrl, setLogoUrl] = useState("");
  const [data, setData] = useState<LetterheadData | null>(null),
    [alignment, setAlignment] = useState("center"),
    [contact, setContact] = useState(""),
    [notice, setNotice] = useState(""),
    file = useRef<HTMLInputElement>(null);
  const adopt = (value: LetterheadData) => {
    setData(value);
    setAlignment(value.alignment);
    setContact(value.contact_line);
  };
  useEffect(() => {
    void task.run(
      () =>
        authorized(
          (token) => advisorApi.read<LetterheadData>(token, "letterhead/"),
          true,
        ),
      adopt,
    );
  }, []);
  useEffect(() => {
    let active = true;
    let url = '';
    setLogoUrl('');
    if (data?.has_logo) void authorized(token => advisorApi.logo(token), true).then(blob => {
      if (!active) return;
      url = URL.createObjectURL(blob);
      setLogoUrl(url);
    }).catch(() => { if (active) task.setError(t('logoLoadError')); });
    return () => { active = false; if (url) URL.revokeObjectURL(url); };
  }, [data?.revision, data?.has_logo]);
  return (
    <>
      <p className="advisor-subtitle">{t("letterheadDescription")}</p>
      <DoctorProfile saved={() => { void task.run(() => authorized(token => advisorApi.read<LetterheadData>(token, "letterhead/"), true), adopt); }} />
      <ErrorNotice message={task.error} />
      {notice && (
        <p className="advisor-success" role="status">
          {notice}
        </p>
      )}
      {!data && task.busy && <p role="status">{t("loading")}</p>}
      {data && (
        <div className="advisor-letterhead-grid">
          <section className="advisor-panel">
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void task.run(
                  () =>
                    authorized((token) =>
                      advisorApi.read<LetterheadData>(token, "letterhead/", {
                        method: "PATCH",
                        body: {
                          revision: data.revision,
                          alignment,
                          contact_line: contact,
                        },
                      }),
                    ),
                  (result) => {
                    adopt(result);
                    setNotice(t("saved"));
                  },
                );
              }}
            >
              <h2>{data.clinic_name}</h2>
              <p>{data.clinic_address}</p>
              <Input
                label="contact_line"
                maxLength={250}
                value={contact}
                onChange={(event) => setContact(event.target.value)}
              />
              <p className="advisor-profile-hint">{t("profile.headerHelp")}</p>
              <div className="advisor-actions">
                <button className="advisor-primary" disabled={task.busy}>
                  {t("save")}
                </button>
                <button
                  type="button"
                  disabled={task.busy}
                  onClick={() =>
                    void task.run(() =>
                      downloadBlob(
                        authorized((token) =>
                          advisorApi.pdf(token, "letterhead/preview/", {
                            alignment,
                            contact_line: contact,
                          }),
                        ),
                        "clinic-letterhead-preview.pdf",
                      ),
                    )
                  }
                >
                  {t("preview")}
                </button>
              </div>
            </form>
            <div className="advisor-logo-upload">
              <h3>{t("logo")}</h3>
              {data.has_logo && (
                <p className="advisor-success">{t("logoPresent")}</p>
              )}
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  const selected = file.current?.files?.[0];
                  if (!selected) return;
                  const body = new FormData();
                  body.append("revision", String(data.revision));
                  body.append("file", selected);
                  void task.run(
                    () =>
                      authorized((token) =>
                        advisorApi.read<LetterheadData>(
                          token,
                          "letterhead/logo/",
                          { method: "POST", body },
                        ),
                      ),
                    (result) => {
                      adopt(result);
                      if (file.current) file.current.value = "";
                      setNotice(t("saved"));
                    },
                  );
                }}
              >
                <label className="advisor-field">
                  <span>{t("logoTypes")}</span>
                  <input
                    ref={file}
                    type="file"
                    accept="image/png,image/jpeg"
                    required
                  />
                </label>
                <button disabled={task.busy}>{t("uploadLogo")}</button>
              </form>
            </div>
          </section>
          <aside className="advisor-letterhead-sample" aria-hidden="true">
            <div className="advisor-platform-brand"><img src={platformLogo} alt="" /></div>
            <div
              className="advisor-letterhead-sample-header"
            >
              <div className="advisor-preview-details" dir="ltr">{data.doctor_details_en}</div>
              <div className="advisor-preview-center">{logoUrl && <img className="advisor-clinic-logo" src={logoUrl} alt="" />}<strong dir="ltr">Dr. {data.doctor_name}</strong>{data.doctor_name_ar && <strong dir="rtl">د. {data.doctor_name_ar}</strong>}<p dir="ltr">{data.clinic_name}</p>{data.clinic_name_ar && <p dir="rtl">{data.clinic_name_ar}</p>}<small>{contact}</small></div>
              <div className="advisor-preview-details" dir="rtl">{data.doctor_details_ar}</div>
            </div>

            <div className="advisor-paper-lines">
              <i />
              <i />
              <i />
              <i />
            </div>
            <footer>توقيع الطبيب · Doctor signature</footer>
          </aside>
        </div>
      )}
    </>
  );
}
