# 0001. A JavaScript MERN monorepo with shared packages

Status: Accepted

## Context

The product needs a public, search-engine-friendly website, an internal admin panel and an API,
maintained by a small team. The specification asked for a Next.js client, a React admin panel, a
Node.js/Express API and MongoDB, written in JavaScript.

## Decision

- One repository with npm workspaces: `server`, `web`, `admin`, plus `shared` (rules, constants,
  API client) and `ui` (React components) used by the others as source.
- JavaScript (ES modules) throughout. Zod validates every API input, JSDoc documents the
  non-obvious functions, and the tests cover behaviour.
- Next.js for the website (server rendering for SEO); Vite and React Router for the admin panel,
  which needs no SEO and benefits from a simple static deployment.

## Consequences

- A change that spans layers (a new biodata field, a new permission) is one pull request.
- Labels, option lists, permissions and the biodata form exist once, so the apps cannot drift.
- Without a type checker, the API's Zod schemas and the tests are the safety net; keep both
  current.
- `npm ci` installs every workspace; Docker builds install only what one app needs.
