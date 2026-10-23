# 0008. SSLCommerz is the only way to pay

Status: Accepted (supersedes 0005)

## Context

The owner decided that members pay only through SSLCommerz. Its hosted page already offers cards,
bKash, Nagad, Rocket and internet banking, so separate bKash/Nagad integrations and the manual
"Send Money + transaction ID" check by staff are no longer needed.

## Decision

- `POST /api/payments` takes only a package and starts an SSLCommerz checkout. A payment is
  credited only from SSLCommerz's return or IPN post, after its validation API confirms the
  transaction and the amount matches the invoice. Both posts may arrive, in any order and more
  than once; the conditional update in `connectionService.creditPayment` credits exactly once.
- Without SSLCommerz settings the API answers `503 PAYMENTS_UNAVAILABLE` and `GET /api/packages`
  reports `checkout.enabled: false`.
- Staff no longer verify or reject payments. The admin list is read-only; money refunds are made
  in the SSLCommerz panel and recorded as a `money_back` refund.
- Payments stored before this change (bKash/Nagad/Rocket, manual, pending/rejected) stay valid
  documents and are still listed and serialised.

## Consequences

- No staff time per payment and connections arrive at once, but selling depends on an active
  SSLCommerz store, and a local end-to-end test needs a public URL (a tunnel) for the IPN.
- SSLCommerz's fee applies to every payment, including mobile wallets.
