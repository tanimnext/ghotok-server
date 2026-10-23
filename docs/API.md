# API reference

Base URL: `/api` (in development `http://localhost:4000/api`; the client proxies `/api` to the
API so the browser calls it on the website's own origin). Request and response bodies are JSON.
Every route is defined in the Routes section of `index.js` and every request body, query and URL
parameter is validated by the Zod schemas in its Request validation section. Authentication endpoints under `/api/auth`
belong to [Better Auth](https://www.better-auth.com) (configured in the Authentication section of `index.js`, `authConfig`). Those
files are the source of truth when this page and the code disagree.

## Conventions

**Authentication.** Better Auth signs people in and sets an `HttpOnly` session cookie
(`ghotok.session_token`). Browsers send it automatically; the client must send requests with
`credentials: 'include'` (or call the API through its `/api` proxy). There are two roles: `user`
(every new account) and `admin`. Nobody can choose a role when signing up; an account becomes an
admin when its `role` is set to `admin` in the database (or by another admin).

| Marker   | Meaning                                                                                 |
| -------- | --------------------------------------------------------------------------------------- |
| public   | No account needed                                                                       |
| auth     | Signed in (`401 UNAUTHORIZED`; suspended or banned accounts get `403 ACCOUNT_INACTIVE`) |
| verified | Signed in with a verified email or phone (`403 NOT_VERIFIED`)                           |
| admin    | Role `admin` (`403 FORBIDDEN` for members)                                              |

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

Better Auth endpoints answer errors as `{ code, message }` instead. Switch on `code`, never on
`message`. Common codes: `VALIDATION_ERROR`, `UNAUTHORIZED`, `NOT_VERIFIED`, `ACCOUNT_INACTIVE`, `FORBIDDEN`, `NOT_FOUND`,
`NOT_PENDING` (someone already processed it), `INSUFFICIENT_CONNECTIONS` (402), `RATE_LIMITED`
(429), `BAD_ORIGIN`, `SERVER_ERROR`. Biodata lifecycle codes: `PLEDGE_REQUIRED`, `EDIT_SUSPENDED`
(`details.until`), `CORRECTIONS_PENDING`, `RESTORE_NEEDS_APPROVAL`, `RESTORE_BLOCKED`,
`ALREADY_REPORTED` (`details.ticketId`).

**Lists** return `{ items, total, page, limit, pages }` and accept `?page=` and `?limit=`.

**Origins.** `POST`/`PUT`/`PATCH`/`DELETE` requests carrying an `Origin` header (including those
to `/api/auth`) must come from the API's own origin or one listed in `CORS_ORIGINS`.

**Images.** The browser uploads images to [ImgBB](https://api.imgbb.com/) and sends the API the
resulting links. Fields that take images (`attachments`, banner `imageUrl` / `downloadUrl`) accept
only `https://i.ibb.co/…` or `https://ibb.co/…` URLs (`400 VALIDATION_ERROR` otherwise). There are
no profile photos and no NID uploads.

**Rate limits.** Better Auth limits its own endpoints in production; write-heavy member actions
(unlock, favourite, proposals, payments, tickets) have tighter limits than the general API limit.

## Health

| Method | Path      | Access | Notes          |
| ------ | --------- | ------ | -------------- |
| GET    | `/health` | public | `{ ok, time }` |

## Auth: `/auth` (Better Auth)

The client uses Better Auth's client library (`better-auth/react` with the `emailOTPClient` and
`phoneNumberClient` plugins), which calls these endpoints. Mobile numbers are sent as
`01XXXXXXXXX`. Successful sign-ins set the session cookie and return `{ token, user }` (sign-up,
sign-in) or `{ status, token, user }` (phone verify). `user` includes `role`, `status`,
`language`, `connectionBalance`, `emailVerified`, `phoneNumber` and `phoneNumberVerified`.

| Method | Path                                        | Body / notes                                                                                                                                                                                             |
| ------ | ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| POST   | `/auth/sign-up/email`                       | `{ name, email, password, phoneNumber?, language? }`. Role is always `user`; `role`, `status` and `connectionBalance` in the body are ignored. Emails a verification code. `422` when the email is taken |
| POST   | `/auth/sign-in/email`                       | `{ email, password, rememberMe? }`. `rememberMe: false` makes the cookie end with the browser session. `401` wrong credentials, `403 ACCOUNT_INACTIVE` suspended/banned                                  |
| POST   | `/auth/email-otp/send-verification-otp`     | `{ email, type: 'email-verification' \| 'sign-in' \| 'forget-password' }`, sends a 6-digit code (10 minutes, 5 attempts)                                                                                 |
| POST   | `/auth/email-otp/verify-email`              | `{ email, otp }`, marks the email verified                                                                                                                                                               |
| POST   | `/auth/sign-in/email-otp`                   | `{ email, otp }`, signs in (creates a member account for a new email)                                                                                                                                    |
| POST   | `/auth/email-otp/request-password-reset`    | `{ email }`, emails a reset code                                                                                                                                                                         |
| POST   | `/auth/email-otp/reset-password`            | `{ email, otp, password }`, sets the password and signs out every session                                                                                                                                |
| POST   | `/auth/phone-number/send-otp`               | `{ phoneNumber }`, texts a 6-digit code                                                                                                                                                                  |
| POST   | `/auth/phone-number/verify`                 | `{ phoneNumber, code }`, signs in; the first time it creates a member account (no password, no email)                                                                                                    |
| POST   | `/auth/sign-in/phone-number`                | `{ phoneNumber, password, rememberMe? }`                                                                                                                                                                 |
| POST   | `/auth/phone-number/request-password-reset` | `{ phoneNumber }`                                                                                                                                                                                        |
| POST   | `/auth/phone-number/reset-password`         | `{ phoneNumber, otp, newPassword }`                                                                                                                                                                      |
| POST   | `/auth/sign-in/social`                      | `{ provider: 'google', callbackURL, errorCallbackURL? }` → `{ url, redirect: true }`; the browser goes to `url`. Only when `GOOGLE_CLIENT_ID/SECRET` are set (see `/public/settings` → `auth.google`)    |
| GET    | `/auth/callback/google`                     | Google's redirect URI                                                                                                                                                                                    |
| GET    | `/auth/get-session`                         | `{ session, user }` or `null`                                                                                                                                                                            |
| GET    | `/auth/list-sessions`                       | The account's signed-in devices: `[{ id, token, userAgent, ipAddress, createdAt, expiresAt }]`                                                                                                           |
| POST   | `/auth/revoke-session`                      | `{ token }`, signs one device out                                                                                                                                                                        |
| POST   | `/auth/revoke-other-sessions`               | Signs out every other device                                                                                                                                                                             |
| POST   | `/auth/revoke-sessions`                     | Signs out every device, this one included                                                                                                                                                                |
| POST   | `/auth/change-password`                     | `{ currentPassword, newPassword, revokeOtherSessions? }`                                                                                                                                                 |
| POST   | `/auth/update-user`                         | `{ name?, language? }`; `role`, `status` or `connectionBalance` in the body is refused (`400`)                                                                                                           |
| POST   | `/auth/sign-out`                            | Ends this session                                                                                                                                                                                        |

With `OTP_DEV_ECHO=true` (development only) every code is written to the API log.

## Account: `/me` (auth)

| Method | Path                                                               | Body / notes                                                                                                                                                                                                                                |
| ------ | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/me`                                                              | `{ user }`: `id, name, email, phoneNumber, role, status, emailVerified, phoneNumberVerified, isVerified, connectionBalance, connectionsPurchased, connectionsUsed, language, lastLoginAt, createdAt`. `email` is null for SMS-only accounts |
| GET    | `/me/dashboard`                                                    | Biodata summary, connection balance, visit stats, counts, recent proposals                                                                                                                                                                  |
| PATCH  | `/me`                                                              | `{ name?, language? }`                                                                                                                                                                                                                      |
| DELETE | `/me`                                                              | `{ password?, reason? }`, deactivates the account and signs out everywhere (`password` is required when the account has one). Signing in again reactivates it                                                                               |
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

| Method     | Path                             | Access   | Body / notes                                                                                                                                                                                |
| ---------- | -------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET        | `/biodatas/me`                   | auth     | `{ biodata, completion }`, `biodata` is null before creation                                                                                                                                |
| POST       | `/biodatas/me`                   | verified | `{ pledge: true }`, accepts the pledge and creates an empty draft                                                                                                                           |
| PUT        | `/biodatas/me/sections/:section` | verified | `{ data }`, one section, validated with the shared definition. Editing an approved biodata sends it back to review. `EDIT_SUSPENDED` while staff have suspended editing                     |
| POST       | `/biodatas/me/submit`            | verified | Submits a complete biodata for review (`CORRECTIONS_PENDING` until every requested correction is changed)                                                                                   |
| PATCH      | `/biodatas/me/visibility`        | auth     | `{ hidden, reason?, note? }`, hiding needs a reason from `HIDE_REASONS` (and a note for `other`)                                                                                            |
| DELETE     | `/biodatas/me`                   | auth     | `{ reason, note?, marriage? }`, soft delete. With a marriage reason, `marriage` is `{ marriedOn?, place?, partnerBiodataNo?, partner?, story?, shareStory? }` and becomes a marriage report |
| POST       | `/biodatas/me/restore`           | auth     | Restores a deleted biodata that was never approved; otherwise `RESTORE_NEEDS_APPROVAL`                                                                                                      |
| GET / POST | `/biodatas/me/restore-request`   | auth     | `{ reason? }`, asks staff to restore a deleted biodata (`RESTORE_BLOCKED` after a permanent decline)                                                                                        |
| GET        | `/biodatas/partner-lookup`       | auth     | `?no=GH-1024`, the partner's public summary for the marriage form                                                                                                                           |
| GET        | `/biodatas/me/stats`             | auth     | Visits today / 7 days / 30 days, favourites                                                                                                                                                 |

Browsing and interacting (`:no` is a biodata number such as `GH-1005`):

| Method        | Path                        | Access   | Body / notes                                                                                                                                                                                                                                                                                                                                |
| ------------- | --------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET           | `/biodatas`                 | public   | Search. `?type&religion&marital&complexion&profession&economic&division&district&upazila&presentDistrict&presentUpazila&ageMin&ageMax&heightMin&heightMax&education&medium&category&q&sort&page&limit` (list filters take comma-separated values; `sort` is `newest`, `oldest`, …). Signed-in viewers also get `seen` and `favorited` flags |
| GET           | `/biodatas/location-counts` | public   | Same filters plus `scope=permanent\|present`: `{ divisions, districts, upazilas }` counts that ignore the location being picked                                                                                                                                                                                                             |
| GET           | `/biodatas/featured`        | public   | `?limit=` (1–12)                                                                                                                                                                                                                                                                                                                            |
| GET           | `/biodatas/:no`             | public   | Public profile (no private fields)                                                                                                                                                                                                                                                                                                          |
| POST          | `/biodatas/:no/visit`       | public   | Counts a profile visit (once per visitor per day)                                                                                                                                                                                                                                                                                           |
| GET           | `/biodatas/:no/viewer`      | auth     | The viewer's state: unlocked (with contact), favourite, dislike, proposal, `refunded`, `report: { status, ticketId }`                                                                                                                                                                                                                       |
| POST          | `/biodatas/:no/unlock`      | verified | Spends one connection (402 `INSUFFICIENT_CONNECTIONS`); unlocking again is free. Returns the guardian contact                                                                                                                                                                                                                               |
| POST / DELETE | `/biodatas/:no/favorite`    | auth     |                                                                                                                                                                                                                                                                                                                                             |
| POST / DELETE | `/biodatas/:no/dislike`     | auth     |                                                                                                                                                                                                                                                                                                                                             |
| POST          | `/biodatas/:no/proposals`   | verified | `{ message? }`                                                                                                                                                                                                                                                                                                                              |
| POST          | `/biodatas/:no/report`      | auth     | `{ reason, details?, attachments? }` (up to 5 ImgBB image links), opens a linked support ticket                                                                                                                                                                                                                                             |

## Packages, payments and refunds

| Method | Path                                                    | Access     | Body / notes                                                                                                                                                                                                                                                                                                                                              |
| ------ | ------------------------------------------------------- | ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/packages`                                             | public     | Active packages (with `discountPercent` and `finalPrice` for the viewer) and `checkout: { enabled }` (false until SSLCommerz is configured)                                                                                                                                                                                                               |
| POST   | `/payments`                                             | verified   | `{ packageId }`. Starts an SSLCommerz checkout and returns `{ payment, redirectURL }` (send the browser to `redirectURL`). `503 PAYMENTS_UNAVAILABLE` when SSLCommerz is not configured, `502 GATEWAY_ERROR` when it does not answer                                                                                                                      |
| GET    | `/payments/mine`                                        | auth       |                                                                                                                                                                                                                                                                                                                                                           |
| GET    | `/payments/status/:invoiceNo`                           | auth       | One of the member's own payments, for the receipt page                                                                                                                                                                                                                                                                                                    |
| POST   | `/gateway/sslcommerz/return`, `/gateway/sslcommerz/ipn` | SSLCommerz | Form posts from SSLCommerz (mounted outside the origin check). Every result is re-validated with SSLCommerz's validation API and the amount must match before connections are credited; repeated posts credit once. `return` redirects to `/dashboard/payment/<invoice>?result=success\|failed\|cancelled` on the website, `ipn` answers `{ ok, status }` |
| POST   | `/refunds`                                              | auth       | `{ paymentId, reason }`                                                                                                                                                                                                                                                                                                                                   |
| GET    | `/refunds/mine`                                         | auth       |                                                                                                                                                                                                                                                                                                                                                           |

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

| Method | Path                              | Permission     | Body / notes                                                                                                                                                                                                                     |
| ------ | --------------------------------- | -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/admin/users`                    | `users.view`   | `?q&role=user\|admin&status&verified`                                                                                                                                                                                            |
| GET    | `/admin/users/:id`                | `users.view`   | Account, biodata, payments, ledger, counts                                                                                                                                                                                       |
| PATCH  | `/admin/users/:id`                | `users.manage` | `{ name?, email?, phoneNumber?, role?, status?, statusReason?, emailVerified?, phoneNumberVerified? }`. Admins cannot change their own role or suspend themselves. Changing the role or suspending signs the user out everywhere |
| POST   | `/admin/users`                    | `users.manage` | `{ name, email, phoneNumber?, password, role? }`, an email + password account (default role `user`), treated as verified                                                                                                         |
| POST   | `/admin/users/:id/reset-password` | `users.manage` | `{ password }`, signs the user out everywhere                                                                                                                                                                                    |

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
