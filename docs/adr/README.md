# Architecture decision records

Short notes on decisions that shape the codebase: the context, what was decided and what it
costs. Add a new numbered file when a decision is made or reversed; don't rewrite old ones (mark
them "Superseded by NNNN" instead).

| #                                              | Decision                                                              | Status             |
| ---------------------------------------------- | --------------------------------------------------------------------- | ------------------ |
| [0001](0001-javascript-mern-monorepo.md)       | A JavaScript MERN monorepo with shared packages                       | Superseded by 0006 |
| [0002](0002-schema-driven-biodata.md)          | Define the biodata form once and derive everything from it            | Accepted           |
| [0003](0003-same-origin-cookie-sessions.md)    | Same-origin API with cookie sessions and rotating refresh tokens      | Superseded by 0006 |
| [0004](0004-connection-ledger.md)              | A connection ledger with atomic conditional updates                   | Accepted           |
| [0005](0005-manual-payments-first.md)          | Manual mobile-money verification first, gateways optional             | Accepted           |
| [0006](0006-separate-repos-and-better-auth.md) | Separate client and server repositories, Better Auth, images on ImgBB | Accepted           |
| [0007](0007-single-file-api.md)                | The whole API in one file, `index.js`                                 | Accepted           |
