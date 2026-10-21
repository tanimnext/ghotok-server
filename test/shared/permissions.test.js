import { describe, expect, it } from 'vitest';
import { shared } from '../../index.js';

const { DISTRICTS, DIVISIONS, PERMISSIONS, can, divisionOf, isStaff, toBnDigits } = shared;

describe('permissions', () => {
  it('gives members no admin access', () => {
    expect(isStaff('user')).toBe(false);
    expect(Object.keys(PERMISSIONS).some((p) => can('user', p))).toBe(false);
  });

  it('gives admins every permission', () => {
    expect(isStaff('admin')).toBe(true);
    expect(Object.keys(PERMISSIONS).every((p) => can('admin', p))).toBe(true);
  });

  it('knows no other roles', () => {
    expect(can('support', 'biodata.review')).toBe(false);
    expect(can('super_admin', 'settings.manage')).toBe(false);
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
