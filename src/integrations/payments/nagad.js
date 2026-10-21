import crypto from 'node:crypto';
import { env } from '../../config/env.js';

// Nagad Payment Gateway (merchant checkout API v-0.2.0). Request payloads are
// encrypted with Nagad's public key and signed with the merchant's private key;
// responses are encrypted with the merchant's public key.

const pem = (raw, label) => {
  const s = String(raw ?? '')
    .trim()
    .replace(/\\n/g, '\n');
  if (s.includes('BEGIN')) return s;
  const body =
    s
      .replace(/\s+/g, '')
      .match(/.{1,64}/g)
      ?.join('\n') ?? '';
  return `-----BEGIN ${label}-----\n${body}\n-----END ${label}-----`;
};

const nagadPublicKey = () => pem(env.NAGAD_PUBLIC_KEY, 'PUBLIC KEY');
const merchantPrivateKey = () => pem(env.NAGAD_MERCHANT_PRIVATE_KEY, 'PRIVATE KEY');

function encrypt(data) {
  return crypto
    .publicEncrypt({ key: nagadPublicKey(), padding: crypto.constants.RSA_PKCS1_PADDING }, Buffer.from(data))
    .toString('base64');
}

function sign(data) {
  return crypto.createSign('SHA256').update(data).sign(merchantPrivateKey(), 'base64');
}

// Node.js refuses RSA_PKCS1_PADDING in privateDecrypt (CVE-2023-46809), so we
// decrypt without padding and remove the PKCS#1 v1.5 type-2 padding ourselves.
function decrypt(b64) {
  const raw = crypto.privateDecrypt(
    { key: merchantPrivateKey(), padding: crypto.constants.RSA_NO_PADDING },
    Buffer.from(b64, 'base64'),
  );
  if (raw[0] !== 0x00 || raw[1] !== 0x02) throw new Error('Nagad: unexpected padding');
  const sep = raw.indexOf(0x00, 2);
  if (sep < 10) throw new Error('Nagad: unexpected padding');
  return raw.subarray(sep + 1).toString('utf8');
}

function dhakaTimestamp() {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Dhaka',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    })
      .formatToParts(new Date())
      .map((p) => [p.type, p.value]),
  );
  return `${parts.year}${parts.month}${parts.day}${parts.hour === '24' ? '00' : parts.hour}${parts.minute}${parts.second}`;
}

async function request(path, { method = 'POST', body, ip } = {}) {
  const res = await fetch(`${env.NAGAD_BASE_URL}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'X-KM-Api-Version': 'v-0.2.0',
      'X-KM-IP-V4': ip ?? '127.0.0.1',
      'X-KM-Client-Type': 'PC_WEB',
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(30000),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Nagad ${path} failed with ${res.status}: ${JSON.stringify(json)}`);
  return json;
}

const orderIdOf = (payment) => payment.invoiceNo.replace(/[^A-Za-z0-9]/g, '').slice(0, 20);

export const nagad = {
  name: 'nagad',
  get enabled() {
    return (
      env.NAGAD_ENABLED &&
      !!(
        env.NAGAD_MERCHANT_ID &&
        env.NAGAD_MERCHANT_NUMBER &&
        env.NAGAD_PUBLIC_KEY &&
        env.NAGAD_MERCHANT_PRIVATE_KEY
      )
    );
  },

  async startCheckout(payment, { callbackURL, ip }) {
    const merchantId = env.NAGAD_MERCHANT_ID;
    const orderId = orderIdOf(payment);
    const dateTime = dhakaTimestamp();
    const init = {
      merchantId,
      datetime: dateTime,
      orderId,
      challenge: crypto.randomBytes(20).toString('hex'),
    };
    const initRes = await request(`/api/dfs/check-out/initialize/${merchantId}/${orderId}`, {
      ip,
      body: {
        accountNumber: env.NAGAD_MERCHANT_NUMBER,
        dateTime,
        sensitiveData: encrypt(JSON.stringify(init)),
        signature: sign(JSON.stringify(init)),
      },
    });
    if (!initRes.sensitiveData) throw new Error(`Nagad initialize failed: ${JSON.stringify(initRes)}`);
    const { paymentReferenceId, challenge } = JSON.parse(decrypt(initRes.sensitiveData));
    const order = { merchantId, orderId, currencyCode: '050', amount: payment.amount.toFixed(2), challenge };
    const completeRes = await request(`/api/dfs/check-out/complete/${paymentReferenceId}`, {
      ip,
      body: {
        sensitiveData: encrypt(JSON.stringify(order)),
        signature: sign(JSON.stringify(order)),
        merchantCallbackURL: callbackURL,
        additionalMerchantInfo: { invoiceNo: payment.invoiceNo },
      },
    });
    if (completeRes.status !== 'Success' || !completeRes.callBackUrl)
      throw new Error(`Nagad complete failed: ${JSON.stringify(completeRes)}`);
    return {
      paymentId: paymentReferenceId,
      redirectURL: completeRes.callBackUrl,
      raw: { initialize: initRes, complete: completeRes },
    };
  },

  /** Handles the redirect back from Nagad (?payment_ref_id&status). The verify API is authoritative. */
  async completeCheckout(query) {
    const paymentId = String(query.payment_ref_id ?? '');
    if (!paymentId) return { paymentId, success: false, raw: query };
    const json = await request(`/api/dfs/verify/payment/${encodeURIComponent(paymentId)}`, {
      method: 'GET',
    }).catch((err) => ({ error: err.message }));
    return {
      paymentId,
      success: json.status === 'Success',
      cancelled: query.status === 'Aborted' || json.status === 'Aborted',
      trxId: json.issuerPaymentRefNo,
      amount: json.amount ? Number(json.amount) : undefined,
      raw: json,
    };
  },
};
