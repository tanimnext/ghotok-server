# 0002. Define the biodata form once and derive everything from it

Status: Accepted

## Context

A biodata has ten sections and about 75 fields, some conditional (details about children only
appear for someone who has been married) and some private (parents' names, the guardian contact).
The same fields appear in the database, API validation, the member's editor, the public profile
and the admin review screen, in two languages. Maintaining five copies would guarantee drift.

## Decision

`shared/src/biodata.js` declares every section and field (type, options, rules, `showIf`,
`private`, bilingual labels). From it:

- the API generates the Mongoose sub-schemas and validates input with `validateSection`,
- the browser runs the same validator before saving,
- `@ghotok/ui` renders form controls (`BiodataField`) and read-only sections (`BiodataSections`),
- `publicSections()` removes private fields for public responses.

Fields that search needs are copied to indexed top-level fields in one model hook.

## Consequences

- Adding or changing a field is usually a one-file change.
- The definition must stay serialisable enough to share between Node.js and the browser (plain
  objects and small pure functions only).
- Searchable fields still need the model hook, an index and a filter (see CONTRIBUTING.md).
