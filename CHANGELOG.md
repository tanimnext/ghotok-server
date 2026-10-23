# Changelog

All notable changes to this project are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and versions follow
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- **Zero-setup development database.** When no MongoDB answers at the default local address,
  `npm run dev` / `node index.js` / `nodemon` start a local MongoDB in the background (data in
  `.data/mongo`), and an empty database gets the first admin and default content. `npm run
db:stop` stops it. Production and a configured `MONGODB_URI` (Atlas) never fall back.
- `index.js` reads `.env` itself, so `nodemon` and `node index.js` use it too, and a missing
  database is reported in two lines instead of a driver stack trace.

### Changed

- **Payments are SSLCommerz only** (card, bKash, Nagad, Rocket and internet banking on
  SSLCommerz's page). Removed: the bKash and Nagad gateway integrations, Rocket, and the manual
  "Send Money + transaction ID" flow with admin verify/reject (`POST /api/admin/payments/:id/verify`
  and `/reject`, `GET /api/payments/:method/callback`, the `BKASH_*`/`NAGAD_*` variables, the
  manual numbers and `verificationHours` in the payment settings, the `payment_rejected`
  notification and the overview's `pendingPayments`).
- `POST /api/payments` takes `{ packageId }` and answers `{ payment, redirectURL }`, or
  `503 PAYMENTS_UNAVAILABLE` until SSLCommerz is configured. `GET /api/packages` returns
  `checkout: { enabled }` instead of `methods`; public settings carry `payments.checkoutEnabled`.
- The admin payments list is read-only (`?status&q`). Older bKash/Nagad/Rocket and manual
  payments stay readable.
- `index.js` loads `.env` itself, so `node index.js` and `nodemon` pick up `MONGODB_URI`; when
  MongoDB cannot be reached the server prints how to start one or use Atlas.
- nodemailer 10 (clears the `npm audit` advisories).

- The whole API is now one file, `index.js`, organised in sections (configuration, shared rules,
  models, integrations, Better Auth, services, validation, serializers, middleware, controllers,
  routes, app, seed, start). Endpoints, responses and environment variables are unchanged.
- Run it with `node index.js`; seed with `node index.js seed` or `node index.js seed --demo`
  (`npm start`, `npm run seed` and `npm run seed:demo` do the same). The Docker image runs
  `node index.js`.

## [2.0.0] - 2026-10-21

The API becomes its own repository, separate from the website and admin dashboard
([ghotok-client](https://github.com/tanimnext/ghotok-client)).

### Changed

- Authentication is now [Better Auth](https://www.better-auth.com): email + password, email and
  SMS one-time codes, Google, "remember me", device list and sign-out, password change and reset.
  The endpoints live under `/api/auth` (see `docs/API.md`).
- Roles are `user` and `admin`. Every new account is a `user`; admins are made in the database
  or by another admin. `/api/admin/*` requires role `admin`.
- Support attachments, report evidence and wedding banners are ImgBB image links uploaded by the
  browser; the API validates the host.
- Accounts use `phoneNumber` / `phoneNumberVerified` (Better Auth's names) instead of
  `phone` / `phoneVerified`. `GET /api/me` returns the signed-in account.
- The shared rules (biodata definition, options, locations, permissions) are copied into
  `src/shared`.

### Removed

- Biodata photos and NID upload and verification, with the `nid` search filter and the
  `moderation` settings group.
- File storage (local, Cloudflare Images, R2) and the upload endpoints.
- The previous JWT and refresh-token authentication.

## [1.0.0] - 2026-10-20

First release, as part of the Ghotok monorepo.
