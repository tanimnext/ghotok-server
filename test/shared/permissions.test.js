import { describe, expect, it } from 'vitest';
import { DISTRICTS, DIVISIONS, PERMISSIONS, can, divisionOf, isStaff, toBnDigits } from '../src/index.js';

describe('permissions', () => {
  it('gives members no admin access', () => {
    expect(isStaff('user')).toBe(false);
    expect(Object.keys(PERMISSIONS).some((p) => can('user', p))).toBe(false);
  });

  it('lets support reviewers moderate but not touch money or roles', () => {
    expect(can('support', 'biodata.review')).toBe(true);
    expect(can('support', 'nid.verify')).toBe(true);
    expect(can('support', 'payments.manage')).toBe(false);
    expect(can('support', 'roles.assign')).toBe(false);
  });

  it('gives super admins every permission', () => {
    expect(Object.keys(PERMISSIONS).every((p) => can('super_admin', p))).toBe(true);
  });
});

describe('locations', () => {
  it('lists the 8 divisions and 64 districts of Bangladesh', () => {
    expect(DIVISIONS).toHaveLength(8);
    expect(DISTRICTS).toHaveLength(64);
    expect(new Set(DISTRICTS.map((d) => d.value)).size).toBe(64);
    expect(divisionOf('sylhet')).toBe('sylhet');
    expect(divisionOf('gazipur')).toBe('dhaka');
  });
});

describe('toBnDigits', () => {
  it('converts digits only', () => {
    expect(toBnDigits('GH-1024, ৳500')).toBe('GH-১০২৪, ৳৫০০');
  });
});
