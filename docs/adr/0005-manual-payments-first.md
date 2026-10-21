# 0005. Manual mobile-money verification first, gateways optional

Status: Accepted

## Context

Bangladeshi families mostly pay with bKash, Nagad and Rocket. Merchant gateway accounts take time
to approve, Rocket has no comparable checkout API, and the business must be able to sell from
day one.

## Decision

- Every method supports "Send Money + transaction ID": the member pays the number shown in site
  settings and submits the sender number and transaction ID; staff verify it against the merchant
  statement before the connections are credited. Duplicate transaction IDs are rejected.
- bKash tokenized checkout and Nagad online checkout are optional integrations, switched on with
  environment variables. Their callbacks confirm the payment with the gateway and credit through
  the same code path as manual verification.

## Consequences

- The platform works without any gateway contract, at the cost of staff time per payment and a
  short delay for the member (the expected time is shown on the checkout page).
- Turning gateways on later needs no data migration.
