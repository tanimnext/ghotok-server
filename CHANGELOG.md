# Changelog

All notable changes to this project are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and versions follow
[Semantic Versioning](https://semver.org/).

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
