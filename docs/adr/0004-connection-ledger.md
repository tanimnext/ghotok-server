# 0004. A connection ledger with atomic conditional updates

Status: Accepted

## Context

Connections are bought with real money and spent to unlock contacts. Staff can also grant,
revoke and refund them. Balances must never go negative, never be credited twice, and every
change must be explainable. MongoDB multi-document transactions require a replica set, which
complicates small deployments.

## Decision

- `User.connectionBalance` changes only through `changeBalance()`, which uses a conditional
  `$inc` (a debit matches only if the balance is high enough) and writes one
  `ConnectionTransaction` row per change with its type, reason, actor and related payment or
  biodata.
- Idempotency comes from the data model: a unique (user, biodata) index on `ContactUnlock`, and
  payments are credited by an atomic `pending → verified` status change.
- Refund decisions claim the request atomically and undo the claim if the balance change fails.

## Consequences

- Works on a standalone MongoDB, Atlas or a replica set alike.
- The ledger gives members their history and staff a full audit trail.
- A crash between the balance update and the ledger insert could, in theory, leave a change
  without its row; the window is a single round trip and the ledger can be reconciled against
  payments and unlocks if it ever happens.
