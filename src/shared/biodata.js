// The biodata form, defined once and used everywhere:
// - the API validates and stores sections with it,
// - the web client renders the multi-step editor and the public profile from it,
// - the admin panel renders full biodatas for review from it.

import {
  ALIVE_STATUS,
  BIODATA_TYPES,
  BLOOD_GROUPS,
  COMPLEXIONS,
  DIET,
  ECONOMIC_STATUS,
  EDUCATION_LEVELS,
  EDUCATION_MEDIUMS,
  GUARDIAN_RELATIONS,
  HEIGHTS,
  INCOME_RANGES,
  MARITAL_STATUS,
  PRESENT_LOCATION,
  PROFESSIONS,
  RELIGIONS,
  SPECIAL_CATEGORIES,
  YES_NO,
} from './options.js';
import { DISTRICTS, DIVISION_OPTIONS } from './locations.js';
import { UPAZILAS, districtOfUpazila } from './upazilas.js';

/** Minimum age for a groom's biodata (Child Marriage Restraint Act 2017). Brides: 18, set on the field. */
export const GROOM_MIN_AGE = 21;

const notNeverMarried = (b) => !!b?.general?.maritalStatus && b.general.maritalStatus !== 'never_married';

export const BIODATA_SECTIONS = [
  {
    key: 'general',
    title: { en: 'General information', bn: 'সাধারণ তথ্য' },
    fields: [
      {
        key: 'biodataType',
        type: 'select',
        options: BIODATA_TYPES,
        required: true,
        label: { en: 'Biodata type', bn: 'বায়োডাটার ধরন' },
      },
      {
        key: 'maritalStatus',
        type: 'select',
        options: MARITAL_STATUS,
        required: true,
        label: { en: 'Marital status', bn: 'বৈবাহিক অবস্থা' },
      },
      {
        key: 'religion',
        type: 'select',
        options: RELIGIONS,
        required: true,
        label: { en: 'Religion', bn: 'ধর্ম' },
      },
      {
        key: 'religiousIdentity',
        type: 'text',
        maxLength: 80,
        label: { en: 'Community / caste / denomination', bn: 'সম্প্রদায় / বর্ণ / শাখা' },
        help: {
          en: 'Optional. For example: Brahmin, Sunni, Catholic, Theravada.',
          bn: 'ঐচ্ছিক। যেমন: ব্রাহ্মণ, সুন্নি, ক্যাথলিক, থেরবাদ।',
        },
      },
      {
        key: 'dateOfBirth',
        type: 'date',
        required: true,
        // Public profiles show only the month and year of birth.
        publicPrecision: 'month',
        minAge: 18,
        maxAge: 80,
        label: { en: 'Date of birth', bn: 'জন্ম তারিখ' },
      },
      {
        key: 'height',
        type: 'select',
        options: HEIGHTS,
        numeric: true,
        required: true,
        label: { en: 'Height', bn: 'উচ্চতা' },
      },
      { key: 'weight', type: 'number', min: 30, max: 200, label: { en: 'Weight (kg)', bn: 'ওজন (কেজি)' } },
      {
        key: 'complexion',
        type: 'select',
        options: COMPLEXIONS,
        required: true,
        label: { en: 'Complexion', bn: 'গাত্রবর্ণ' },
      },
      {
        key: 'bloodGroup',
        type: 'select',
        options: BLOOD_GROUPS,
        label: { en: 'Blood group', bn: 'রক্তের গ্রুপ' },
      },
      {
        key: 'nationality',
        type: 'text',
        maxLength: 60,
        required: true,
        defaultValue: 'Bangladeshi',
        label: { en: 'Nationality', bn: 'জাতীয়তা' },
      },
    ],
    // The legal minimum age of marriage in Bangladesh is 21 for men and 18 for women.
    validate: (v) =>
      v.biodataType === 'groom' && v.dateOfBirth && ageFromDob(v.dateOfBirth) < GROOM_MIN_AGE
        ? { dateOfBirth: 'age_min_groom' }
        : {},
  },
  {
    key: 'address',
    title: { en: 'Address', bn: 'ঠিকানা' },
    fields: [
      {
        key: 'permanentDivision',
        type: 'select',
        options: DIVISION_OPTIONS,
        required: true,
        label: { en: 'Permanent address: division', bn: 'স্থায়ী ঠিকানা: বিভাগ' },
      },
      {
        key: 'permanentDistrict',
        type: 'district',
        divisionField: 'permanentDivision',
        required: true,
        label: { en: 'Permanent address: district', bn: 'স্থায়ী ঠিকানা: জেলা' },
      },
      {
        key: 'permanentUpazila',
        type: 'upazila',
        districtField: 'permanentDistrict',
        label: { en: 'Permanent address: upazila / city', bn: 'স্থায়ী ঠিকানা: উপজেলা / সিটি' },
      },
      {
        key: 'permanentArea',
        type: 'text',
        maxLength: 120,
        label: { en: 'Permanent address: area or village', bn: 'স্থায়ী ঠিকানা: এলাকা বা গ্রাম' },
      },
      {
        key: 'presentLocation',
        type: 'select',
        options: PRESENT_LOCATION,
        required: true,
        label: { en: 'Where do you live now?', bn: 'বর্তমানে কোথায় থাকেন?' },
      },
      {
        key: 'presentDistrict',
        type: 'district',
        required: true,
        label: { en: 'Present address: district', bn: 'বর্তমান ঠিকানা: জেলা' },
        showIf: (b) => b?.address?.presentLocation === 'bangladesh',
      },
      {
        key: 'presentUpazila',
        type: 'upazila',
        districtField: 'presentDistrict',
        label: { en: 'Present address: upazila / city', bn: 'বর্তমান ঠিকানা: উপজেলা / সিটি' },
        showIf: (b) => b?.address?.presentLocation === 'bangladesh',
      },
      {
        key: 'presentCountry',
        type: 'text',
        maxLength: 60,
        required: true,
        label: { en: 'Present address: country', bn: 'বর্তমান ঠিকানা: দেশ' },
        showIf: (b) => b?.address?.presentLocation === 'abroad',
      },
      {
        key: 'grewUpAt',
        type: 'text',
        maxLength: 120,
        label: { en: 'Where did you grow up?', bn: 'কোথায় বড় হয়েছেন?' },
      },
    ],
  },
  {
    key: 'education',
    title: { en: 'Education', bn: 'শিক্ষাগত যোগ্যতা' },
    fields: [
      {
        key: 'educationMedium',
        type: 'select',
        options: EDUCATION_MEDIUMS,
        required: true,
        label: { en: 'Education medium', bn: 'পড়াশোনার মাধ্যম' },
      },
      {
        key: 'highestEducation',
        type: 'select',
        options: EDUCATION_LEVELS,
        required: true,
        label: { en: 'Highest education', bn: 'সর্বোচ্চ শিক্ষাগত যোগ্যতা' },
      },
      {
        key: 'institution',
        type: 'text',
        maxLength: 120,
        label: { en: 'Institution of highest degree', bn: 'সর্বোচ্চ ডিগ্রির প্রতিষ্ঠান' },
      },
      { key: 'subject', type: 'text', maxLength: 120, label: { en: 'Subject / group', bn: 'বিষয় / বিভাগ' } },
      {
        key: 'sscDetails',
        type: 'text',
        maxLength: 120,
        label: { en: 'SSC or equivalent (year, group, result)', bn: 'এসএসসি বা সমমান (সাল, বিভাগ, ফলাফল)' },
      },
      {
        key: 'hscDetails',
        type: 'text',
        maxLength: 120,
        label: { en: 'HSC or equivalent (year, group, result)', bn: 'এইচএসসি বা সমমান (সাল, বিভাগ, ফলাফল)' },
      },
      {
        key: 'otherQualifications',
        type: 'textarea',
        maxLength: 600,
        label: { en: 'Other qualifications', bn: 'অন্যান্য যোগ্যতা' },
      },
    ],
  },
  {
    key: 'family',
    title: { en: 'Family information', bn: 'পারিবারিক তথ্য' },
    fields: [
      {
        key: 'fatherName',
        type: 'text',
        maxLength: 80,
        required: true,
        private: true,
        label: { en: 'Father’s name', bn: 'পিতার নাম' },
      },
      {
        key: 'fatherAlive',
        type: 'select',
        options: ALIVE_STATUS,
        required: true,
        label: { en: 'Is your father alive?', bn: 'পিতা জীবিত কি?' },
      },
      {
        key: 'fatherOccupation',
        type: 'text',
        maxLength: 120,
        required: true,
        label: { en: 'Father’s occupation', bn: 'পিতার পেশা' },
      },
      {
        key: 'motherName',
        type: 'text',
        maxLength: 80,
        required: true,
        private: true,
        label: { en: 'Mother’s name', bn: 'মাতার নাম' },
      },
      {
        key: 'motherAlive',
        type: 'select',
        options: ALIVE_STATUS,
        required: true,
        label: { en: 'Is your mother alive?', bn: 'মাতা জীবিত কি?' },
      },
      {
        key: 'motherOccupation',
        type: 'text',
        maxLength: 120,
        required: true,
        label: { en: 'Mother’s occupation', bn: 'মাতার পেশা' },
      },
      {
        key: 'brothersCount',
        type: 'number',
        min: 0,
        max: 20,
        required: true,
        label: { en: 'Number of brothers', bn: 'ভাইয়ের সংখ্যা' },
      },
      {
        key: 'brothersInfo',
        type: 'textarea',
        maxLength: 600,
        label: { en: 'About your brothers', bn: 'ভাইদের সম্পর্কে' },
      },
      {
        key: 'sistersCount',
        type: 'number',
        min: 0,
        max: 20,
        required: true,
        label: { en: 'Number of sisters', bn: 'বোনের সংখ্যা' },
      },
      {
        key: 'sistersInfo',
        type: 'textarea',
        maxLength: 600,
        label: { en: 'About your sisters', bn: 'বোনদের সম্পর্কে' },
      },
      {
        key: 'unclesInfo',
        type: 'textarea',
        maxLength: 600,
        label: { en: 'Uncles and their occupations', bn: 'চাচা/মামাদের পেশা' },
      },
      {
        key: 'economicStatus',
        type: 'select',
        options: ECONOMIC_STATUS,
        required: true,
        label: { en: 'Family economic status', bn: 'পারিবারিক আর্থিক অবস্থা' },
      },
      {
        key: 'economicDetails',
        type: 'textarea',
        maxLength: 600,
        label: { en: 'Details of economic status', bn: 'আর্থিক অবস্থার বিবরণ' },
      },
      {
        key: 'familyValues',
        type: 'textarea',
        maxLength: 600,
        label: { en: 'Family values and religious environment', bn: 'পারিবারিক মূল্যবোধ ও ধর্মীয় পরিবেশ' },
      },
    ],
  },
  {
    key: 'personal',
    title: { en: 'Personal information', bn: 'ব্যক্তিগত তথ্য' },
    fields: [
      {
        key: 'aboutMe',
        type: 'textarea',
        minLength: 30,
        maxLength: 1500,
        required: true,
        label: { en: 'Write about yourself', bn: 'নিজের সম্পর্কে লিখুন' },
      },
      {
        key: 'religiousPractice',
        type: 'textarea',
        maxLength: 800,
        label: { en: 'Your religious practice', bn: 'আপনার ধর্মীয় অনুশীলন' },
      },
      { key: 'diet', type: 'select', options: DIET, label: { en: 'Diet', bn: 'খাদ্যাভ্যাস' } },
      {
        key: 'smoking',
        type: 'select',
        options: YES_NO,
        required: true,
        label: { en: 'Do you smoke?', bn: 'ধূমপান করেন?' },
      },
      {
        key: 'healthIssues',
        type: 'textarea',
        maxLength: 600,
        label: {
          en: 'Physical or mental health conditions, if any',
          bn: 'শারীরিক বা মানসিক অসুস্থতা (যদি থাকে)',
        },
      },
      {
        key: 'hobbies',
        type: 'textarea',
        maxLength: 600,
        label: { en: 'Hobbies and interests', bn: 'শখ ও আগ্রহ' },
      },
      {
        key: 'languages',
        type: 'text',
        maxLength: 120,
        label: { en: 'Languages you speak', bn: 'যে ভাষায় কথা বলেন' },
      },
      {
        key: 'specialCategories',
        type: 'multiselect',
        options: SPECIAL_CATEGORIES,
        label: {
          en: 'Do any of these apply to you? (optional)',
          bn: 'এগুলোর কোনোটি কি আপনার ক্ষেত্রে প্রযোজ্য? (ঐচ্ছিক)',
        },
        help: {
          en: 'Families looking for someone in the same situation can find you with the search filters.',
          bn: 'একই অবস্থার কাউকে খুঁজছেন এমন পরিবার সার্চ ফিল্টারে আপনাকে খুঁজে পাবেন।',
        },
      },
    ],
  },
  {
    key: 'occupation',
    title: { en: 'Occupation', bn: 'পেশাগত তথ্য' },
    fields: [
      {
        key: 'profession',
        type: 'select',
        options: PROFESSIONS,
        required: true,
        label: { en: 'Profession', bn: 'পেশা' },
      },
      {
        key: 'jobTitle',
        type: 'text',
        maxLength: 120,
        label: { en: 'Job title and organisation', bn: 'পদবি ও প্রতিষ্ঠান' },
      },
      {
        key: 'occupationDetails',
        type: 'textarea',
        maxLength: 800,
        label: { en: 'Details about your work', bn: 'কাজের বিস্তারিত' },
      },
      {
        key: 'monthlyIncome',
        type: 'select',
        options: INCOME_RANGES,
        label: { en: 'Monthly income', bn: 'মাসিক আয়' },
      },
    ],
  },
  {
    key: 'marriage',
    title: { en: 'Marriage-related information', bn: 'বিয়ে সংক্রান্ত তথ্য' },
    fields: [
      {
        key: 'guardiansAgree',
        type: 'select',
        options: YES_NO,
        required: true,
        label: { en: 'Do your guardians agree to your marriage?', bn: 'অভিভাবক কি আপনার বিয়েতে রাজি?' },
      },
      {
        key: 'previousMarriage',
        type: 'textarea',
        maxLength: 800,
        required: true,
        showIf: notNeverMarried,
        label: { en: 'About your previous marriage', bn: 'পূর্ববর্তী বিয়ে সম্পর্কে' },
      },
      {
        key: 'children',
        type: 'textarea',
        maxLength: 400,
        showIf: notNeverMarried,
        label: { en: 'Do you have children? Details', bn: 'সন্তান আছে কি? বিস্তারিত' },
      },
      {
        key: 'careerAfterMarriage',
        type: 'textarea',
        maxLength: 600,
        label: { en: 'Study or work plans after marriage', bn: 'বিয়ের পর পড়াশোনা বা চাকরি করার ইচ্ছা' },
      },
      {
        key: 'residenceAfterMarriage',
        type: 'textarea',
        maxLength: 600,
        label: { en: 'Where do you plan to live after marriage?', bn: 'বিয়ের পর কোথায় থাকতে চান?' },
      },
      {
        key: 'thoughtsOnMarriage',
        type: 'textarea',
        maxLength: 800,
        label: { en: 'Your thoughts on marriage', bn: 'বিয়ে সম্পর্কে আপনার ভাবনা' },
      },
    ],
  },
  {
    key: 'partner',
    title: { en: 'Expected life partner', bn: 'প্রত্যাশিত জীবনসঙ্গী' },
    fields: [
      {
        key: 'ageMin',
        type: 'number',
        min: 18,
        max: 80,
        required: true,
        label: { en: 'Minimum age', bn: 'সর্বনিম্ন বয়স' },
      },
      {
        key: 'ageMax',
        type: 'number',
        min: 18,
        max: 80,
        required: true,
        label: { en: 'Maximum age', bn: 'সর্বোচ্চ বয়স' },
      },
      {
        key: 'heightMin',
        type: 'select',
        options: HEIGHTS,
        numeric: true,
        label: { en: 'Minimum height', bn: 'সর্বনিম্ন উচ্চতা' },
      },
      {
        key: 'heightMax',
        type: 'select',
        options: HEIGHTS,
        numeric: true,
        label: { en: 'Maximum height', bn: 'সর্বোচ্চ উচ্চতা' },
      },
      { key: 'religions', type: 'multiselect', options: RELIGIONS, label: { en: 'Religion', bn: 'ধর্ম' } },
      {
        key: 'maritalStatuses',
        type: 'multiselect',
        options: MARITAL_STATUS,
        label: { en: 'Marital status', bn: 'বৈবাহিক অবস্থা' },
      },
      {
        key: 'complexions',
        type: 'multiselect',
        options: COMPLEXIONS,
        label: { en: 'Complexion', bn: 'গাত্রবর্ণ' },
      },
      {
        key: 'minEducation',
        type: 'select',
        options: EDUCATION_LEVELS,
        label: { en: 'Minimum education', bn: 'সর্বনিম্ন শিক্ষাগত যোগ্যতা' },
      },
      {
        key: 'districts',
        type: 'text',
        maxLength: 200,
        label: { en: 'Preferred districts', bn: 'পছন্দের জেলা' },
      },
      {
        key: 'profession',
        type: 'text',
        maxLength: 200,
        label: { en: 'Preferred profession', bn: 'পছন্দের পেশা' },
      },
      {
        key: 'economicStatus',
        type: 'multiselect',
        options: ECONOMIC_STATUS,
        label: { en: 'Family economic status', bn: 'পারিবারিক আর্থিক অবস্থা' },
      },
      {
        key: 'qualities',
        type: 'textarea',
        minLength: 20,
        maxLength: 1200,
        required: true,
        label: { en: 'Qualities you expect', bn: 'যেসব গুণ প্রত্যাশা করেন' },
      },
    ],
    validate: (v) => {
      const errors = {};
      if (v.ageMin != null && v.ageMax != null && v.ageMin > v.ageMax) errors.ageMax = 'range';
      if (v.heightMin != null && v.heightMax != null && v.heightMin > v.heightMax) errors.heightMax = 'range';
      return errors;
    },
  },
  {
    key: 'pledge',
    title: { en: 'Declaration', bn: 'অঙ্গীকার' },
    fields: [
      {
        key: 'parentsKnow',
        type: 'select',
        options: YES_NO,
        required: true,
        mustBe: 'yes',
        label: {
          en: 'Do your guardians know you are submitting this biodata?',
          bn: 'অভিভাবক কি জানেন আপনি এই বায়োডাটা জমা দিচ্ছেন?',
        },
      },
      {
        key: 'infoTrue',
        type: 'select',
        options: YES_NO,
        required: true,
        mustBe: 'yes',
        label: { en: 'Is all the information you have given true?', bn: 'আপনার দেওয়া সব তথ্য কি সত্য?' },
      },
      {
        key: 'acceptResponsibility',
        type: 'select',
        options: YES_NO,
        required: true,
        mustBe: 'yes',
        label: {
          en: 'I accept that if I give false information, I alone am responsible for the consequences.',
          bn: 'মিথ্যা তথ্য দিলে এর সম্পূর্ণ দায় আমার, তা আমি মেনে নিচ্ছি।',
        },
      },
    ],
  },
  {
    key: 'contact',
    title: { en: 'Contact information', bn: 'যোগাযোগের তথ্য' },
    private: true,
    description: {
      en: 'Kept private. Shown only to people who unlock your contact with a connection.',
      bn: 'গোপন রাখা হয়। শুধু যারা কানেকশন দিয়ে আনলক করবেন তারাই দেখতে পাবেন।',
    },
    fields: [
      {
        key: 'candidateName',
        type: 'text',
        maxLength: 80,
        required: true,
        private: true,
        label: { en: 'Your full name', bn: 'আপনার পূর্ণ নাম' },
      },
      {
        key: 'guardianName',
        type: 'text',
        maxLength: 80,
        required: true,
        private: true,
        label: { en: 'Guardian’s name', bn: 'অভিভাবকের নাম' },
      },
      {
        key: 'guardianRelation',
        type: 'select',
        options: GUARDIAN_RELATIONS,
        required: true,
        private: true,
        label: { en: 'Relationship with guardian', bn: 'অভিভাবকের সাথে সম্পর্ক' },
      },
      {
        key: 'guardianPhone',
        type: 'phone',
        required: true,
        private: true,
        label: { en: 'Guardian’s mobile number', bn: 'অভিভাবকের মোবাইল নম্বর' },
      },
      {
        key: 'alternatePhone',
        type: 'phone',
        private: true,
        label: { en: 'Alternative mobile number', bn: 'বিকল্প মোবাইল নম্বর' },
      },
      {
        key: 'contactEmail',
        type: 'email',
        private: true,
        label: { en: 'Email for receiving proposals', bn: 'প্রস্তাব পাওয়ার ইমেইল' },
      },
    ],
  },
];

export const SECTION_KEYS = BIODATA_SECTIONS.map((s) => s.key);

export const VALIDATION_MESSAGES = {
  required: { en: 'This field is required.', bn: 'এই তথ্যটি আবশ্যক।' },
  invalid: { en: 'Please choose a valid value.', bn: 'সঠিক তথ্য দিন।' },
  too_long: { en: 'This is too long.', bn: 'লেখাটি অনেক বড়।' },
  too_short: { en: 'Please write a little more.', bn: 'আরেকটু বিস্তারিত লিখুন।' },
  min: { en: 'The value is too small.', bn: 'মানটি খুব ছোট।' },
  max: { en: 'The value is too large.', bn: 'মানটি খুব বড়।' },
  must_agree: {
    en: 'You must answer “Yes” to submit your biodata.',
    bn: 'বায়োডাটা জমা দিতে “হ্যাঁ” নির্বাচন করতে হবে।',
  },
  age_min: { en: 'You must be at least 18 years old.', bn: 'বয়স কমপক্ষে ১৮ বছর হতে হবে।' },
  age_min_groom: {
    en: 'A groom must be at least 21 years old (the legal age of marriage for men).',
    bn: 'পাত্রের বয়স কমপক্ষে ২১ বছর হতে হবে (পুরুষের বিয়ের আইনগত বয়স)।',
  },
  age_max: { en: 'Please check the date of birth.', bn: 'জন্ম তারিখটি যাচাই করুন।' },
  range: {
    en: 'The maximum must be greater than the minimum.',
    bn: 'সর্বোচ্চ মান সর্বনিম্নের চেয়ে বড় হতে হবে।',
  },
  phone: {
    en: 'Enter an 11-digit Bangladeshi mobile number (01XXXXXXXXX).',
    bn: '১১ সংখ্যার মোবাইল নম্বর দিন (01XXXXXXXXX)।',
  },
  email: { en: 'Enter a valid email address.', bn: 'সঠিক ইমেইল ঠিকানা দিন।' },
};

export const PHONE_REGEX = /^01[3-9]\d{8}$/;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** Normalises Bangladeshi mobile numbers (+8801…, 8801…, 01…) to 01XXXXXXXXX. */
export function normalizePhone(value) {
  if (value === undefined || value === null) return '';
  let s = String(value).replace(/[\s\-()]/g, '');
  // Accept Bangla digits too.
  s = s.replace(/[০-৯]/g, (d) => String('০১২৩৪৫৬৭৮৯'.indexOf(d)));
  if (s.startsWith('+88')) s = s.slice(3);
  else if (s.startsWith('88') && s.length === 13) s = s.slice(2);
  return s;
}

export function isValidPhone(value) {
  return PHONE_REGEX.test(normalizePhone(value));
}

export function isValidEmail(value) {
  return EMAIL_REGEX.test(String(value ?? '').trim());
}

/** Whole years between `dob` and `now`. */
export function ageFromDob(dob, now = new Date()) {
  if (!dob) return null;
  const d = new Date(dob);
  if (Number.isNaN(d.getTime())) return null;
  let age = now.getFullYear() - d.getFullYear();
  const m = now.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < d.getDate())) age -= 1;
  return age;
}

const isEmpty = (v) => v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0);

export function getSection(key) {
  return BIODATA_SECTIONS.find((s) => s.key === key);
}

export function isFieldVisible(field, biodata) {
  return typeof field.showIf === 'function' ? !!field.showIf(biodata ?? {}) : true;
}

function cleanValue(field, raw) {
  if (isEmpty(raw)) return { value: undefined };
  switch (field.type) {
    case 'text':
    case 'textarea': {
      const v = String(raw).replace(/\r\n/g, '\n').trim();
      if (!v) return { value: undefined };
      if (field.maxLength && v.length > field.maxLength) return { error: 'too_long' };
      if (field.minLength && v.length < field.minLength) return { error: 'too_short' };
      return { value: v };
    }
    case 'select': {
      const allowed = field.options.map((o) => String(o.value));
      if (!allowed.includes(String(raw))) return { error: 'invalid' };
      const v = field.numeric ? Number(raw) : String(raw);
      if (field.mustBe && v !== field.mustBe) return { value: v, error: 'must_agree' };
      return { value: v };
    }
    case 'multiselect': {
      const list = Array.isArray(raw) ? raw : String(raw).split(',');
      const allowed = new Set(field.options.map((o) => String(o.value)));
      const v = [...new Set(list.map(String).filter((x) => allowed.has(x)))];
      if (v.length !== new Set(list.map(String)).size) return { error: 'invalid' };
      return { value: v.length ? v : undefined };
    }
    case 'district': {
      if (!DISTRICTS.some((d) => d.value === raw)) return { error: 'invalid' };
      return { value: String(raw) };
    }
    case 'upazila': {
      if (!UPAZILAS.some((u) => u.value === raw)) return { error: 'invalid' };
      return { value: String(raw) };
    }
    case 'number': {
      const n = Number(raw);
      if (!Number.isFinite(n) || !Number.isInteger(n)) return { error: 'invalid' };
      if (field.min !== undefined && n < field.min) return { error: 'min' };
      if (field.max !== undefined && n > field.max) return { error: 'max' };
      return { value: n };
    }
    case 'date': {
      const s = String(raw).slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return { error: 'invalid' };
      const d = new Date(`${s}T00:00:00.000Z`);
      if (Number.isNaN(d.getTime())) return { error: 'invalid' };
      const age = ageFromDob(d);
      if (field.minAge !== undefined && age < field.minAge) return { error: 'age_min' };
      if (field.maxAge !== undefined && age > field.maxAge) return { error: 'age_max' };
      return { value: s };
    }
    case 'phone': {
      const v = normalizePhone(raw);
      if (!PHONE_REGEX.test(v)) return { error: 'phone' };
      return { value: v };
    }
    case 'email': {
      const v = String(raw).trim().toLowerCase();
      if (!EMAIL_REGEX.test(v) || v.length > 120) return { error: 'email' };
      return { value: v };
    }
    default:
      return { error: 'invalid' };
  }
}

/**
 * Validates one section.
 * @param {string} sectionKey
 * @param {object} input raw values for the section
 * @param {object} [opts]
 * @param {object} [opts.biodata] the whole biodata (other sections), used for conditional fields
 * @param {boolean} [opts.partial] when true, missing required fields are not errors (draft saving)
 * @returns {{ value: object, errors: Record<string,string> }}
 */
export function validateSection(sectionKey, input, { biodata = {}, partial = false } = {}) {
  const section = getSection(sectionKey);
  if (!section) return { value: {}, errors: { _section: 'invalid' } };
  const src = input && typeof input === 'object' ? input : {};
  const merged = { ...biodata, [sectionKey]: src };
  const value = {};
  const errors = {};
  for (const field of section.fields) {
    if (!isFieldVisible(field, merged)) continue;
    const { value: v, error } = cleanValue(field, src[field.key]);
    if (v !== undefined) value[field.key] = v;
    // An upazila must belong to the district chosen in the same section.
    if (field.type === 'upazila' && v !== undefined && districtOfUpazila(v) !== src[field.districtField]) {
      delete value[field.key];
      errors[field.key] = 'invalid';
      continue;
    }
    if (error && !(partial && error === 'must_agree')) errors[field.key] = error;
    else if (v === undefined && !error && field.required && !partial) errors[field.key] = 'required';
  }
  if (typeof section.validate === 'function') Object.assign(errors, section.validate(value));
  return { value, errors };
}

/** Validates every section of a biodata. Returns errors keyed by section. */
export function validateBiodata(biodata) {
  const result = {};
  for (const section of BIODATA_SECTIONS) {
    const { errors } = validateSection(section.key, biodata?.[section.key] ?? {}, { biodata });
    if (Object.keys(errors).length) result[section.key] = errors;
  }
  return result;
}

/** Completion summary used by the editor progress bar and the submit button. */
export function biodataCompletion(biodata) {
  const errors = validateBiodata(biodata);
  const sections = BIODATA_SECTIONS.map((s) => ({
    key: s.key,
    complete: !errors[s.key],
    missing: Object.keys(errors[s.key] ?? {}),
  }));
  const done = sections.filter((s) => s.complete).length;
  return {
    sections,
    done,
    total: sections.length,
    percent: Math.round((done / sections.length) * 100),
    complete: done === sections.length,
  };
}

/**
 * Removes every private field (names, contact section) for public display, and
 * shortens dates marked `publicPrecision: 'month'` (the date of birth) to YYYY-MM.
 */
export function publicSections(biodata) {
  const out = {};
  for (const section of BIODATA_SECTIONS) {
    if (section.private) continue;
    const src = biodata?.[section.key] ?? {};
    const clean = {};
    for (const field of section.fields) {
      if (field.private || src[field.key] === undefined) continue;
      clean[field.key] =
        field.type === 'date' && field.publicPrecision === 'month'
          ? String(src[field.key]).slice(0, 7)
          : src[field.key];
    }
    out[section.key] = clean;
  }
  return out;
}

/** Display value of a field in the given language. */
export function formatFieldValue(field, value, lang = 'en') {
  if (isEmpty(value)) return '';
  if (field.type === 'select') {
    const o = field.options.find((x) => String(x.value) === String(value));
    return o ? (o[lang] ?? o.en) : String(value);
  }
  if (field.type === 'multiselect') {
    return (Array.isArray(value) ? value : [value])
      .map((v) => field.options.find((x) => x.value === v)?.[lang] ?? v)
      .join(', ');
  }
  if (field.type === 'district') {
    const d = DISTRICTS.find((x) => x.value === value);
    return d ? d[lang] : String(value);
  }
  if (field.type === 'upazila') {
    const u = UPAZILAS.find((x) => x.value === value);
    return u ? u[lang] : String(value);
  }
  if (field.type === 'date') {
    // A public date of birth arrives as YYYY-MM (see publicSections) and shows as "March 2001".
    const s = String(value);
    const monthOnly = /^\d{4}-\d{2}$/.test(s);
    const d = new Date(`${monthOnly ? `${s}-01` : s.slice(0, 10)}T00:00:00.000Z`);
    return d.toLocaleDateString(lang === 'bn' ? 'bn-BD' : 'en-GB', {
      ...(monthOnly ? {} : { day: 'numeric' }),
      month: 'long',
      year: 'numeric',
      timeZone: 'UTC',
    });
  }
  return String(value);
}

/**
 * Sets one field of a section and clears the fields that depend on it, all the
 * way down (a new division clears the district, which clears the upazila).
 * @returns {object} the new section values
 */
export function setFieldValue(section, values, key, value) {
  const next = { ...values, [key]: value };
  const changed = [key];
  while (changed.length) {
    const k = changed.pop();
    for (const f of section.fields) {
      if ((f.divisionField === k || f.districtField === k) && next[f.key]) {
        next[f.key] = '';
        changed.push(f.key);
      }
    }
  }
  return next;
}
