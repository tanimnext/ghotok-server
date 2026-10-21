/**
 * Request details that services need without depending on Express.
 * @typedef {{ actor?: import('mongoose').Document, ip?: string, userAgent?: string }} RequestContext
 */

/** @returns {RequestContext} */
export function requestContext(req) {
  return {
    actor: req.user,
    ip: req.ip,
    userAgent: String(req.get('user-agent') ?? '').slice(0, 300),
  };
}
