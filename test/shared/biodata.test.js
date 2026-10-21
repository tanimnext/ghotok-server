import { describe, expect, it } from 'vitest';
import {
  BIODATA_SECTIONS,
  DISTRICTS,
  ageFromDob,
  biodataCompletion,
  formatFieldValue,
  getSection,
  isValidPhone,
  normalizePhone,
  publicSections,
  setFieldValue,
  upazilasOf,
  validateBiodata,
  validateSection,
} from '../src/index.js';

describe('normalizePhone / isValidPhone', () => {
  it.each([
    ['01712345678', '01712345678'],
    ['+8801712345678', '01712345678'],
    ['8801712345678', '01712345678'],
    ['017-1234 5678', '01712345678'],
    ['০১৭১২৩৪৫৬৭৮', '01712345678'],
  ])('normalises %s', (input, expected) => {
    expect(normalizePhone(input)).toBe(expected);
    expect(isValidPhone(input)).toBe(true);
  });

  it.each(['01212345678', '0171234567', '1712345678', 'abc'])('rejects %s', (input) => {
    expect(isValidPhone(input)).toBe(false);
  });
});

describe('ageFromDob', () => {
  it('counts whole years and respects birthdays', () => {
    const now = new Date('2026-06-15T00:00:00Z');
    expect(ageFromDob('2000-06-15', now)).toBe(26);
    expect(ageFromDob('2000-06-16', now)).toBe(25);
    expect(ageFromDob(undefined, now)).toBeNull();
  });
});

describe('validateSection', () => {
  const general = {
    biodataType: 'bride',
    maritalStatus: 'never_married',
    religion: 'hindu',
    dateOfBirth: '1999-02-03',
    height: '63',
    complexion: 'fair',
    nationality: ' Bangladeshi ',
  };

  it('cleans valid values (trims text, converts numeric selects)', () => {
    const { value, errors } = validateSection('general', general);
    expect(errors).toEqual({});
    expect(value.height).toBe(63);
    expect(value.nationality).toBe('Bangladeshi');
  });

  it('reports missing required fields unless saving a draft', () => {
    expect(validateSection('general', {}).errors.religion).toBe('required');
    expect(validateSection('general', {}, { partial: true }).errors).toEqual({});
  });

  it('rejects values outside the option lists, even in drafts', () => {
    const { errors } = validateSection('general', { religion: 'jedi' }, { partial: true });
    expect(errors.religion).toBe('invalid');
  });

  it('enforces the minimum age of 18', () => {
    const year = new Date().getFullYear() - 10;
    const { errors } = validateSection('general', { ...general, dateOfBirth: `${year}-01-01` });
    expect(errors.dateOfBirth).toBe('age_min');
  });

  it('only asks about a previous marriage when the person has been married', () => {
    const married = { general: { maritalStatus: 'divorced' } };
    const single = { general: { maritalStatus: 'never_married' } };
    expect(
      validateSection('marriage', { guardiansAgree: 'yes' }, { biodata: married }).errors.previousMarriage,
    ).toBe('required');
    const { value, errors } = validateSection(
      'marriage',
      { guardiansAgree: 'yes', previousMarriage: 'x' },
      { biodata: single },
    );
    expect(errors).toEqual({});
    expect(value.previousMarriage).toBeUndefined();
  });

  it('checks cross-field ranges in the partner section', () => {
    const { errors } = validateSection('partner', {
      ageMin: 30,
      ageMax: 25,
      qualities: 'Kind and honest person, please.',
    });
    expect(errors.ageMax).toBe('range');
  });

  it('requires "yes" to every declaration before submitting', () => {
    const { errors } = validateSection('pledge', {
      parentsKnow: 'no',
      infoTrue: 'yes',
      acceptResponsibility: 'yes',
    });
    expect(errors.parentsKnow).toBe('must_agree');
    expect(validateSection('pledge', { parentsKnow: 'no' }, { partial: true }).errors).toEqual({});
  });

  it('normalises contact numbers and emails', () => {
    const { value, errors } = validateSection(
      'contact',
      { guardianPhone: '+880 1812-345678', contactEmail: 'Family@Example.COM' },
      { partial: true },
    );
    expect(errors).toEqual({});
    expect(value).toEqual({ guardianPhone: '01812345678', contactEmail: 'family@example.com' });
  });
});

describe('biodataCompletion / validateBiodata', () => {
  it('reports every section incomplete for an empty biodata', () => {
    const c = biodataCompletion({});
    expect(c.total).toBe(BIODATA_SECTIONS.length);
    expect(c.done).toBe(0);
    expect(c.complete).toBe(false);
    expect(Object.keys(validateBiodata({}))).toHaveLength(BIODATA_SECTIONS.length);
  });
});

describe('publicSections', () => {
  it('never exposes private fields or the contact section', () => {
    const out = publicSections({
      family: { fatherName: 'Secret', fatherOccupation: 'Teacher' },
      contact: { guardianPhone: '01712345678' },
    });
    expect(out.contact).toBeUndefined();
    expect(out.family).toEqual({ fatherOccupation: 'Teacher' });
  });

  it('marks every contact field as private', () => {
    expect(getSection('contact').fields.every((f) => f.private)).toBe(true);
  });
});

describe('formatFieldValue', () => {
  it('formats options, districts and dates in both languages', () => {
    const religion = getSection('general').fields.find((f) => f.key === 'religion');
    expect(formatFieldValue(religion, 'buddhist', 'bn')).toBe('বৌদ্ধ');
    const district = getSection('address').fields.find((f) => f.key === 'permanentDistrict');
    expect(formatFieldValue(district, 'coxs_bazar', 'en')).toBe('Cox’s Bazar');
    const dob = getSection('general').fields.find((f) => f.key === 'dateOfBirth');
    expect(formatFieldValue(dob, '1999-02-03', 'en')).toBe('3 February 1999');
  });
});

describe('upazilas', () => {
  const address = {
    permanentDivision: 'dhaka',
    permanentDistrict: 'dhaka',
    presentLocation: 'bangladesh',
    presentDistrict: 'gazipur',
  };

  it('accepts an upazila or city corporation of the chosen district', () => {
    const { value, errors } = validateSection(
      'address',
      { ...address, permanentUpazila: 'dhaka_dhaka_south_cc', presentUpazila: 'gazipur_kaliakair' },
      { partial: true },
    );
    expect(errors).toEqual({});
    expect(value.permanentUpazila).toBe('dhaka_dhaka_south_cc');
    expect(value.presentUpazila).toBe('gazipur_kaliakair');
  });

  it('rejects an upazila from another district', () => {
    const { value, errors } = validateSection(
      'address',
      { ...address, permanentUpazila: 'gazipur_kaliakair' },
      { partial: true },
    );
    expect(errors.permanentUpazila).toBe('invalid');
    expect(value.permanentUpazila).toBeUndefined();
  });

  it('has an upazila list for every district', () => {
    for (const d of DISTRICTS) expect(upazilasOf(d.value).length, d.value).toBeGreaterThan(0);
  });

  it('formats an upazila in both languages', () => {
    const field = getSection('address').fields.find((f) => f.key === 'permanentUpazila');
    expect(formatFieldValue(field, 'dhaka_dhaka_south_cc', 'en')).toBe('Dhaka South City Corporation');
    expect(formatFieldValue(field, 'dhaka_dhaka_south_cc', 'bn')).toBe('ঢাকা দক্ষিণ সিটি কর্পোরেশন');
  });
});

describe('public date of birth', () => {
  it('shows only the month and year of birth', () => {
    const pub = publicSections({ general: { dateOfBirth: '2001-03-14', biodataType: 'bride' } });
    expect(pub.general.dateOfBirth).toBe('2001-03');
    const field = getSection('general').fields.find((f) => f.key === 'dateOfBirth');
    expect(formatFieldValue(field, '2001-03', 'en')).toBe('March 2001');
    expect(formatFieldValue(field, '2001-03-14', 'en')).toBe('14 March 2001');
  });
});

describe('setFieldValue', () => {
  it('clears dependent location fields down the chain', () => {
    const section = getSection('address');
    const values = {
      permanentDivision: 'dhaka',
      permanentDistrict: 'dhaka',
      permanentUpazila: 'dhaka_dohar',
      grewUpAt: 'Dhaka',
    };
    const next = setFieldValue(section, values, 'permanentDivision', 'khulna');
    expect(next).toEqual({
      permanentDivision: 'khulna',
      permanentDistrict: '',
      permanentUpazila: '',
      grewUpAt: 'Dhaka',
    });
    expect(setFieldValue(section, values, 'permanentDistrict', 'gazipur').permanentUpazila).toBe('');
  });
});

describe('legal minimum age', () => {
  const dobForAge = (years) => {
    const d = new Date();
    d.setUTCFullYear(d.getUTCFullYear() - years);
    d.setUTCDate(d.getUTCDate() - 7);
    return d.toISOString().slice(0, 10);
  };

  it('requires grooms to be 21 and brides 18', () => {
    const general = {
      maritalStatus: 'never_married',
      religion: 'islam',
      height: 66,
      complexion: 'fair',
      nationality: 'Bangladeshi',
    };
    const groom19 = validateSection(
      'general',
      { ...general, biodataType: 'groom', dateOfBirth: dobForAge(19) },
      { partial: true },
    );
    expect(groom19.errors.dateOfBirth).toBe('age_min_groom');
    const groom21 = validateSection(
      'general',
      { ...general, biodataType: 'groom', dateOfBirth: dobForAge(21) },
      { partial: true },
    );
    expect(groom21.errors.dateOfBirth).toBeUndefined();
    const bride19 = validateSection(
      'general',
      { ...general, biodataType: 'bride', dateOfBirth: dobForAge(19) },
      { partial: true },
    );
    expect(bride19.errors.dateOfBirth).toBeUndefined();
  });
});
