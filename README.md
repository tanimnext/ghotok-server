# Ghotok server (ঘটক API)

The REST API of Ghotok, a secure matchmaking platform for every faith in Bangladesh. Families
publish a free biodata, browse approved biodatas and unlock a guardian's contact details with
**connections** bought through bKash, Nagad, Rocket or SSLCommerz. Admins review biodatas and
payments and handle reports and support.

This repository is the backend only. The website, member dashboard and admin dashboard live in
[ghotok-client](https://github.com/tanimnext/ghotok-client), which talks to this API.

|                |                                                                                                |
| -------------- | ---------------------------------------------------------------------------------------------- |
| Runtime        | Node.js 22, Express 5                                                                          |
| Database       | MongoDB with Mongoose 8                                                                        |
| Authentication | [Better Auth](https://www.better-auth.com) 1.7 (email + password, email and SMS codes, Google) |
| Validation     | Zod 4                                                                                          |
| Tests          | Vitest, Supertest, mongodb-memory-server                                                       |

## How it fits together

```
Browser ──► ghotok-client (Next.js) ──/api/* proxy──► ghotok-server (Express) ──► MongoDB
   │                                                         ▲
   └──── images ──► ImgBB (the API stores the links only) ───┘
```

- The client proxies `/api/*` to this server, so the browser only talks to the website's origin
  and the Better Auth session cookie is first-party.
- `/api/auth/*` is Better Auth. Everything else is the Ghotok API (`src/routes`).
- Images (support attachments, report evidence, wedding banners) are uploaded by the browser to
  ImgBB; the API accepts only `https://i.ibb.co/…` and `https://ibb.co/…` links. There are no
  profile photos and no NID uploads.

### Roles

There are two roles: **user** (members) and **admin**.

- Every new account is a `user`, however it was created (sign-up, SMS or email code, Google).
  The `role` field cannot be set by sign-up or `update-user`.
- An account becomes an admin only when its role is changed in the database, or by another admin
  in the admin dashboard. The client sends admins to `/admin` and members to `/dashboard`.
- `/api/admin/*` requires role `admin`; members get `403`.

Make someone an admin from the MongoDB shell:

```js
db.user.updateOne({ email: 'person@example.com' }, { $set: { role: 'admin' } });
```

`npm run seed` also creates the first admin from `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD`.

## Getting started

Requirements: Node.js 22.12+ (`nvm use`), and MongoDB 7+ (local or Atlas).

```bash
npm ci
cp .env.example .env        # then edit it
npm run seed:demo           # admin, packages, pages, FAQs and demo members/biodatas
npm run dev                 # http://localhost:4000/api
```

Demo accounts after `npm run seed:demo`: the admin from `.env` (`admin@ghotok.com.bd` /
`ChangeMe!2026` by default), `member@example.com` and `demo1…20@example.com` / `Demo@12345`.

With `OTP_DEV_ECHO=true` (development only) every one-time code is written to the log, so you can
sign in with codes without an SMS or email provider.

## Scripts

| Script                            | What it does                                                                           |
| --------------------------------- | -------------------------------------------------------------------------------------- |
| `npm run dev`                     | Start with auto-reload                                                                 |
| `npm start`                       | Start for production                                                                   |
| `npm run seed`                    | Create the first admin, packages, CMS pages and FAQs (safe to re-run)                  |
| `npm run seed:demo`               | The above plus demo members, biodatas, payments and support data (never in production) |
| `npm test`                        | Run the test suite against a throwaway MongoDB                                         |
| `npm run lint` / `npm run format` | ESLint / Prettier                                                                      |
| `npm run check`                   | Lint, format check and tests (what CI runs)                                            |

## Configuration

Every variable is documented in [`.env.example`](.env.example) and validated at start-up in
[`src/config/env.js`](src/config/env.js). The important ones:

| Variable                                   | Meaning                                                                                       |
| ------------------------------------------ | --------------------------------------------------------------------------------------------- |
| `MONGODB_URI`                              | MongoDB connection string                                                                     |
| `CLIENT_URL`                               | The website's URL (redirects after payments, links in emails)                                 |
| `CORS_ORIGINS`                             | Origins allowed to call the API with cookies (the website)                                    |
| `BETTER_AUTH_URL`                          | The public URL the browser uses for `/api/auth`: the website's URL, because it proxies `/api` |
| `BETTER_AUTH_SECRET`                       | 32+ random characters; the API refuses to start in production with the default                |
| `API_PUBLIC_URL`                           | Where payment gateways call back (`/api/payments/…`, `/api/gateway/…`)                        |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Optional Google sign-in; redirect URI `<BETTER_AUTH_URL>/api/auth/callback/google`            |
| `SMTP_*`, `SMS_API_URL`                    | Email and SMS delivery for one-time codes and notices (logged when empty)                     |
| `BKASH_*`, `NAGAD_*`, `SSLCOMMERZ_*`       | Optional online checkout; manual Send Money + transaction ID always works                     |

## Project layout

```
src/
  app.js                 Express app: security, Better Auth, routes, errors
  server.js              Connects to MongoDB and listens
  config/                env, logger, database, Better Auth (auth.js)
  routes/ → validations/ → controllers/ → services/ → models/
  serializers/           Output shapes (what each audience may see)
  integrations/          Payment gateways, email and SMS
  shared/                Biodata form definition, options, locations, permissions
  scripts/seed.js        Seed data
test/                    API tests and the shared rules' tests
docs/API.md              Every endpoint
```

The biodata definition, option lists and permissions in `src/shared/` are also used by the
client, which keeps its own copy. **When you change them, change both repositories.**

## Deployment

```bash
docker build -t ghotok-server .
docker run --env-file .env -p 4000:4000 ghotok-server
```

Put the API behind the website's `/api` proxy (or a reverse proxy on the same site) so the
session cookie stays first-party, set `COOKIE_SECURE=true`, a strong `BETTER_AUTH_SECRET`,
`OTP_DEV_ECHO=false` and real SMTP/SMS settings, then run `npm run seed` once. The API reads
`TRUST_PROXY` to see visitors' real IP addresses behind proxies.

## Documentation

- [API reference](docs/API.md)
- [Changelog](CHANGELOG.md)
- [Decision records](docs/adr/)
