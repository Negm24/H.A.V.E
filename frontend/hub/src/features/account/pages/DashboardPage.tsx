import { Link } from "react-router-dom";
import { useTranslation } from "@have/shared/i18n";
import { useSession } from "../../../app/providers";
import { useCollectionSummary } from "../../orders/hooks/use-collection-summary";
import "../styles/order-attention.css";

export function DashboardPage() {
  const { t } = useTranslation("hub"),
    { t: purchase } = useTranslation("hubPurchase"),
    { customer } = useSession();
  const { summary, unavailable } = useCollectionSummary(),
    count = summary?.awaiting_collection_count ?? 0;
  const unpaid = summary?.awaiting_payment_count ?? 0;
  return (
    <div className="hub-dashboard">
      <div className="hub-page-heading">
        <span className="hub-eyebrow">H.A.V.E HUB</span>
        <h1>
          {t("greeting")} <bdi>{customer?.first_name}</bdi>
        </h1>
        <p>{t("dashboardDescription")}</p>
      </div>
      <div className="hub-dashboard-grid">
        <Link
          className={`hub-service hub-service--active ${count > 0 ? "hub-service--collection" : ""}${unpaid > 0 ? " hub-service--payment" : ""}`}
          to="/profile"
          aria-describedby={unpaid > 0 ? "hub-profile-payment-description" : undefined}
        >
          <span className="hub-service-icon" aria-hidden="true">
            <span className="hub-profile-symbol">◎</span>
            {unpaid > 0 && (
              <span className="hub-profile-payment-icon">⚠</span>
            )}
          </span>
          <h2>{t("myProfile")}</h2>
          <p>{t("profileDescription")}</p>
          {count > 0 && (
            <span className="hub-collection-cue">
              <span className="hub-order-count">{count}</span>
              <span>{purchase("collectionCue", { count })}</span>
            </span>
          )}
          {unavailable && (
            <span className="hub-summary-unavailable">
              {purchase("collectionUnknown")}
            </span>
          )}
          {unpaid > 0 && (
            <span className="hub-payment-warning">
              <span aria-hidden="true">⚠</span>
              <span id="hub-profile-payment-description">{purchase("paymentCue", { count: unpaid })}</span>
            </span>
          )}
          <span className="hub-service-arrow" aria-hidden="true">
            →
          </span>
        </Link>
        <button className="hub-service" disabled>
          <span className="hub-service-icon" aria-hidden="true">
            ▤
          </span>
          <h2>{t("prescriptions")}</h2>
          <span className="hub-pill">{t("comingLater")}</span>
        </button>
        <Link className="hub-service hub-service--active" to="/browse">
          <span className="hub-service-icon" aria-hidden="true">
            ✚
          </span>
          <h2>{t("medicines")}</h2>
          <span className="hub-service-arrow" aria-hidden="true">
            →
          </span>
        </Link>
        <button className="hub-service" disabled>
          <span className="hub-service-icon" aria-hidden="true">
            ◇
          </span>
          <h2>{t("insurance")}</h2>
          <span className="hub-pill">{t("comingLater")}</span>
        </button>
      </div>
      <Link className="hub-qr-action" to="/terminal-login">
        <span aria-hidden="true">▦</span>
        <div>
          <strong>{t("terminalLogin")}</strong>
          <p>{t("terminalLoginDescription")}</p>
        </div>
        <span aria-hidden="true">→</span>
      </Link>
    </div>
  );
}
