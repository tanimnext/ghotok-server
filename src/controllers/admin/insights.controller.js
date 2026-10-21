import { adminOverview, analytics as analyticsReport } from '../../services/analytics.service.js';
import { listAuditLogs } from '../../services/audit.service.js';
import { pageParams } from '../../utils/pagination.js';

export async function overview(req, res) {
  res.json(await adminOverview(req.user));
}

export async function analytics(req, res) {
  res.json(await analyticsReport(req.query.days));
}

export async function auditLogs(req, res) {
  res.json(await listAuditLogs(req.query, pageParams(req.query, { defaultLimit: 30 })));
}
