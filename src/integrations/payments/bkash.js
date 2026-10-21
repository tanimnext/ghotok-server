import { env } from '../../config/env.js';

// bKash Tokenized Checkout (https://developer.bka.sh). Flow:
// grant token → create payment → customer pays on bkashURL → bKash redirects to
// our callback with ?paymentID&status → execute payment → credit connections.

let token = { idToken: null, expiresAt: 0 };

async function post(path, body, headers = {}) {
  const res = await fetch(`${env.BKASH_BASE_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...headers },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30000),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`bKash ${path} failed with ${res.status}: ${JSON.stringify(json)}`);
  return json;
}

async function idToken() {
  if (token.idToken && Date.now() < token.expiresAt) return token.idToken;
  const json = await post(
    '/tokenized/checkout/token/grant',
    { app_key: env.BKASH_APP_KEY, app_secret: env.BKASH_APP_SECRET },
    { username: env.BKASH_USERNAME, password: env.BKASH_PASSWORD },
  );
  if (!json.id_token)
    throw new Error(`bKash token grant failed: ${json.statusMessage ?? JSON.stringify(json)}`);
  token = { idToken: json.id_token, expiresAt: Date.now() + (Number(json.expires_in ?? 3600) - 120) * 1000 };
  return token.idToken;
}

async function authed(path, body) {
  return post(path, body, { Authorization: await idToken(), 'X-APP-Key': env.BKASH_APP_KEY });
}

export const bkash = {
  name: 'bkash',
  get enabled() {
    return (
      env.BKASH_ENABLED &&
      !!(env.BKASH_APP_KEY && env.BKASH_APP_SECRET && env.BKASH_USERNAME && env.BKASH_PASSWORD)
    );
  },

  async startCheckout(payment, { callbackURL }) {
    const json = await authed('/tokenized/checkout/create', {
      mode: '0011',
      payerReference: String(payment.user).slice(-12),
      callbackURL,
      amount: payment.amount.toFixed(2),
      currency: 'BDT',
      intent: 'sale',
      merchantInvoiceNumber: payment.invoiceNo,
    });
    if (json.statusCode !== '0000' || !json.bkashURL)
      throw new Error(`bKash create failed: ${json.statusMessage ?? JSON.stringify(json)}`);
    return { paymentId: json.paymentID, redirectURL: json.bkashURL, raw: json };
  },

  /** Handles the redirect back from bKash. */
  async completeCheckout(query) {
    const paymentId = String(query.paymentID ?? '');
    if (!paymentId) return { paymentId, success: false, raw: query };
    if (query.status !== 'success')
      return { paymentId, success: false, cancelled: query.status === 'cancel', raw: query };
    let json = await authed('/tokenized/checkout/execute', { paymentID: paymentId }).catch((err) => ({
      error: err.message,
    }));
    // If execute timed out or was already called, the status query is authoritative.
    if (json.transactionStatus !== 'Completed') {
      json = await authed('/tokenized/checkout/payment/status', { paymentID: paymentId }).catch((err) => ({
        error: err.message,
      }));
    }
    return {
      paymentId,
      success: json.transactionStatus === 'Completed',
      trxId: json.trxID,
      amount: json.amount ? Number(json.amount) : undefined,
      raw: json,
    };
  },
};
