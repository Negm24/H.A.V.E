"""Hosted Kashier sandbox adapter. Never receives PAN, CVV or live-mode input."""
from decimal import Decimal, InvalidOperation
import hashlib
import hmac
import json
import re
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode, urlparse, parse_qs
from urllib.request import Request, build_opener, HTTPRedirectHandler

from django.conf import settings
from apps.accounts.security.errors import AuthError

API = "https://test-api.kashier.io"
FEP = "https://test-fep.kashier.io"


class _NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        # Do not forward merchant headers to a provider-supplied redirect host.
        return None


urlopen = build_opener(_NoRedirect()).open


class ProviderUnavailable(AuthError):
    def __init__(self, *, definitive=False):
        self.definitive = definitive
        super().__init__("Kashier test payments are unavailable. Check the order before trying again.", 503)


def configuration():
    values = (settings.KASHIER_DEFAULT_TEST_KEY, settings.KASHIER_SECRET_KEY,
              settings.KASHIER_MERCHANT_ID, settings.PAYMENTS_PUBLIC_BASE_URL)
    url = urlparse(values[3])
    if not all(values) or url.scheme != "https" or not url.hostname or url.username or url.query or url.fragment:
        raise AuthError("Test checkout is not configured. Set the Kashier keys, merchant ID and public HTTPS base URL.", 503)
    return values


def _call(host, path, *, method="GET", body=None, headers=None, allow_no_cards=False):
    if host not in (API, FEP) or not path.startswith("/v3/") or "\n" in path or "\r" in path:
        raise ProviderUnavailable()
    key, secret, _, _ = configuration()
    request = Request(host + path, method=method, data=json.dumps(body).encode() if body is not None else None,
                      headers={"Authorization": secret, "api-key": key, "Content-Type": "application/json",
                               "Accept": "application/json", **(headers or {})})
    try:
        with urlopen(request, timeout=15) as response:
            # Never log provider bodies: they may contain tokens or merchant configuration.
            data = response.read(1_000_001)
            if len(data) > 1_000_000:
                raise ProviderUnavailable()
            result = json.loads(data)
            if not isinstance(result, dict):
                raise ProviderUnavailable()
            return result
    except HTTPError as exc:
        try:
            error = json.loads(exc.read(16384))
        except (ValueError, OSError):
            error = {}
        if allow_no_cards and exc.code == 400:
            if "there are no cards with this token" in json.dumps(error).lower():
                return {"status": "SUCCESS", "response": {"paymentMethods": []}}
        # Only a field-validation rejection proves creation never started.
        # Duplicate-reference 400s, unrecognized errors, 5xx and timeouts do not.
        message = error.get("message", "") if isinstance(error, dict) else ""
        validation_rejected = (exc.code == 400 and method == "POST" and path == "/v3/payment/sessions"
            and isinstance(message, str) and re.fullmatch(
                r'"[A-Za-z][A-Za-z0-9_.]*" (?:must be [^\r\n]+|is required|is not allowed)', message) is not None)
        # Duplicate-order/5xx/timeout outcomes must be reconciled, not resubmitted.
        raise ProviderUnavailable(definitive=validation_rejected or exc.code in (401, 403) and method != "PUT") from None
    except (URLError, TimeoutError, OSError, ValueError):
        raise ProviderUnavailable() from None


def customer_reference(customer):
    return f"HAVE:{customer.pk}"


def saved_cards(customer):
    key, _, merchant, _ = configuration()
    reference = customer_reference(customer)
    signature = hmac.new(key.encode(), f"/?tokenization={merchant}.{reference}".encode(), hashlib.sha256).hexdigest()
    data = _call(FEP, "/v3/cards/customer?" + urlencode({"customerReference": reference, "merchantId": merchant}),
                 headers={"Kashier-Hash": signature}, allow_no_cards=True)
    if data.get("status") != "SUCCESS" or not isinstance(data.get("response", {}).get("paymentMethods"), list):
        raise ProviderUnavailable()
    cards = []
    for item in data["response"]["paymentMethods"]:
        if item.get("type") != "CARD" or item.get("customer", {}).get("reference") != reference:
            continue
        card = item.get("card", {})
        digits = re.sub(r"\D", "", card.get("number", ""))
        if not card.get("cardToken") or len(digits) < 4:
            continue
        expiry = card.get("expiry", {})
        cards.append({"brand": card.get("brand", "Card"), "last_four": digits[-4:],
                      "expiry_month": str(expiry.get("month", "")), "expiry_year": str(expiry.get("year", ""))})
    return cards


def valid_checkout_url(value):
    url = urlparse(value)
    return (url.scheme == "https" and url.netloc == "payments.kashier.io" and url.path.startswith("/session/")
            and parse_qs(url.query).get("mode") == ["test"] and not url.fragment)


def create_session(order, return_url):
    _, _, merchant, public = configuration()
    body = {"expireAt": order.expires_at.isoformat(), "maxFailureAttempts": 3,
            "amount": format(order.customer_payable_amount, ".2f"), "currency": "EGP",
            # The sandbox host selects the environment. Despite its published
            # body table, Kashier rejects a request-body `mode` field (HTTP 400).
            "order": order.order_number, "merchantId": merchant,
            "merchantRedirect": return_url, "serverWebhook": public + "/api/v1/payments/kashier/webhook/",
            "type": "one-time", "display": order.language, "manualCapture": False,
            "allowedMethods": "card", "defaultMethod": "card", "brandColor": "#5d5294",
            "interactionSource": "ECOMMERCE", "enable3DS": True, "failureRedirect": True,
            "customer": {"email": order.email_receipt_to}}
    if order.customer_id:
        body["customer"]["reference"] = customer_reference(order.customer)
        body.update(saveCard="optional", retrieveSavedCard=True)
    else:
        body["retrieveSavedCard"] = False
    data = _call(API, "/v3/payment/sessions", method="POST", body=body)
    if not isinstance(data.get("_id"), str) or not valid_checkout_url(data.get("sessionUrl", "")):
        raise ProviderUnavailable()
    return data["_id"], data["sessionUrl"]


def recover_session(order):
    """Recover a lost creation response by exact reference, never another POST.

    The provider does not document its listing envelope/filters. The bounded,
    observed pagination contract is validated; incomplete/ambiguous reads fail
    closed. An empty result never proves an uncertain payment was unpaid.
    """
    _, _, merchant, _ = configuration()
    matches = []
    page, pages, total, seen = 1, 1, None, set()
    while page <= pages:
        result = _call(API, "/v3/payment/sessions?" + urlencode({
            "search": order.order_number, "page": page, "limit": 100}))
        rows, pagination = result.get("data"), result.get("pagination")
        if not isinstance(rows, list) or not isinstance(pagination, dict):
            raise ProviderUnavailable()
        count, last = pagination.get("total"), pagination.get("pages")
        if (type(count) is not int or count < 0 or type(last) is not int or not 0 <= last <= 10
                or pagination.get("page") != page or (total is not None and (count != total or max(1, last) != pages))):
            raise ProviderUnavailable()
        total, pages = count, max(1, last)
        for row in rows:
            if not isinstance(row, dict) or not isinstance(row.get("_id"), str) or row["_id"] in seen:
                raise ProviderUnavailable()
            seen.add(row["_id"])
            params = row.get("paymentParams")
            if isinstance(params, dict) and params.get("order") == order.order_number:
                matches.append(row["_id"])
        page += 1
    if len(seen) != total or len(matches) > 1:
        raise ProviderUnavailable()
    if not matches:
        return None
    session_id = matches[0]
    if not re.fullmatch(r"[A-Za-z0-9_-]{1,100}", session_id):
        raise ProviderUnavailable()
    document = _call(API, f"/v3/payment/sessions/{session_id}")
    document = document.get("data", document)
    if not isinstance(document, dict) or not isinstance(document.get("paymentParams"), dict):
        raise ProviderUnavailable()
    params = document["paymentParams"]
    try:
        matched = (document.get("_id") == session_id and document.get("merchantId") == merchant
            and document.get("mode", "test") == "test" and params.get("order") == order.order_number
            and params.get("currency") == "EGP" and Decimal(str(params.get("amount"))) == order.customer_payable_amount)
    except (InvalidOperation, TypeError):
        matched = False
    if not matched:
        raise ProviderUnavailable()
    return session_id, f"https://payments.kashier.io/session/{session_id}?mode=test"


def verify_order(order, session_id):
    """Read only stored references; 200 alone, redirect and unsigned event are not proof."""
    _, _, merchant, _ = configuration()
    if not session_id:
        recovered = recover_session(order)
        if recovered is None:
            return {"state": "UNKNOWN"}
        session_id, checkout_url = recovered
        result = verify_order(order, session_id)
        return result | {"session_id": session_id, "checkout_url": checkout_url}
    data = _call(API, f"/v3/payment/sessions/{session_id}/payment").get("data", {})
    try:
        matches = (data.get("sessionId") == session_id and data.get("merchantId") == merchant
                   and data.get("merchantOrderId") == order.order_number and data.get("currency") == "EGP"
                   and Decimal(str(data.get("amount"))) == order.customer_payable_amount)
    except (InvalidOperation, TypeError):
        matches = False
    if not matches or data.get("mode", "test") != "test":
        raise ProviderUnavailable()
    result = _call(API, "/v3/payment/orders?" + urlencode({"search": order.order_number}))
    rows = [r for r in result.get("data", []) if r.get("merchantOrderId") == order.order_number]
    if not rows and data.get("status") in ("EXPIRED", "ABANDONED"):
        return {"state": "FAILED"}
    if len(rows) != 1:
        return {"state": "UNKNOWN"}
    row = rows[0]
    if row.get("orderId") != data.get("orderId"):
        raise ProviderUnavailable()
    if row.get("status") == "CAPTURED":
        return {"state": "PAID", "provider_reference": row["orderId"], "transactions": row.get("transactions", [])}
    if data.get("status") in ("EXPIRED", "ABANDONED"):
        return {"state": "FAILED"}
    # A declined attempt is not the end of a hosted session. Kashier permits
    # several attempts; only a definitively closed session can release stock.
    if data.get("status") in ("FAILED", "CANCELLED", "REJECTED") and row.get("status") in ("FAILED", "CANCELLED", "EXPIRED", "REJECTED"):
        return {"state": "FAILED"}
    return {"state": "UNKNOWN"}


def abandon_session(session_id):
    if not re.fullmatch(r"[A-Za-z0-9_-]{1,100}", session_id):
        raise ProviderUnavailable()
    # The current hosted checkout signs cancellation with the session hash and
    # order payload. An empty PATCH from the published docs returns HTTP 404.
    # Fetch that private capability server-side; never expose it to our clients.
    _, _, merchant, _ = configuration()
    response = _call(API, f"/v3/payment/sessions/{session_id}")
    session = response.get("data", response)
    if not isinstance(session, dict) or not isinstance(session.get("paymentParams"), dict):
        raise ProviderUnavailable()
    params = session["paymentParams"]
    if (session.get("_id") != session_id or session.get("merchantId") != merchant
            or not isinstance(params.get("hash"), str) or not params["hash"]
            or not all(key in params for key in ("currency", "amount", "order"))):
        raise ProviderUnavailable()
    body = {"merchantId": merchant, "customer": params.get("customer") or {},
            "order": {"currency": params["currency"], "amount": params["amount"],
                      "reference": params["order"], "originalAmount": params.get("originalAmount", params["amount"])}}
    return _call(API, f"/v3/payment/sessions/{session_id}", method="PATCH", body=body,
                 headers={"Kashier-Hash": params["hash"]})


def refund(provider_order_id, amount):
    if not re.fullmatch(r"[A-Za-z0-9_-]{1,120}", provider_order_id):
        raise ProviderUnavailable()
    return _call(API, f"/v3/payment/refund/{provider_order_id}", method="PUT",
                 body={"apiOperation": "REFUND", "reason": "HAVE test order cancelled or collection expired",
                       "transaction": {"amount": format(amount, ".2f")}})


def refund_state(order, provider_order_id, expected_reference, amount):
    data = _call(API, "/v3/payment/orders?" + urlencode({"search": order.order_number}))
    rows = [r for r in data.get("data", []) if r.get("merchantOrderId") == order.order_number
            and r.get("orderId") == provider_order_id]
    if len(rows) != 1:
        return "UNKNOWN"
    refunds = [t for t in rows[0].get("transactions", []) if str(t.get("operation", "")).upper() == "REFUND"]
    if expected_reference:
        refunds = [t for t in refunds if t.get("transactionId") == expected_reference]
    if len(refunds) != 1:
        return "UNKNOWN"
    try:
        if Decimal(str(refunds[0].get("amount"))) != amount:
            return "UNKNOWN"
    except InvalidOperation:
        return "UNKNOWN"
    return {"SUCCESS": "SUCCEEDED", "FAILURE": "FAILED"}.get(refunds[0].get("status"), "UNKNOWN")
