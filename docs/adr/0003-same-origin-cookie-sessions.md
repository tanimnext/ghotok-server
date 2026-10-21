# 0003. Same-origin API with cookie sessions and rotating refresh tokens

Status: Accepted

## Context

Members sign in on the website and staff in the admin panel, possibly on different domains.
Tokens in `localStorage` are exposed to any cross-site scripting bug; cross-origin cookies need
`SameSite=None` and CORS credentials, which are easy to misconfigure.

## Decision

- Each front-end serves the API under its own origin at `/api` (Next.js rewrite; nginx proxy for
  the admin panel). Cookies are first-party, `HttpOnly`, `SameSite=Lax`, and `Secure` in
  production.
- A 15-minute JWT access token, plus an opaque refresh token stored only as a hash. Refresh tokens
  rotate on every use; reusing an old one revokes the whole family.
- A non-secret `gh_session` cookie tells the front-ends whether to ask who is signed in.
- Unsafe methods must also come from an allowed `Origin`.

## Consequences

- No tokens are readable by JavaScript, and there is no CORS credential setup in production.
- Logging out everywhere, suspending a user or changing a role can revoke sessions immediately
  (the access token expires within 15 minutes at most).
- Every deployment must route `/api` on both front-end origins to the API (see DEPLOYMENT.md).
