import { useEffect, useState } from "react";
import {
  advisorApi,
  type Page,
  type Prescription,
} from "@have/shared/api/advisor";
import { useTranslation } from "@have/shared/i18n";
import { useAdvisorSession } from "../../app/session";
import { cairoDayTimestamp } from "../../app/dates";
import {
  Dialog,
  ErrorNotice,
  Input,
  downloadBlob,
  useOperation,
} from "../../components/ui";

export function PrescriptionDetails({
  record,
  replace,
  close,
  changed,
}: {
  record: Prescription;
  replace: (record: Prescription) => void;
  close: () => void;
  changed: () => void;
}) {
  const { t, i18n } = useTranslation("advisor"),
    { authorized } = useAdvisorSession(),
    task = useOperation();
  const [current, setCurrent] = useState(record),
    [revoking, setRevoking] = useState(false),
    [reason, setReason] = useState(""),
    [actionId] = useState(() => crypto.randomUUID());
  return (
    <Dialog title={current.reference} close={close}>
      <div className="advisor-detail-heading">
        <span
          className={`advisor-badge advisor-badge--${current.status.toLowerCase()}`}
        >
          {t(current.status)}
        </span>
        <p>{t("issuedReadOnly")}</p>
      </div>
      <h3>
        {current.patient_first_name} {current.patient_last_name}
      </h3>
      <p dir="ltr">{current.patient_phone_number}</p>
      <p>
        {t("issuedAt")}{" "}
        {new Date(current.issued_at).toLocaleString(i18n.language, {
          timeZone: "Africa/Cairo",
        })}
      </p>
      <p>
        {t("expiryLabel")}{" "}
        {new Date(current.expires_at).toLocaleDateString(i18n.language, {
          timeZone: "Africa/Cairo",
        })}
      </p>
      {current.lines.map((line, index) => (
        <article className="advisor-review-line" key={index}>
          <strong dir="ltr">
            {line.name_en} · {line.strength}
          </strong>
          <p className="advisor-preserve-text" dir="auto">
            {i18n.language === 'ar' ? line.instructions_ar ?? line.instructions : line.instructions}
          </p>
          <small>
            {t("quantity")} {line.quantity} · {t("refills")} {line.refills}
          </small>
        </article>
      ))}
      {current.revocation_reason && (
        <p className="advisor-notice">
          {t("reason")} {current.revocation_reason}
        </p>
      )}
      <ErrorNotice message={task.error} />
      <div className="advisor-actions">
        <button
          className="advisor-primary"
          disabled={task.busy}
          onClick={() =>
            void task.run(() =>
              downloadBlob(
                authorized((token) =>
                  advisorApi.pdf(token, `prescriptions/${current.id}/pdf/`),
                ),
                current.reference + ".pdf",
              ),
            )
          }
        >
          {t("download")}
        </button>
        {current.status === "ACTIVE" && (
          <>
            <button disabled={task.busy} onClick={() => replace(current)}>
              {t("replace")}
            </button>
            <button
              className="advisor-danger"
              disabled={task.busy}
              onClick={() => setRevoking(true)}
            >
              {t("revoke")}
            </button>
          </>
        )}
      </div>
      {revoking && (
        <form
          className="advisor-revoke-form"
          onSubmit={(event) => {
            event.preventDefault();
            void task.run(
              () =>
                authorized((token) =>
                  advisorApi.read<Prescription>(
                    token,
                    `prescriptions/${current.id}/revoke/`,
                    { method: "POST", body: { reason, action_id: actionId } },
                  ),
                ),
              (result) => {
                setCurrent(result);
                setRevoking(false);
                changed();
              },
            );
          }}
        >
          <Input
            label="reason"
            required
            maxLength={1000}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
          <button className="advisor-danger" disabled={task.busy}>
            {t("revoke")}
          </button>
        </form>
      )}
    </Dialog>
  );
}

export function History({
  selected,
  select,
  replace,
}: {
  selected: Prescription | null;
  select: (record: Prescription | null) => void;
  replace: (record: Prescription) => void;
}) {
  const { t, i18n } = useTranslation("advisor"),
    { authorized } = useAdvisorSession(),
    task = useOperation();
  const [query, setQuery] = useState(""),
    [status, setStatus] = useState(""),
    [start, setStart] = useState(""),
    [end, setEnd] = useState(""),
    [data, setData] = useState<Page<Prescription> | null>(null);
  const search = (page = 1) =>
    task.run(
      () =>
        authorized((token) =>
          advisorApi.read<Page<Prescription>>(token, "prescriptions/search/", {
            method: "POST",
            body: {
              query,
              status,
              ...(start ? { start: cairoDayTimestamp(start) } : {}),
              ...(end ? { end: cairoDayTimestamp(end, true) } : {}),
              page,
              page_size: 15,
            },
          }),
        ),
      setData,
    );
  useEffect(() => {
    void search();
  }, []);
  return (
    <>
      <section className="advisor-panel">
        <form
          className="advisor-history-filters"
          onSubmit={(event) => {
            event.preventDefault();
            void search();
          }}
        >
          <Input
            label="searchRecords"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <label className="advisor-field">
            <span>{t("status")}</span>
            <select
              value={status}
              onChange={(event) => setStatus(event.target.value)}
            >
              <option value="">{t("all")}</option>
              {["ACTIVE", "EXPIRED", "REVOKED"].map((value) => (
                <option key={value} value={value}>
                  {t(value)}
                </option>
              ))}
            </select>
          </label>
          <Input
            label="start"
            type="date"
            value={start}
            onChange={(event) => setStart(event.target.value)}
          />
          <Input
            label="end"
            type="date"
            value={end}
            min={start || undefined}
            onChange={(event) => setEnd(event.target.value)}
          />
          <button className="advisor-primary" disabled={task.busy}>
            {t("search")}
          </button>
        </form>
        <ErrorNotice message={task.error} />
        {task.busy && <p role="status">{t("loading")}</p>}
        {data && !data.items.length && !task.busy && (
          <p className="advisor-empty">{t("noPrescriptions")}</p>
        )}
        <div className="advisor-history-list">
          {data?.items.map((record) => (
            <button
              key={record.id}
              className="advisor-history-row"
              onClick={() =>
                void task.run(
                  () =>
                    authorized(
                      (token) =>
                        advisorApi.read<Prescription>(
                          token,
                          `prescriptions/${record.id}/`,
                        ),
                      true,
                    ),
                  select,
                )
              }
            >
              <span>
                <strong>
                  {record.patient_first_name} {record.patient_last_name}
                </strong>
                <small dir="ltr">{record.reference}</small>
              </span>
              <span
                className={`advisor-badge advisor-badge--${record.status.toLowerCase()}`}
              >
                {t(record.status)}
              </span>
              <time>
                {new Date(record.issued_at).toLocaleDateString(i18n.language, {
                  timeZone: "Africa/Cairo",
                })}
              </time>
              <span aria-hidden="true">↗</span>
            </button>
          ))}
        </div>
        {data && data.total > data.page_size && (
          <div className="advisor-pagination">
            <button
              disabled={task.busy || data.page <= 1}
              onClick={() => void search(data.page - 1)}
            >
              {t("previous")}
            </button>
            <span>
              {data.page} / {Math.ceil(data.total / data.page_size)}
            </span>
            <button
              disabled={
                task.busy || data.page >= Math.ceil(data.total / data.page_size)
              }
              onClick={() => void search(data.page + 1)}
            >
              {t("next")}
            </button>
          </div>
        )}
      </section>
      {selected && (
        <PrescriptionDetails
          key={selected.id}
          record={selected}
          close={() => select(null)}
          replace={replace}
          changed={() => void search(data?.page ?? 1)}
        />
      )}
    </>
  );
}
