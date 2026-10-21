# 0006. Separate client and server repositories, Better Auth, and images on ImgBB

Status: Accepted

## Context

The owner wanted the backend and frontend in two repositories (`ghotok-server` and
`ghotok-client`), authentication on Better Auth with two roles (members and admins, where admins
are made in the database), and images uploaded from the browser to ImgBB. Profile photos and NID
uploads were dropped from the product.

## Decision

- The Express API is a standalone repository. The rules the client also needs (biodata
  definition, options, locations, permissions) are copied into `src/shared` here and into the
  client, instead of a shared package.
- Better Auth 1.7 handles accounts and sessions at `/api/auth`, using the same MongoDB database
  through its MongoDB adapter. The Mongoose `User` model maps Better Auth's `user` collection.
- `role` is a Better Auth field with `input: false` and a database hook that forces `user` on
  every new account. Only server code (the seed, an admin) sets `admin`.
- The client proxies `/api/*` to the API, so Better Auth's cookie is first-party and the
  same-origin design of decision 0003 still holds without refresh tokens of our own.
- The API stores ImgBB links and accepts only ImgBB hosts; it keeps no files.

## Consequences

- No more maintenance of hand-written token rotation, OTP storage or OAuth flows.
- The duplicated `shared` code must be changed in both repositories; the READMEs say so.
- ImgBB links are public to anyone who has them, which is acceptable for support screenshots and
  banners but is why personal documents are no longer collected.
- Better Auth's error bodies (`{ code, message }`) differ from the API's (`{ error: { … } }`); the
  client handles both.
