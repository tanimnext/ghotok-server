import { validationError } from '../utils/api-error.js';

/** Converts zod issues to `{ "field.path": "message" }`, keeping the first message per field. */
export function zodFields(error) {
  const fields = {};
  for (const issue of error.issues) {
    const key = issue.path.join('.') || '_';
    if (!fields[key]) fields[key] = issue.message;
  }
  return fields;
}

/** Parses `data` with a zod schema or throws a 400 VALIDATION_ERROR. */
export function parseOrThrow(schema, data) {
  const result = schema.safeParse(data ?? {});
  if (!result.success) throw validationError(zodFields(result.error));
  return result.data;
}

/**
 * Route middleware that validates and normalises request input with zod schemas.
 * Parsed values replace `req.body`, `req.query` and `req.params`, so controllers
 * only ever see clean data.
 *
 * @example router.post('/login', validate({ body: loginSchema }), controller.login)
 */
export function validate({ body, query, params } = {}) {
  return (req, _res, next) => {
    if (params) req.params = parseOrThrow(params, req.params);
    // Express 5 exposes req.query as a getter, so it is redefined rather than assigned.
    if (query) Object.defineProperty(req, 'query', { value: parseOrThrow(query, req.query), writable: true });
    if (body) req.body = parseOrThrow(body, req.body);
    next();
  };
}
