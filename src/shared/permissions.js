// Role-based access control. The API enforces it; the client uses the same map to show
// or hide admin screens. There are two roles: members ("user") and admins ("admin").
import { ROLES } from './options.js';

const ADMIN = [ROLES.ADMIN];

export const PERMISSIONS = Object.freeze({
  'admin.access': ADMIN,
  'overview.view': ADMIN,
  'biodata.review': ADMIN,
  'biodata.edit': ADMIN,
  'reports.manage': ADMIN,
  'tickets.manage': ADMIN,
  'recovery.manage': ADMIN,
  'users.view': ADMIN,
  'users.manage': ADMIN,
  'roles.assign': ADMIN,
  'payments.manage': ADMIN,
  'refunds.manage': ADMIN,
  'connections.adjust': ADMIN,
  'packages.manage': ADMIN,
  'settings.manage': ADMIN,
  'content.manage': ADMIN,
  'analytics.view': ADMIN,
  'audit.view': ADMIN,
});

/** True when `role` has `permission`. */
export function can(role, permission) {
  return (PERMISSIONS[permission] ?? []).includes(role);
}

/** True for accounts that can open the admin panel. */
export function isStaff(role) {
  return role === ROLES.ADMIN;
}
