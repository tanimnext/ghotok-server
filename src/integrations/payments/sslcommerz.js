import { env } from '../../config/env.js';

// SSLCommerz hosted checkout (https://developer.sslcommerz.com): cards, mobile
// banking (bKash, Nagad, Rocket and others) and internet banking. Flow:
// create a session → customer pays on GatewayPageURL → SSLCommerz POSTs the
// result to our return URL (and separately to the IPN URL) → we confirm it with
// the validation API before crediting anything.

const form = (data) => new URLSearchParams(Object.entries(data).map(([k, v]) => [k, String(v ?? '')]));

async function validate(valId) {
  const url = new URL(`${env.SSLCOMMERZ_BASE_URL}/validator/api/validationserverAPI.php`);
  url.search = form({
    val_id: valId,
    store_id: env.SSLCOMMERZ_STORE_ID,
    store_passwd: env.SSLCOMMERZ_STORE_PASSWORD,
    format: 'json',
  }).toString();
  const res = await fetch(url, { signal: AbortSignal.timeout(30000) });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`SSLCommerz validation failed with ${res.status}`);
  return json;
}

export const sslcommerz = {
  name: 'sslcommerz',
  get enabled() {
    return env.SSLCOMMERZ_ENABLED && !!(env.SSLCOMMERZ_STORE_ID && env.SSLCOMMERZ_STORE_PASSWORD);
  },

  /** @param {{ returnURL: string, ipnURL: string, customer: { name: string, email?: string, phone?: string } }} opts */
  async startCheckout(payment, { returnURL, ipnURL, customer }) {
    const res = await fetch(`${env.SSLCOMMERZ_BASE_URL}/gwprocess/v4/api.php`, {
      method: 'POST',
      body: form({
        store_id: env.SSLCOMMERZ_STORE_ID,
        store_passwd: env.SSLCOMMERZ_STORE_PASSWORD,
        total_amount: payment.amount.toFixed(2),
        currency: 'BDT',
        tran_id: payment.invoiceNo,
        success_url: returnURL,
        fail_url: returnURL,
        cancel_url: returnURL,
        ipn_url: ipnURL,
        cus_name: customer.name,
        cus_email: customer.email || 'no-email@ghotok.com.bd',
        cus_phone: customer.phone || '01700000000',
        cus_add1: 'Bangladesh',
        cus_city: 'Dhaka',
        cus_country: 'Bangladesh',
        shipping_method: 'NO',
        num_of_item: 1,
        product_name: `${payment.connections} connections`,
        product_category: 'Service',
        product_profile: 'non-physical-goods',
      }),
      signal: AbortSignal.timeout(30000),
    });
    const json = await res.json().catch(() => ({}));
    if (json.status !== 'SUCCESS' || !json.GatewayPageURL) {
      throw new Error(`SSLCommerz session failed: ${json.failedreason ?? JSON.stringify(json)}`);
    }
    return {
      paymentId: payment.invoiceNo,
      redirectURL: json.GatewayPageURL,
      raw: { sessionkey: json.sessionkey },
    };
  },

  /** `body` is SSLCommerz's form post to the return or IPN URL. */
  async completeCheckout(body) {
    const paymentId = body.tran_id;
    if (body.status === 'CANCELLED') return { paymentId, success: false, cancelled: true, raw: body };
    if (!body.val_id) return { paymentId, success: false, raw: body };
    const v = await validate(body.val_id);
    const success =
      (v.status === 'VALID' || v.status === 'VALIDATED') && v.tran_id === paymentId && v.currency === 'BDT';
    return {
      paymentId,
      success,
      amount: Number(v.amount),
      trxId: v.bank_tran_id || v.val_id,
      raw: { status: v.status, val_id: v.val_id, card_type: v.card_type, risk_level: v.risk_level },
    };
  },
};
