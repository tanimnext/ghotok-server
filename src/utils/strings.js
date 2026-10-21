/** Escapes a user-supplied string for safe use inside a RegExp. */
export function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** A comma-separated query value (or repeated param) → array of trimmed, non-empty strings. */
export function csv(value) {
  if (value === undefined || value === null || value === '') return [];
  return (Array.isArray(value) ? value : String(value).split(','))
    .map((s) => String(s).trim())
    .filter(Boolean);
}

/** Today's date (UTC) as YYYY-MM-DD. */
export function dayKey(date = new Date()) {
  return date.toISOString().slice(0, 10);
}
