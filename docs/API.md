# API reference

Base URL: `/api` (in development `http://localhost:4000/api`; the client proxies `/api` to the
API so the browser calls it on the website's own origin). Request and response bodies are JSON.
Every route is defined in the Routes section of `index.js` and every request body, query and URL
parameter is validated by the Zod schemas in its Request validation section. That file is the
source of truth when this page and the code disagree.

Signing up, signing in and paying are **not** in this API: the website (ghotok-client) runs
[Better Auth](https://www.better-auth.com) at `/api/auth/*` and the SSLCommerz checkout at
`/api/checkout/*`, writing to the same MongoDB database (see its README).

## Conventions

**Authentication.** Members sign up and sign in on the website with email + password (Better
Auth). It sets an `HttpOnly` session cookie, `ghotok.session_token` (`__Secure-ghotok.session_token`
on HTTPS), whose value is the session token signed with `BETTER_AUTH_SECRET`. This API checks the
signature with the same secret (it must match the website's), looks the token up in the `session`
collection of the shared database and loads the account (`sessionAuth` in `index.js`). Browsers
send the cookie automatically because the website proxies `/api` to this server. There are two
roles: `user` (every new account) and `admin`. Nobody can choose a role when signing up; an account
becomes an admin when its `role` is set to `admin` in the database, or when an admin creates it as
one on the website.

**Errors.**

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Please check the highlighted fields.",
    "details": { "fields": { "email": "Enter a valid email address." } }
  }
}
```

Switch on `code`, never on `message`. Common codes: `VALIDATION_ERROR`, `UNAUTHORIZED`, `ACCOUNT_INACTIVE`, `FORBIDDEN`, `NOT_FOUND`,
`NOT_PENDING` (someone already processed it), `INSUFFICIENT_CONNECTIONS` (402), `RATE_LIMITED`
(429), `BAD_ORIGIN`, `SERVER_ERROR`. Biodata lifecycle codes: `PLEDGE_REQUIRED`, `EDIT_SUSPENDED`
(`details.until`), `CORRECTIONS_PENDING`, `RESTORE_NEEDS_APPROVAL`, `RESTORE_BLOCKED`,
`ALREADY_REPORTED` (`details.ticketId`).

**Lists** return `{ items, total, page, limit, pages }` and accept `?page=` and `?limit=`.

**Origins.** `POST`/`PUT`/`PATCH`/`DELETE` requests carrying an `Origin` header must come from the
API's own origin or one listed in `CORS_ORIGINS`.

**Images.** The browser uploads images to [ImgBB](https://api.imgbb.com/) and sends the API the
resulting links. Fields that take images (`attachments`, banner `imageUrl` / `downloadUrl`) accept
only `https://i.ibb.co/…` or `https://ibb.co/…` URLs (`400 VALIDATION_ERROR` otherwise). There are
no profile photos and no NID uploads.

**Rate limits.** Write-heavy member actions (unlock, favourite, proposals, refunds, tickets) have
tighter limits than the general API limit.

## Health

| Method | Path      | Access | Notes          |
| ------ | --------- | ------ | -------------- |
| GET    | `/health` | public | `{ ok, time }` |

## Sign-up and sign-in (on the website)

Not served by this API. The website's Better Auth handles `/api/auth/sign-up/email`,
`/api/auth/sign-in/email` (with `rememberMe`), `/api/auth/get-session`, `/api/auth/list-sessions`,
`/api/auth/revoke-session`, `/api/auth/revoke-other-sessions`, `/api/auth/revoke-sessions`,
`/api/auth/change-password`, `/api/auth/update-user`, `/api/auth/sign-out` and, for admins, the
admin plugin's `/api/auth/admin/create-user`, `/api/auth/admin/set-user-password` and
`/api/auth/admin/revoke-user-sessions`. Only email + password: there are no one-time codes, no
SMS, no Google and no password reset by email (an admin sets a new password).

## Account: `/me` (auth)

| Method | Path                                                               | Body / notes                                                                                                                                                                                                                                |
| ------ | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/me`                                                              | `{ user }`: `id, name, email, phoneNumber, role, status, emailVerified, phoneNumberVerified, isVerified, connectionBalance, connectionsPurchased, connectionsUsed, language, lastLoginAt, createdAt` (the verified flags are set by admins) |
| GET    | `/me/dashboard`                                                    | Biodata summary, connection balance, visit stats, counts, recent proposals                                                                                                                                                                  |
| PATCH  | `/me`                                                              | `{ name?, language? }`                                                                                                                                                                                                                      |
| DELETE | `/me`                                                              | `{ password, reason? }`, deactivates the account and signs out everywhere (`400 WRONG_PASSWORD` for a wrong password). Signing in again on the website reactivates it                                                                       |
| GET    | `/me/favorites`, `/me/dislikes`, `/me/favorited-me`, `/me/unlocks` | Personal lists                                                                                                                                                                                                                              |
| GET    | `/me/connections`                                                  | Balance and ledger                                                                                                                                                                                                                          |
| GET    | `/me/proposals`                                                    | `?box=sent\|received&status=`                                                                                                                                                                                                               |
| POST   | `/me/proposals/:id/respond`                                        | `{ action: 'accept' \| 'decline', note? }`                                                                                                                                                                                                  |
| POST   | `/me/proposals/:id/withdraw`                                       |                                                                                                                                                                                                                                             |
| GET    | `/me/notifications`                                                |                                                                                                                                                                                                                                             |
| POST   | `/me/notifications/read-all`, `/me/notifications/:id/read`         |                                                                                                                                                                                                                                             |
| DELETE | `/me/notifications/:id`                                            |                                                                                                                                                                                                                                             |

## Biodatas: `/biodatas`

The member's own biodata:

| Method     | Path                             | Access | Body / notes                                                                                                                                                                                |
| ---------- | -------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET        | `/biodatas/me`                   | auth   | `{ biodata, completion }`, `biodata` is null before creation                                                                                                                                |
| POST       | `/biodatas/me`                   | auth   | `{ pledge: true }`, accepts the pledge and creates an empty draft                                                                                                                           |
| PUT        | `/biodatas/me/sections/:section` | auth   | `{ data }`, one section, validated with the shared definition. Editing an approved biodata sends it back to review. `EDIT_SUSPENDED` while staff have suspended editing                     |
| POST       | `/biodatas/me/submit`            | auth   | Submits a complete biodata for review (`CORRECTIONS_PENDING` until every requested correction is changed)                                                                                   |
| PATCH      | `/biodatas/me/visibility`        | auth   | `{ hidden, reason?, note? }`, hiding needs a reason from `HIDE_REASONS` (and a note for `other`)                                                                                            |
| DELETE     | `/biodatas/me`                   | auth   | `{ reason, note?, marriage? }`, soft delete. With a marriage reason, `marriage` is `{ marriedOn?, place?, partnerBiodataNo?, partner?, story?, shareStory? }` and becomes a marriage report |
| POST       | `/biodatas/me/restore`           | auth   | Restores a deleted biodata that was never approved; otherwise `RESTORE_NEEDS_APPROVAL`                                                                                                      |
| GET / POST | `/biodatas/me/restore-request`   | auth   | `{ reason? }`, asks staff to restore a deleted biodata (`RESTORE_BLOCKED` after a permanent decline)                                                                                        |
| GET        | `/biodatas/partner-lookup`       | auth   | `?no=GH-1024`, the partner's public summary for the marriage form                                                                                                                           |
| GET        | `/biodatas/me/stats`             | auth   | Visits today / 7 days / 30 days, favourites                                                                                                                                                 |

Browsing and interacting (`:no` is a biodata number such as `GH-1005`):

| Method        | Path                        | Access | Body / notes                                                                                                                                                                                                                                                                                                                                |
| ------------- | --------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET           | `/biodatas`                 | public | Search. `?type&religion&marital&complexion&profession&economic&division&district&upazila&presentDistrict&presentUpazila&ageMin&ageMax&heightMin&heightMax&education&medium&category&q&sort&page&limit` (list filters take comma-separated values; `sort` is `newest`, `oldest`, …). Signed-in viewers also get `seen` and `favorited` flags |
| GET           | `/biodatas/location-counts` | public | Same filters plus `scope=permanent\|present`: `{ divisions, districts, upazilas }` counts that ignore the location being picked                                                                                                                                                                                                             |
| GET           | `/biodatas/featured`        | public | `?limit=` (1–12)                                                                                                                                                                                                                                                                                                                            |
| GET           | `/biodatas/:no`             | public | Public profile (no private fields)                                                                                                                                                                                                                                                                                                          |
| POST          | `/biodatas/:no/visit`       | public | Counts a profile visit (once per visitor per day)                                                                                                                                                                                                                                                                                           |
| GET           | `/biodatas/:no/viewer`      | auth   | The viewer's state: unlocked (with contact), favourite, dislike, proposal, `refunded`, `report: { status, ticketId }`                                                                                                                                                                                                                       |
| POST          | `/biodatas/:no/unlock`      | auth   | Spends one connection (402 `INSUFFICIENT_CONNECTIONS`); unlocking again is free. Returns the guardian contact                                                                                                                                                                                                                               |
| POST / DELETE | `/biodatas/:no/favorite`    | auth   |                                                                                                                                                                                                                                                                                                                                             |
| POST / DELETE | `/biodatas/:no/dislike`     | auth   |                                                                                                                                                                                                                                                                                                                                             |
| POST          | `/biodatas/:no/proposals`   | auth   | `{ message? }`                                                                                                                                                                                                                                                                                                                              |
| POST          | `/biodatas/:no/report`      | auth   | `{ reason, details?, attachments? }` (up to 5 ImgBB image links), opens a linked support ticket                                                                                                                                                                                                                                             |

## Packages, payments and refunds

| Method | Path                          | Access | Body / notes                                                                                                                                                                                   |
| ------ | ----------------------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/packages`                   | public | Active packages (with `discountPercent` and `finalPrice` for the viewer). Buying happens on the website (`POST /api/checkout` there), which records payments in the same `payments` collection |
| GET    | `/payments/mine`              | auth   |                                                                                                                                                                                                |
| GET    | `/payments/status/:invoiceNo` | auth   | One of the member's own payments, for the receipt page                                                                                                                                         |
| POST   | `/refunds`                    | auth   | `{ paymentId, reason }`                                                                                                                                                                        |
| GET    | `/refunds/mine`               | auth   |                                                                                                                                                                                                |

## Support and content

| Method     | Path                           | Access | Body / notes                                                                                                                                               |
| ---------- | ------------------------------ | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET / POST | `/tickets`                     | auth   | Create: `{ subject, category, message, attachments? }`; `attachments` are up to 5 ImgBB image links                                                        |
| GET        | `/tickets/:id`                 | auth   | Own tickets only; marks staff replies as read                                                                                                              |
| POST       | `/tickets/:id/messages`        | auth   | `{ message?, attachments? }`, text or images. Messages return `attachments: [{ url, type: 'image' }]`. Replying to a closed ticket reopens it              |
| POST       | `/tickets/:id/close`           | auth   |                                                                                                                                                            |
| POST       | `/contact`                     | public | `{ name, email?, phone?, subject?, message }`                                                                                                              |
| GET        | `/public/stats`                | public | Home page statistics                                                                                                                                       |
| GET        | `/public/settings`             | public | Site name, tagline, contact details, app link, tutorial videos, payment info (`approvalGift`, `approvedDiscountPercent`, `checkoutEnabled`), `auth.google` |
| GET        | `/public/success-stories`      | public | Published marriage stories                                                                                                                                 |
| GET        | `/public/banners`              | public | Active banners: `{ id, title, imageUrl, downloads }`                                                                                                       |
| POST       | `/public/banners/:id/download` | public | Counts the download, returns `{ url }` (the full-size ImgBB image)                                                                                         |
| GET        | `/public/pages/:slug`          | public | A published CMS page                                                                                                                                       |
| GET        | `/public/faqs`                 | public | Active FAQs                                                                                                                                                |

## Admin: `/admin`

Every route needs an admin account (role `admin`). The permission column names the entry in
the permissions in `index.js` (`sharedPermissions`); all of them belong to admins.

**Overview and insight**

| Method | Path                | Permission       | Notes                                                            |
| ------ | ------------------- | ---------------- | ---------------------------------------------------------------- |
| GET    | `/admin/overview`   | `overview.view`  | KPI counts and short queues; payments only for `payments.manage` |
| GET    | `/admin/analytics`  | `analytics.view` | `?days=7..365`: daily series, totals and breakdowns              |
| GET    | `/admin/audit-logs` | `audit.view`     | `?action=` (prefix) `&targetId=`                                 |

**Biodatas and recovery**

| Method | Path                                    | Permission        | Body / notes                                                                                                                                         |
| ------ | --------------------------------------- | ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/admin/biodatas`                       | `biodata.review`  | `?status&type&religion&hidden&blocked&deleted=true\|false\|all&q`                                                                                    |
| GET    | `/admin/biodatas/:id`                   | `biodata.review`  | Full biodata, completion, owner, activity, reports, restore request                                                                                  |
| POST   | `/admin/biodatas/:id/approve`           | `biodata.review`  | Fails with `INCOMPLETE`                                                                                                                              |
| POST   | `/admin/biodatas/:id/reject`            | `biodata.review`  | `{ reason, corrections? }`, the owner sees it. `corrections` is `[{ section, field, note }]`; the owner must change those fields before resubmitting |
| POST   | `/admin/biodatas/:id/suspend-edit`      | `biodata.review`  | `{ until, reason? }`, blocks the owner's edits until the date (`until: null` lifts it)                                                               |
| PUT    | `/admin/biodatas/:id/sections/:section` | `biodata.edit`    | `{ data }`, staff correction                                                                                                                         |
| POST   | `/admin/biodatas/:id/block`             | `biodata.review`  | `{ blocked, reason? }`, hide from or show to the public                                                                                              |
| POST   | `/admin/biodatas/:id/delete`            | `biodata.review`  | `{ reason }`                                                                                                                                         |
| POST   | `/admin/biodatas/:id/restore`           | `recovery.manage` |                                                                                                                                                      |
| GET    | `/admin/restore-requests`               | `recovery.manage` | `?status=pending\|approved\|declined`                                                                                                                |
| POST   | `/admin/restore-requests/:id/approve`   | `recovery.manage` | `{ note? }`                                                                                                                                          |
| POST   | `/admin/restore-requests/:id/decline`   | `recovery.manage` | `{ note?, permanent? }`, a permanent decline blocks further requests                                                                                 |

**Users**

| Method | Path               | Permission     | Body / notes                                                                                                                                                                                                                     |
| ------ | ------------------ | -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/admin/users`     | `users.view`   | `?q&role=user\|admin&status&verified`                                                                                                                                                                                            |
| GET    | `/admin/users/:id` | `users.view`   | Account, biodata, payments, ledger, counts                                                                                                                                                                                       |
| PATCH  | `/admin/users/:id` | `users.manage` | `{ name?, email?, phoneNumber?, role?, status?, statusReason?, emailVerified?, phoneNumberVerified? }`. Admins cannot change their own role or suspend themselves. Changing the role or suspending signs the user out everywhere |

**Money**

| Method         | Path                         | Permission           | Body / notes                                                                                                                                                                                                                                      |
| -------------- | ---------------------------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET            | `/admin/payments`            | `payments.manage`    | `?status&q` (invoice or bank transaction ID). Read-only: SSLCommerz decides whether a payment succeeded                                                                                                                                           |
| GET            | `/admin/refunds`             | `refunds.manage`     | `?status`                                                                                                                                                                                                                                         |
| POST           | `/admin/refunds/:id/approve` | `refunds.manage`     | `{ resolution: 'connection_credit' \| 'money_back', connections?, amount?, refundTrxId?, note? }`. For `money_back`, refund the money in the SSLCommerz panel first and put its reference in `refundTrxId`; the unused connections are taken back |
| POST           | `/admin/refunds/:id/reject`  | `refunds.manage`     | `{ note }`                                                                                                                                                                                                                                        |
| POST           | `/admin/connections/adjust`  | `connections.adjust` | `{ user, action: 'grant' \| 'revoke' \| 'refund_credit', quantity, reason }`, `user` is an ID, email or phone                                                                                                                                     |
| GET            | `/admin/connections/ledger`  | `connections.adjust` | `?user&type`                                                                                                                                                                                                                                      |
| GET / POST     | `/admin/packages`            | `packages.manage`    | `{ name: { en, bn? }, description?, connections, price, isActive?, highlight?, sortOrder? }`                                                                                                                                                      |
| PATCH / DELETE | `/admin/packages/:id`        | `packages.manage`    | A package that has payments is retired instead of deleted                                                                                                                                                                                         |

**Moderation and support**

| Method | Path                          | Permission       | Body / notes                                                                                                                                         |
| ------ | ----------------------------- | ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/admin/reports`              | `reports.manage` | `?status=active\|open\|in_review\|resolved\|dismissed`                                                                                               |
| PATCH  | `/admin/reports/:id`          | `reports.manage` | `{ status, actionTaken?, refundConnection? }`, the outcome is posted to the linked ticket; `refundConnection` returns the reporter's connection once |
| GET    | `/admin/tickets`              | `tickets.manage` | `?status=active\|open\|waiting\|answered\|closed&category&q`                                                                                         |
| GET    | `/admin/tickets/:id`          | `tickets.manage` | With messages                                                                                                                                        |
| POST   | `/admin/tickets/:id/messages` | `tickets.manage` | `{ message?, attachments?, close? }` (text or ImgBB images)                                                                                          |
| PATCH  | `/admin/tickets/:id`          | `tickets.manage` | `{ status?, priority?, assignToMe? }`                                                                                                                |
| GET    | `/admin/contact-messages`     | `tickets.manage` | `?status=new\|read\|replied\|archived`                                                                                                               |
| PATCH  | `/admin/contact-messages/:id` | `tickets.manage` | `{ status }`                                                                                                                                         |

**Website content and settings**

| Method             | Path                          | Permission        | Body / notes                                                                                                                        |
| ------------------ | ----------------------------- | ----------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| GET                | `/admin/settings`             | `settings.manage` | All setting groups                                                                                                                  |
| PUT                | `/admin/settings/:key`        | `settings.manage` | `key` is `site`, `payments` or `stats`; `{ value }` is merged over the defaults                                                     |
| GET                | `/admin/pages`                | `content.manage`  |                                                                                                                                     |
| GET / PUT / DELETE | `/admin/pages/:slug`          | `content.manage`  | `{ title: { en, bn }, body: { en, bn }, isPublished }`, body is Markdown                                                            |
| GET / POST         | `/admin/faqs`                 | `content.manage`  | `{ question: { en, bn }, answer: { en, bn }, category?, sortOrder?, isActive? }`                                                    |
| PATCH / DELETE     | `/admin/faqs/:id`             | `content.manage`  |                                                                                                                                     |
| GET                | `/admin/marriage-reports`     | `content.manage`  | `?storyStatus=pending\|published\|hidden`                                                                                           |
| PATCH              | `/admin/marriage-reports/:id` | `content.manage`  | `{ storyStatus?, publishedStory? }`; only stories shared with consent can be published                                              |
| GET / POST         | `/admin/banners`              | `content.manage`  | Create: `{ title: { en, bn? }, imageUrl, downloadUrl?, isActive?, sortOrder? }` (ImgBB links; `downloadUrl` defaults to `imageUrl`) |
| PATCH / DELETE     | `/admin/banners/:id`          | `content.manage`  |                                                                                                                                     |
