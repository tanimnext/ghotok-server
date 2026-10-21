import { bkash } from './bkash.js';
import { nagad } from './nagad.js';
import { sslcommerz } from './sslcommerz.js';

// Automatic checkout providers. Rocket (DBBL) has no public merchant API, so it —
// like bKash and Nagad when their keys are not configured — uses manual
// "Send Money + transaction ID" verification by an admin. SSLCommerz is
// gateway-only (cards and mobile banking on one hosted page).
export const gateways = { bkash, nagad, sslcommerz };

export function gatewayFor(method) {
  const g = gateways[method];
  return g?.enabled ? g : null;
}
