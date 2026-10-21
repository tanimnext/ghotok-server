// Role-based access control, shared by the API (enforcement) and the admin panel (navigation).
import { ROLES } from './options.js';

const STAFF = [ROLES.SUPPORT, ROLES.SUPER_ADMIN];
const SUPER = [ROLES.SUPER_ADMIN];

export const PERMISSIONS = Object.freeze({
  'admin.access': STAFF,
  'overview.view': STAFF,
  'biodata.review': STAFF,
  'biodata.edit': STAFF,
  'nid.verify': STAFF,
  'reports.manage': STAFF,
  'tickets.manage': STAFF,
  'recovery.manage': STAFF,
  'users.view': STAFF,
  'users.manage': SUPER,
  'roles.assign': SUPER,
  'payments.manage': SUPER,
  'refunds.manage': SUPER,
  'connections.adjust': SUPER,
  'packages.manage': SUPER,
  'settings.manage': SUPER,
  'content.manage': SUPER,
  'analytics.view': SUPER,
  'audit.view': SUPER,
});

/** True when `role` has `permission`. */
export function can(role, permission) {
  return (PERMISSIONS[permission] ?? []).includes(role);
}

export function isStaff(role) {
  return STAFF.includes(role);
}
