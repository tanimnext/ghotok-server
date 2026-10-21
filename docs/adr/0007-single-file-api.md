# 0007. The whole API in one file

Status: Accepted

## Context

The owner asked for the server repository to be "just Express and an `index.js`": one file to
open, instead of the routes → validations → controllers → services → models folders inherited
from the monorepo (0006). The behaviour, endpoints and tests had to stay the same.

## Decision

- `index.js` holds the entire API: configuration, the shared rules, models, integrations, Better
  Auth, services, validation schemas, serializers, middleware, controllers, routes, the Express
  app, the seed script and the start-up code.
- Each former module is a namespace object written as an immediately invoked function that
  returns its exports (`const biodataService = (() => { …; return { … }; })();`). Parts refer to
  each other as `namespace.name`, so a name never clashes with another part's private helpers
  and calls between services work in either direction at request time.
- Sections are ordered so that a part only uses parts above it while the file loads.
- `node index.js` starts the server; `node index.js seed [--demo]` seeds. Importing the file (as
  the tests do) starts nothing; it exports `createApp` and every namespace.

## Consequences

- One file to deploy and read top to bottom; search by namespace name to navigate.
- The file is long (about 11,000 lines, much of it the biodata definition, the upazila list and
  seed content). Editors still handle it well, but changes need care to keep the section order.
- The layering rules from the monorepo (routes call controllers, controllers call services,
  services own the business rules) still apply inside the file.
