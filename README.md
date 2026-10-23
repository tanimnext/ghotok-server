# Ghotok server (ঘটক API)

The REST API of Ghotok, a secure matchmaking platform for every faith in Bangladesh. Families
publish a free biodata, browse approved biodatas and unlock a guardian's contact details with
**connections** bought online through [SSLCommerz](https://www.sslcommerz.com) (card, bKash,
Nagad, Rocket or internet banking on one page). Admins review biodatas, see payments and handle
refunds, reports and support.

This repository is the backend only: one Express file, `index.js`. The website, member dashboard
and admin dashboard live in [ghotok-client](https://github.com/tanimnext/ghotok-client), which also
runs sign-up/sign-in (Better Auth, email + password) and the SSLCommerz checkout. Both apps use
**the same MongoDB database**.

|                |                                                                                           |
| -------------- | ----------------------------------------------------------------------------------------- |
| Runtime        | Node.js 22, Express 5                                                                     |
| Database       | MongoDB with Mongoose 8                                                                   |
| Authentication | Sessions from the website's [Better Auth](https://www.better-auth.com) (email + password) |
| Validation     | Zod 4                                                                                     |
| Tests          | Vitest, Supertest, mongodb-memory-server                                                  |

## How it fits together

```
Browser ──► ghotok-client (Next.js) ──/api/* proxy──► ghotok-server (Express) ──► MongoDB
   │          ├─ /api/auth/*      Better Auth ─────────────────────────────────────►  ▲
   │          └─ /api/checkout/*  SSLCommerz checkout ─────────────────────────────►  │
   └──── images ──► ImgBB (the API stores the links only)                              │
                                       (one database, shared by both apps) ────────────┘
```

- **Sign-up and sign-in happen on the website.** Better Auth there writes the `user`,
  `account` and `session` collections. It sets the cookie `ghotok.session_token`, signed with
  `BETTER_AUTH_SECRET`.
- **This API only reads sessions.** It checks the cookie's signature with the same
  `BETTER_AUTH_SECRET` and looks the token up in `session` (`sessionAuth` in `index.js`).
  Set the same `MONGODB_URI` and the same `BETTER_AUTH_SECRET` in both apps.
- **Payments happen on the website** (SSLCommerz). It writes the `payments`, ledger and
  notification documents this API shows in history, receipts, refunds and the admin dashboard.
- The website proxies every other `/api/*` request to this server, so the browser only talks to
  one origin and the cookie is first-party.
- Images (support attachments, report evidence, wedding banners) are uploaded by the browser to
  ImgBB; the API accepts only `https://i.ibb.co/…` and `https://ibb.co/…` links. There are no
  profile photos and no NID uploads.

### Roles

There are two roles: **user** (members) and **admin**.

- Every account made by signing up is a `user`. The website refuses a `role` at sign-up and in
  `update-user`.
- An account becomes an admin only when its role is changed in the database, or by another admin
  in the admin dashboard (which also creates accounts and sets passwords, on the website). The
  client sends admins to `/admin` and members to `/dashboard`.
- Changing someone's role or suspending them here signs them out of every device.
- `/api/admin/*` requires role `admin`; members get `403`.

Make someone an admin from the MongoDB shell:

```js
db.user.updateOne({ email: 'person@example.com' }, { $set: { role: 'admin' } });
```

`npm run seed` also creates the first admin from `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD`.

## Run it on your computer

You need **Node.js 22.12 or newer** (`node -v`) and a **MongoDB database**, and you run
[ghotok-client](https://github.com/tanimnext/ghotok-client) next to it to sign in. The steps are
the same on macOS and Windows; use Terminal (macOS) or PowerShell (Windows).

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

**3. Use the same database and secret as the website.** `MONGODB_URI` and `BETTER_AUTH_SECRET`
must be identical in this `.env` and in ghotok-client's `.env.local`. With the defaults of both
`.env.example` files they already are (local MongoDB, development secret).

**4. Fill in the demo data and start the server, then start the website**

```bash
npm run seed:demo             # admin, packages, pages, FAQs and demo members/biodatas
npm run dev                   # http://localhost:4000/api/health should answer {"ok":true}
```

Then start ghotok-client (`npm run dev` there) and open http://localhost:3000.

`node index.js` and `nodemon` work too: `index.js` reads `.env` by itself (values already set in
your shell win).

Demo accounts after `npm run seed:demo` sign in on the website: the admin from `.env`
(`admin@ghotok.com.bd` / `ChangeMe!2026` by default), `member@example.com` and
`demo1…20@example.com` / `Demo@12345`. The seed writes the passwords in Better Auth's own format.

Payments (SSLCommerz) are set up in ghotok-client; see its README.

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

| Variable             | Meaning                                                                                |
| -------------------- | -------------------------------------------------------------------------------------- |
| `MONGODB_URI`        | MongoDB connection string; **the same database as ghotok-client**                      |
| `BETTER_AUTH_SECRET` | **The same value as ghotok-client**; checks the session cookie. Required in production |
| `CLIENT_URL`         | The website's URL                                                                      |
| `CORS_ORIGINS`       | Origins allowed to call the API with cookies (the website)                             |
| `API_PUBLIC_URL`     | This API's own public URL (allowed by the origin check)                                |
| `SEED_ADMIN_*`       | The first admin `npm run seed` creates                                                 |

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
5. Authentication: reading the website's Better Auth sessions (`sessionAuth`)
6. Services: the business rules (`biodataService`, `paymentService`, …)
7. Request validation schemas (Zod) (`biodataValidation`, `adminValidation`, …)
8. Serializers: what each audience may see (`biodataSerializer`, …)
9. Middleware: auth, security, validation, errors
10. Controllers
11. Routes (`apiRoutes`, `adminRoutes`, …)
12. The Express application (`appModule.createApp`)
13. Seed data and the seed script (`seedScript`)
14. Start: `node index.js` runs the server, `node index.js seed [--demo]` seeds the database

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
session cookie stays first-party, give it the website's `MONGODB_URI` and `BETTER_AUTH_SECRET`,
then run `npm run seed` once. The API reads
`TRUST_PROXY` to see visitors' real IP addresses behind proxies.

## Documentation

- [API reference](docs/API.md)
- [Changelog](CHANGELOG.md)
- [Decision records](docs/adr/)
