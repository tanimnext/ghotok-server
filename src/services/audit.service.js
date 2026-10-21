import { logger } from '../config/logger.js';
import { AuditLog } from '../models/index.js';
import { escapeRegex } from '../utils/strings.js';
import { paginate } from '../utils/pagination.js';
import { toUserSummary } from '../serializers/user.serializer.js';

/**
 * Records a staff or security-relevant action. Never throws: an audit failure
 * must not undo the action it describes.
 * @param {import('../utils/request.js').RequestContext} ctx
 * @param {string} action dotted name, e.g. "payment.verify"
 */
export async function recordAudit(ctx, action, { targetType, targetId, summary, meta } = {}) {
  try {
    await AuditLog.create({
      actor: ctx?.actor?._id,
      actorRole: ctx?.actor?.role,
      action,
      targetType,
      targetId: targetId ? String(targetId) : undefined,
      summary,
      meta,
      ip: ctx?.ip,
    });
  } catch (err) {
    logger.error({ err, action }, 'Audit log write failed');
  }
}

export function listAuditLogs({ action, targetId }, params) {
  const filter = {};
  if (action) filter.action = new RegExp(`^${escapeRegex(action)}`);
  if (targetId) filter.targetId = targetId;
  return paginate(
    AuditLog.find(filter).sort({ createdAt: -1 }).populate('actor', 'name email phone role status').lean(),
    AuditLog.countDocuments(filter),
    params,
    (a) => ({
      id: a._id,
      action: a.action,
      summary: a.summary ?? null,
      targetType: a.targetType ?? null,
      targetId: a.targetId ?? null,
      meta: a.meta ?? null,
      ip: a.ip ?? null,
      createdAt: a.createdAt,
      actor: toUserSummary(a.actor),
    }),
  );
}
