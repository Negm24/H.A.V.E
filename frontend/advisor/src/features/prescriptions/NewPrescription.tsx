import { useEffect, useState } from "react";
import { ApiError } from "@have/shared/api";
import {
  advisorApi,
  type Medicine,
  type Page,
  type Patient,
  type Prescription,
  type PrescriptionLine,
  type RecordData,
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

import { DosageEditor, dosagePayload, instructionPreview, editDosage, type Dosage } from "./DosageEditor";

const blankPatient = (): Patient => ({
  patient_phone_number: "",
  patient_first_name: "",
  patient_last_name: "",
  patient_date_of_birth: "",
});

type Line = Omit<PrescriptionLine, "dosage"> & {
  dosage?: Dosage;
  name_en: string;
  strength: string;
  pack_description: string;
};
export function NewPrescription({
  replacement,
  dirty,
  view,
}: {
  replacement: Prescription | null;
  dirty: (value: boolean) => void;
  view: (value: Prescription) => void;
}) {
  const { t } = useTranslation("advisor"),
    { authorized } = useAdvisorSession(),
    task = useOperation();
  const [correcting, setCorrecting] = useState(replacement);
  const [patient, setPatient] = useState<Patient>(() =>
    correcting
      ? {
          patient_phone_number: correcting.patient_phone_number,
          patient_first_name: correcting.patient_first_name,
          patient_last_name: correcting.patient_last_name,
          patient_date_of_birth: correcting.patient_date_of_birth,
        }
      : blankPatient(),
  );
  const [confirmed, setConfirmed] = useState(false),
    [query, setQuery] = useState(""),
    [medicines, setMedicines] = useState<Medicine[]>([]),
    [medicineTotal, setMedicineTotal] = useState(0),
    [hasSearched, setHasSearched] = useState(false),
    [medicinePage, setMedicinePage] = useState(1);
  const [lines, setLines] = useState<Line[]>(() =>
    correcting
      ? correcting.lines.map((line) => ({
          ...line,
          dosage: editDosage(line.dosage),
          name_en: line.name_en ?? "",
          strength: line.strength ?? "",
          pack_description: line.pack_description ?? "",
        }))
      : [],
  );
  const [expiry, setExpiry] = useState(
      correcting?.expires_at.slice(0, 10) ?? "",
    ),
    [review, setReview] = useState(false),
    [lookupNotice, setLookupNotice] = useState(""),
    [reason, setReason] = useState("");
  const [submitted, setSubmitted] = useState<RecordData | null>(null),
    [actionId, setActionId] = useState(() => crypto.randomUUID()),
    [issued, setIssued] = useState<Prescription | null>(null);
  const isDirty = !issued && (!!patient.patient_phone_number || !!lines.length);
  useEffect(() => {
    dirty(isDirty);
  }, [isDirty, dirty]);
  useEffect(() => {
    const before = (event: BeforeUnloadEvent) => {
      if (isDirty) event.preventDefault();
    };
    window.addEventListener("beforeunload", before);
    return () => window.removeEventListener("beforeunload", before);
  }, [isDirty]);
  const field = (key: keyof Patient, type = "text") => (
    <Input
      key={key}
      label={key}
      type={type}
      required
      value={String(patient[key] ?? "")}
      disabled={!!submitted || task.busy}
      onChange={(event) => {
        setPatient((before) => ({ ...before, [key]: event.target.value }));
        setConfirmed(false);
        setLookupNotice("");
      }}
      dir={type === "tel" || type === "date" ? "ltr" : "auto"}
      maxLength={key.includes("phone") ? 32 : 32}
    />
  );
  const lookup = () =>
    task.run(
      () =>
        authorized((token) =>
          advisorApi.read<Patient>(token, "patient-lookup/", {
            method: "POST",
            body: { phone_number: patient.patient_phone_number },
          }),
        ),
      (result) => {
        setPatient(
          result.found
            ? result
            : {
                ...blankPatient(),
                patient_phone_number: result.patient_phone_number,
              },
        );
        setConfirmed(false);
        setLookupNotice(result.found ? "" : t("manualPatient"));
      },
    );
  const search = (page = 1) =>
    task.run(
      () =>
        authorized((token) =>
          advisorApi.read<Page<Medicine>>(token, "medicines/search/", {
            method: "POST",
            body: { query, page, page_size: 8 },
          }),
        ),
      (result) => {
        setMedicines(result.items);
        setHasSearched(true);
        setMedicineTotal(result.total);
        setMedicinePage(page);
      },
    );
  const issue = () =>
    task.run(
      async () => {
        const body = submitted ?? {
          patient_phone_number: patient.patient_phone_number,
          patient_first_name: patient.patient_first_name,
          patient_last_name: patient.patient_last_name,
          patient_date_of_birth: patient.patient_date_of_birth,
          action_id: actionId,
          expires_at: cairoDayTimestamp(expiry, true),
          lines: lines.map(
            ({ product_id, instructions, quantity, refills, dosage, dosage_form }) => ({
              product_id,
              instructions,
              ...(dosage ? { dosage: { ...dosagePayload(dosage), ...(dosage.mode === "structured" ? { catalogue_form: dosage_form } : {}) } } : {}),
              quantity,
              refills,
            }),
          ),
          ...(correcting ? { reason } : {}),
        };
        setSubmitted(body);
        try {
          return await authorized((token) =>
            advisorApi.read<Prescription>(
              token,
              correcting
                ? `prescriptions/${correcting.id}/replace/`
                : "prescriptions/issue/",
              { method: "POST", body },
            ),
          );
        } catch (error) {
          if (
            error instanceof ApiError &&
            [400, 409, 422].includes(error.status)
          ) {
            setSubmitted(null);
            setReview(false);
          }
          throw error;
        }
      },
      (result) => {
        setIssued(result);
        setReview(false);
        dirty(false);
      },
    );
  const reset = () => {
    setCorrecting(null);
    setReason("");
    setPatient(blankPatient());
    setLines([]);
    setConfirmed(false);
    setExpiry("");
    setIssued(null);
    setSubmitted(null);
    setActionId(crypto.randomUUID());
    setMedicines([]);
    setHasSearched(false);
    task.setError("");
  };
  const pdf = (record: Prescription) =>
    task.run(() =>
      downloadBlob(
        authorized((token) =>
          advisorApi.pdf(token, `prescriptions/${record.id}/pdf/`),
        ),
        record.reference + ".pdf",
      ),
    );
  if (issued)
    return (
      <section className="advisor-issued">
        <span className="advisor-issued-icon" aria-hidden="true">
          ✓
        </span>
        <h2>{t("issued")}</h2>
        <p className="advisor-reference" dir="ltr">
          {issued.reference}
        </p>
        <p>
          {issued.patient_first_name} {issued.patient_last_name}
        </p>
        <div className="advisor-actions">
          <button
            className="advisor-primary"
            disabled={task.busy}
            onClick={() => void pdf(issued)}
          >
            {t("download")}
          </button>
          <button onClick={() => view(issued)}>{t("view")}</button>
          <button onClick={reset}>{t("another")}</button>
        </div>
        <ErrorNotice message={task.error} />
      </section>
    );
  return (
    <>
      <p className="advisor-subtitle">{t("patientVisit")}</p>
      <ErrorNotice message={task.error} />
      <form
        onSubmit={(event) => {
          event.preventDefault();
          setReview(true);
        }}
      >
        <section className="advisor-panel">
          <header className="advisor-panel-heading">
            <h2>{t("patient")}</h2>
          </header>
          <div className="advisor-patient-lookup">
            {field("patient_phone_number", "tel")}
            <button
              type="button"
              disabled={
                task.busy || !patient.patient_phone_number || !!submitted
              }
              onClick={() => void lookup()}
            >
              {t("lookup")}
            </button>
          </div>
          {lookupNotice && <p role="status">{lookupNotice}</p>}
          <div className="advisor-form-grid">
            {field("patient_first_name")}
            {field("patient_last_name")}
            {field("patient_date_of_birth", "date")}
          </div>
          <label className="advisor-check">
            <input
              type="checkbox"
              checked={confirmed}
              required
              disabled={!!submitted}
              onChange={(event) => setConfirmed(event.target.checked)}
            />
            {t("confirmPatient")}
          </label>
        </section>
        {confirmed && (
          <div className="advisor-patient-strip">
            <strong>
              {patient.patient_first_name} {patient.patient_last_name}
            </strong>
            <span dir="ltr">{patient.patient_phone_number}</span>
            <span>{patient.patient_date_of_birth}</span>
          </div>
        )}
        <section className="advisor-panel">
          <header className="advisor-panel-heading">
            <h2>{t("medicines")}</h2>
          </header>
          <div className="advisor-search">
            <Input
              label="searchMedicines"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              disabled={!!submitted}
            />
            <button
              type="button"
              disabled={task.busy || !!submitted}
              onClick={() => void search()}
            >
              {t("search")}
            </button>
          </div>
          <div className="advisor-medicine-results">
            {medicines.map((medicine) => (
              <article key={medicine.id}>
                <div dir="ltr">
                  <strong>{medicine.name_en}</strong>
                  <small>
                    {medicine.strength} · {medicine.dosage_form} ·{" "}
                    {medicine.pack_description}
                  </small>
                  <span>
                    {t(medicine.requires_prescription ? "rx" : "otc")}
                  </span>
                </div>
                <button
                  type="button"
                  disabled={
                    !!submitted ||
                    lines.some((line) => line.product_id === medicine.id)
                  }
                  onClick={() =>
                    setLines((before) => [
                      ...before,
                      {
                        ...medicine,
                        product_id: medicine.id,
                        instructions: "",
                        dosage: { mode: medicine.dose_unit ? "structured" : "custom", schedule: "", food: "unspecified", times: [""] },
                        quantity: 1,
                        refills: 0,
                      },
                    ])
                  }
                >
                  {t("add")}
                </button>
              </article>
            ))}
          </div>
          {medicineTotal > 8 && (
            <div className="advisor-pagination">
              <button
                type="button"
                disabled={task.busy || medicinePage <= 1}
                onClick={() => void search(medicinePage - 1)}
              >
                {t("previous")}
              </button>
              <span>
                {medicinePage} / {Math.ceil(medicineTotal / 8)}
              </span>
              <button
                type="button"
                disabled={
                  task.busy || medicinePage >= Math.ceil(medicineTotal / 8)
                }
                onClick={() => void search(medicinePage + 1)}
              >
                {t("next")}
              </button>
            </div>
          )}
          {hasSearched && !medicines.length && (
            <p className="advisor-empty" role="status">
              {t("noMedicines")}
            </p>
          )}
          {!lines.length && (!hasSearched || medicines.length > 0) && (
            <p className="advisor-empty">{t("selectMedicine")}</p>
          )}
          {lines.map((line, index) => (
            <article
              className="advisor-prescription-line"
              key={line.product_id}
            >
              <header>
                <div dir="ltr">
                  <h3>{line.name_en}</h3>
                  <small>
                    {line.strength} · {line.pack_description}
                  </small>
                </div>
                <button
                  type="button"
                  disabled={!!submitted}
                  onClick={() =>
                    setLines((before) =>
                      before.filter((_, position) => position !== index),
                    )
                  }
                >
                  {t("remove")}
                </button>
              </header>
              <DosageEditor value={line.dosage ?? { mode: 'custom' }} unit={line.dose_unit} custom={instructionPreview(line.dosage, line.instructions, line.dose_unit, t)} disabled={!!submitted}
                change={dosage => setLines(before => before.map((item,position) => position===index ? {...item,dosage} : item))}
                customChange={instructions => setLines(before => before.map((item,position) => position===index ? {...item,instructions} : item))}/>
              <div className="advisor-form-grid">
                {(["quantity", "refills"] as const).map((key) => (
                  <Input
                    key={key}
                    label={key}
                    required
                    type="number"
                    min={key === "quantity" ? 1 : 0}
                    max={key === "quantity" ? 10000 : 100}
                    disabled={!!submitted}
                    value={line[key]}
                    onChange={(event) =>
                      setLines((before) =>
                        before.map((item, position) =>
                          position === index
                            ? { ...item, [key]: Number(event.target.value) }
                            : item,
                        ),
                      )
                    }
                  />
                ))}
              </div>
            </article>
          ))}
        </section>
        <section className="advisor-panel advisor-issue-footer">
          <Input
            label="expiry"
            type="date"
            required
            min={new Date().toISOString().slice(0, 10)}
            disabled={!!submitted}
            value={expiry}
            onChange={(event) => setExpiry(event.target.value)}
          />
          {correcting && (
            <Input
              label="replacementReason"
              required
              maxLength={1000}
              value={reason}
              disabled={!!submitted}
              onChange={(event) => setReason(event.target.value)}
            />
          )}
          <button
            className="advisor-primary"
            disabled={!lines.length || !confirmed || task.busy}
          >
            {t("review")}
          </button>
        </section>
      </form>
      {review && (
        <Dialog
          title={t("review")}
          close={() => {
            if (!task.busy) setReview(false);
          }}
        >
          <div className="advisor-review-patient">
            <h3>
              {patient.patient_first_name} {patient.patient_last_name}
            </h3>
            <p dir="ltr">{patient.patient_phone_number}</p>
            <p>{patient.patient_date_of_birth}</p>
          </div>
          {lines.map((line) => (
            <article className="advisor-review-line" key={line.product_id}>
              <strong dir="ltr">
                {line.name_en} · {line.strength}
              </strong>
              <p className="advisor-preserve-text" dir="auto">
                {instructionPreview(line.dosage, line.instructions, line.dose_unit, t)}
              </p>
              <small>
                {t("quantity")} {line.quantity} · {t("refills")} {line.refills}
              </small>
            </article>
          ))}
          <p>
            {t("expiry")} {expiry}
          </p>
          <ErrorNotice message={task.error} />
          {submitted && <p className="advisor-notice">{t("unsure")}</p>}
          <div className="advisor-actions">
            <button disabled={task.busy} onClick={() => setReview(false)}>
              {t("back")}
            </button>
            <button
              className="advisor-primary"
              disabled={task.busy}
              onClick={() => void issue()}
            >
              {t(task.busy ? "working" : "issue")}
            </button>
          </div>
        </Dialog>
      )}
    </>
  );
}
