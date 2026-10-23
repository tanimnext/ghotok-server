# Ghotok server (ঘটক API)

The REST API of Ghotok, a secure matchmaking platform for every faith in Bangladesh. Families
publish a free biodata, browse approved biodatas and unlock a guardian's contact details with
**connections** bought online through [SSLCommerz](https://www.sslcommerz.com) (card, bKash,
Nagad, Rocket or internet banking on one page). Admins review biodatas, see payments and handle
refunds, reports and support.

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
- `/api/auth/*` is Better Auth. Everything else is the Ghotok API (the Routes section of `index.js`).
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

## Run it on your computer

You need **Node.js 22.12 or newer** (`node -v`) and a **MongoDB database**. The steps are the same
on macOS and Windows; use Terminal (macOS) or PowerShell (Windows).

**1. Install the packages and create your settings file**

```bash
npm install
cp .env.example .env          # Windows PowerShell: Copy-Item .env.example .env
```

**2. Give the server a database.** The quickest way is to do nothing: in development, when no
MongoDB answers at the default `mongodb://127.0.0.1:27017/ghotok`, the server starts its own local
MongoDB in the background (the first start downloads it, about 100 MB). Its data lives in
`.data/mongo` inside this folder and survives restarts; stop it with `npm run db:stop`. A fresh
database also gets the first admin and the default content automatically.

For a database you keep (and always in production), choose one:

- **A. MongoDB Atlas (free, nothing to install, recommended)**
  1. Sign up at https://www.mongodb.com/cloud/atlas/register and create a free **M0** cluster.
  2. _Database Access_: add a database user with a password.
  3. _Network Access_: add your current IP address (or `0.0.0.0/0` while testing).
  4. _Connect → Drivers_: copy the connection string, put your password in it and add the
     database name before the `?`, then set it in `.env`:
     `MONGODB_URI=mongodb+srv://USER:PASSWORD@cluster0.xxxxx.mongodb.net/ghotok?retryWrites=true&w=majority`
- **B. MongoDB installed on your own computer**
  - macOS (Homebrew): `brew tap mongodb/brew && brew install mongodb-community && brew services start mongodb-community`
    (plain `brew install mongodb-community` fails without the `mongodb/brew` tap).
  - Windows: install _MongoDB Community Server_ from https://www.mongodb.com/try/download/community
    with "Install as a Service" ticked.
  - Keep the default `MONGODB_URI=mongodb://127.0.0.1:27017/ghotok`.

**3. Fill in the demo data and start the server**

```bash
npm run seed:demo             # admin, packages, pages, FAQs and demo members/biodatas
npm run dev                   # http://localhost:4000/api/health should answer {"ok":true}
```

`node index.js` and `nodemon` work too: `index.js` reads `.env` by itself (values already set in
your shell win).

Demo accounts after `npm run seed:demo`: the admin from `.env` (`admin@ghotok.com.bd` /
`ChangeMe!2026` by default), `member@example.com` and `demo1…20@example.com` / `Demo@12345`.

With `OTP_DEV_ECHO=true` (development only) every one-time code is written to the log, so you can
sign in with codes without an SMS or email provider.

### Payments (SSLCommerz sandbox)

SSLCommerz is the only way to pay. Without its settings the site works, but buying connections
answers "online payment is not available" (`503 PAYMENTS_UNAVAILABLE`).

1. Register a free sandbox store at https://developer.sslcommerz.com/registration/; SSLCommerz
   emails you a **Store ID** and **Store Password**.
2. In `.env`:
   ```
   SSLCOMMERZ_ENABLED=true
   SSLCOMMERZ_BASE_URL=https://sandbox.sslcommerz.com
   SSLCOMMERZ_STORE_ID=your_store_id
   SSLCOMMERZ_STORE_PASSWORD=your_store_password
   ```
3. SSLCommerz sends the result to `API_PUBLIC_URL/api/gateway/sslcommerz/return` (the member's
   browser) and `API_PUBLIC_URL/api/gateway/sslcommerz/ipn` (its servers). Its servers cannot
   reach `localhost`, so for a full local test open a tunnel, for example
   `ngrok http 3000` (the website, which passes `/api` on to this server), and set
   `API_PUBLIC_URL`, `BETTER_AUTH_URL` and `CLIENT_URL` to the `https://….ngrok-free.app`
   address (add it to `CORS_ORIGINS` too). Without a tunnel the return still works in your own
   browser, but the IPN does not arrive.
4. Pay with the sandbox test cards or mobile wallets SSLCommerz lists in its developer docs. The
   payment is credited only after SSLCommerz's validation API confirms it and the amount matches.

For production use `SSLCOMMERZ_BASE_URL=https://securepay.sslcommerz.com` with your live store,
and set the IPN URL in the SSLCommerz merchant panel as well. Refunds of money are made in the
SSLCommerz panel; record them in the admin dashboard (_Refunds → money back_) so the unused
connections are taken back.

## Scripts

| Script                            | What it does                                                                           |
| --------------------------------- | -------------------------------------------------------------------------------------- |
| `npm run dev`                     | Start with auto-reload                                                                 |
| `npm start`                       | Start for production                                                                   |
| `npm run seed`                    | Create the first admin, packages, CMS pages and FAQs (safe to re-run)                  |
| `npm run seed:demo`               | The above plus demo members, biodatas, payments and support data (never in production) |
| `npm run db:stop`                 | Stop the background development MongoDB started by `npm run dev` (see above)           |
| `npm test`                        | Run the test suite against a throwaway MongoDB                                         |
| `npm run lint` / `npm run format` | ESLint / Prettier                                                                      |
| `npm run check`                   | Lint, format check and tests (what CI runs)                                            |

## Configuration

Every variable is documented in [`.env.example`](.env.example) and validated at start-up in
the Configuration section of [`index.js`](index.js) (`envConfig`). The important ones:

| Variable                                   | Meaning                                                                                       |
| ------------------------------------------ | --------------------------------------------------------------------------------------------- |
| `MONGODB_URI`                              | MongoDB connection string                                                                     |
| `CLIENT_URL`                               | The website's URL (redirects after payments, links in emails)                                 |
| `CORS_ORIGINS`                             | Origins allowed to call the API with cookies (the website)                                    |
| `BETTER_AUTH_URL`                          | The public URL the browser uses for `/api/auth`: the website's URL, because it proxies `/api` |
| `BETTER_AUTH_SECRET`                       | 32+ random characters; the API refuses to start in production with the default                |
| `API_PUBLIC_URL`                           | Where SSLCommerz sends results (`/api/gateway/sslcommerz/return` and `/ipn`)                  |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Optional Google sign-in; redirect URI `<BETTER_AUTH_URL>/api/auth/callback/google`            |
| `SMTP_*`, `SMS_API_URL`                    | Email and SMS delivery for one-time codes and notices (logged when empty)                     |
| `SSLCOMMERZ_*`                             | The SSLCommerz store; payments are unavailable until it is set (see _Payments_ above)         |

## Project layout

```
index.js                 The whole API, in one file (see below)
test/                    API tests and the shared rules' tests
docs/API.md              Every endpoint
docs/adr/                Decision records
```

**Everything is in `index.js`.** The file is split into sections, in this order:

1. Configuration: environment (`envConfig`), logger, database connection (`dbConfig`)
2. Shared rules: option lists, locations, the biodata definition, permissions (`shared`)
3. Utilities (errors, pagination, request helpers)
4. Database models (Mongoose), collected in `models` (`models.Biodata`, `models.User`, …)
5. Integrations: email, SMS and the payment gateways (`paymentGateways`)
6. Authentication: Better Auth (`authConfig`)
7. Services: the business rules (`biodataService`, `paymentService`, …)
8. Request validation schemas (Zod) (`biodataValidation`, `adminValidation`, …)
9. Serializers: what each audience may see (`biodataSerializer`, …)
10. Middleware: auth, security, validation, errors
11. Controllers
12. Routes (`apiRoutes`, `adminRoutes`, …)
13. The Express application (`appModule.createApp`)
14. Seed data and the seed script (`seedScript`)
15. Start: `node index.js` runs the server, `node index.js seed [--demo]` seeds the database

Each part is a namespace object: `const biodataService = (() => { …; return { … }; })();`.
Parts reach each other through these names, so to find something:

- jump to a part: search for `const biodataService =`
- find everything that uses it: search for `biodataService.`
- find an endpoint: search for its path (for example `'/me/submit'`) in the Routes section,
  then follow the controller and service names it calls.

Each part only uses parts defined above it while the file loads; calls between services at
request time can go in either direction. When you add a part, put it in its section and keep
that rule.

The biodata definition, option lists and permissions in the Shared rules section are also used
by the client, which keeps its own copy. **When you change them, change both repositories.**

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
