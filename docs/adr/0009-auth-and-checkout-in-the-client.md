# 0009. Sign-in and checkout run in the website; the API reads sessions

Status: Accepted (amends 0006 and 0008)

## Context

The owner wants the server to be a single Express file with the website doing sign-up, sign-in
(Better Auth, email + password only) and the SSLCommerz checkout itself, against MongoDB.

## Decision

- ghotok-client runs Better Auth (`better-auth` with the MongoDB adapter and the admin plugin)
  at `/api/auth/*`, with email + password only: no one-time codes, SMS, Google, email
  verification or password reset by email. Admins create accounts and set passwords through the
  admin plugin.
- ghotok-client runs the SSLCommerz checkout at `/api/checkout/*` and records payments, ledger
  entries and notifications in the documents this API already uses.
- Both apps use the same MongoDB database. This API authenticates a request by checking the
  signature of the `ghotok.session_token` cookie with the shared `BETTER_AUTH_SECRET` (the same
  HMAC-SHA256 Better Auth uses) and finding the token in the `session` collection. It never
  signs anyone in, and it no longer depends on Better Auth, nodemailer or an SMS gateway.
- The seed writes accounts straight into Better Auth's collections, hashing passwords in Better
  Auth's scrypt format, so seeded accounts sign in on the website.
- Role and status changes made here delete the user's `session` documents (signed out everywhere).

## Consequences

- Two apps write the same collections, so the shapes of `user`, `session`, `account`,
  `payments`, `connectiontransactions` and `notifications` are a contract between the repos;
  tests on both sides pin them (cookie signing and password format vectors here, checkout and
  auth rules in the client).
- `MONGODB_URI` and `BETTER_AUTH_SECRET` must match in both `.env` files.
- Members can no longer verify their email or reset a forgotten password themselves; an admin
  sets a new password. The verified flags are set by admins.
- Admin account creation and password changes are no longer in the audit log (they happen in
  Better Auth on the website).
