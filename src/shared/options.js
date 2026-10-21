// Every selectable value used in the platform, with English and Bangla labels.
// Values are stored in the database; labels are only for display.

const BN_DIGITS = ['০', '১', '২', '৩', '৪', '৫', '৬', '৭', '৮', '৯'];

export const ROLES = Object.freeze({
  USER: 'user',
  SUPPORT: 'support',
  SUPER_ADMIN: 'super_admin',
});

export const ROLE_OPTIONS = [
  { value: 'user', en: 'Registered user', bn: 'নিবন্ধিত ব্যবহারকারী' },
  { value: 'support', en: 'Support & reviewer', bn: 'সাপোর্ট ও রিভিউয়ার' },
  { value: 'super_admin', en: 'Super admin', bn: 'সুপার অ্যাডমিন' },
];

export const USER_STATUS_OPTIONS = [
  { value: 'active', en: 'Active', bn: 'সক্রিয়' },
  { value: 'suspended', en: 'Suspended', bn: 'স্থগিত' },
  { value: 'banned', en: 'Banned', bn: 'নিষিদ্ধ' },
  { value: 'deactivated', en: 'Deactivated', bn: 'নিষ্ক্রিয়' },
];

export const BIODATA_TYPES = [
  { value: 'bride', en: 'Bride', bn: 'পাত্রী' },
  { value: 'groom', en: 'Groom', bn: 'পাত্র' },
];

export const MARITAL_STATUS = [
  { value: 'never_married', en: 'Never married', bn: 'অবিবাহিত' },
  { value: 'divorced', en: 'Divorced', bn: 'তালাকপ্রাপ্ত' },
  { value: 'widowed', en: 'Widowed', bn: 'বিধবা/বিপত্নীক' },
  { value: 'separated', en: 'Separated', bn: 'আলাদা থাকেন' },
];

export const RELIGIONS = [
  { value: 'hindu', en: 'Hindu', bn: 'হিন্দু' },
  { value: 'muslim', en: 'Muslim', bn: 'মুসলিম' },
  { value: 'christian', en: 'Christian', bn: 'খ্রিস্টান' },
  { value: 'buddhist', en: 'Buddhist', bn: 'বৌদ্ধ' },
  { value: 'other', en: 'Other', bn: 'অন্যান্য' },
];

export const COMPLEXIONS = [
  { value: 'very_fair', en: 'Very fair', bn: 'উজ্জ্বল ফর্সা' },
  { value: 'fair', en: 'Fair', bn: 'ফর্সা' },
  { value: 'wheatish', en: 'Wheatish', bn: 'উজ্জ্বল শ্যামলা' },
  { value: 'brown', en: 'Brown', bn: 'শ্যামলা' },
  { value: 'dark', en: 'Dark', bn: 'কালো' },
];

export const BLOOD_GROUPS = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'].map((g) => ({
  value: g,
  en: g,
  bn: g,
}));

export const YES_NO = [
  { value: 'yes', en: 'Yes', bn: 'হ্যাঁ' },
  { value: 'no', en: 'No', bn: 'না' },
];

export const ALIVE_STATUS = [
  { value: 'alive', en: 'Alive', bn: 'জীবিত' },
  { value: 'deceased', en: 'Deceased', bn: 'মৃত' },
];

export const EDUCATION_MEDIUMS = [
  { value: 'general', en: 'General (Bangla medium)', bn: 'জেনারেল (বাংলা মাধ্যম)' },
  { value: 'english', en: 'English medium', bn: 'ইংরেজি মাধ্যম' },
  { value: 'english_version', en: 'English version', bn: 'ইংলিশ ভার্সন' },
  { value: 'madrasa', en: 'Madrasa', bn: 'মাদ্রাসা' },
  { value: 'technical', en: 'Technical / vocational', bn: 'কারিগরি' },
  { value: 'other', en: 'Other', bn: 'অন্যান্য' },
];

// Ordered from lowest to highest so "minimum education" comparisons work by index.
export const EDUCATION_LEVELS = [
  { value: 'below_ssc', en: 'Below SSC', bn: 'এসএসসির নিচে' },
  { value: 'ssc', en: 'SSC / Dakhil / O level', bn: 'এসএসসি / দাখিল / ও লেভেল' },
  { value: 'hsc', en: 'HSC / Alim / A level', bn: 'এইচএসসি / আলিম / এ লেভেল' },
  { value: 'diploma', en: 'Diploma', bn: 'ডিপ্লোমা' },
  { value: 'bachelor', en: 'Bachelor’s degree', bn: 'স্নাতক' },
  { value: 'masters', en: 'Master’s degree', bn: 'স্নাতকোত্তর' },
  { value: 'doctorate', en: 'Doctorate (PhD)', bn: 'ডক্টরেট (পিএইচডি)' },
];

export const PROFESSIONS = [
  { value: 'student', en: 'Student', bn: 'শিক্ষার্থী' },
  { value: 'government_job', en: 'Government job', bn: 'সরকারি চাকরি' },
  { value: 'private_job', en: 'Private job', bn: 'বেসরকারি চাকরি' },
  { value: 'business', en: 'Business', bn: 'ব্যবসা' },
  { value: 'doctor', en: 'Doctor', bn: 'ডাক্তার' },
  { value: 'engineer', en: 'Engineer', bn: 'ইঞ্জিনিয়ার' },
  { value: 'teacher', en: 'Teacher / lecturer', bn: 'শিক্ষক / প্রভাষক' },
  { value: 'lawyer', en: 'Lawyer', bn: 'আইনজীবী' },
  { value: 'banker', en: 'Banker', bn: 'ব্যাংকার' },
  { value: 'armed_forces', en: 'Armed forces / police', bn: 'সশস্ত্র বাহিনী / পুলিশ' },
  { value: 'freelancer', en: 'Freelancer', bn: 'ফ্রিল্যান্সার' },
  { value: 'abroad', en: 'Working abroad', bn: 'প্রবাসী' },
  { value: 'homemaker', en: 'Homemaker', bn: 'গৃহিণী' },
  { value: 'not_working', en: 'Not working', bn: 'কর্মরত নন' },
  { value: 'other', en: 'Other', bn: 'অন্যান্য' },
];

export const INCOME_RANGES = [
  { value: 'none', en: 'No income', bn: 'আয় নেই' },
  { value: 'below_20k', en: 'Below ৳20,000', bn: '৳২০,০০০ এর নিচে' },
  { value: '20k_40k', en: '৳20,000 – ৳40,000', bn: '৳২০,০০০ – ৳৪০,০০০' },
  { value: '40k_70k', en: '৳40,000 – ৳70,000', bn: '৳৪০,০০০ – ৳৭০,০০০' },
  { value: '70k_100k', en: '৳70,000 – ৳1,00,000', bn: '৳৭০,০০০ – ৳১,০০,০০০' },
  { value: '100k_200k', en: '৳1,00,000 – ৳2,00,000', bn: '৳১,০০,০০০ – ৳২,০০,০০০' },
  { value: 'above_200k', en: 'Above ৳2,00,000', bn: '৳২,০০,০০০ এর বেশি' },
];

export const ECONOMIC_STATUS = [
  { value: 'lower', en: 'Lower class', bn: 'নিম্নবিত্ত' },
  { value: 'lower_middle', en: 'Lower middle class', bn: 'নিম্ন মধ্যবিত্ত' },
  { value: 'middle', en: 'Middle class', bn: 'মধ্যবিত্ত' },
  { value: 'upper_middle', en: 'Upper middle class', bn: 'উচ্চ মধ্যবিত্ত' },
  { value: 'upper', en: 'Upper class', bn: 'উচ্চবিত্ত' },
];

export const DIET = [
  { value: 'non_vegetarian', en: 'Non-vegetarian', bn: 'আমিষভোজী' },
  { value: 'vegetarian', en: 'Vegetarian', bn: 'নিরামিষভোজী' },
  { value: 'eggetarian', en: 'Eggetarian', bn: 'ডিম খান, মাংস খান না' },
];

export const PRESENT_LOCATION = [
  { value: 'bangladesh', en: 'In Bangladesh', bn: 'বাংলাদেশে' },
  { value: 'abroad', en: 'Abroad', bn: 'প্রবাসে' },
];

export const GUARDIAN_RELATIONS = [
  { value: 'father', en: 'Father', bn: 'বাবা' },
  { value: 'mother', en: 'Mother', bn: 'মা' },
  { value: 'brother', en: 'Brother', bn: 'ভাই' },
  { value: 'sister', en: 'Sister', bn: 'বোন' },
  { value: 'uncle', en: 'Uncle', bn: 'চাচা/মামা' },
  { value: 'aunt', en: 'Aunt', bn: 'চাচি/খালা/ফুফু' },
  { value: 'grandparent', en: 'Grandparent', bn: 'দাদা/দাদি/নানা/নানি' },
  { value: 'other', en: 'Other relative', bn: 'অন্যান্য আত্মীয়' },
];

export const PHOTO_VISIBILITY = [
  { value: 'after_unlock', en: 'Only to people who unlock my contact', bn: 'শুধু যারা যোগাযোগ আনলক করেছেন' },
  { value: 'public', en: 'Everyone', bn: 'সবাই' },
  { value: 'hidden', en: 'Nobody', bn: 'কেউ না' },
];

// Heights from 4'0" to 7'0", stored in inches.
export const HEIGHTS = Array.from({ length: 37 }, (_, i) => {
  const inches = 48 + i;
  const ft = Math.floor(inches / 12);
  const inch = inches % 12;
  const en = `${ft}′ ${inch}″`;
  return { value: inches, en, bn: toBnDigits(en) };
});

export const BIODATA_STATUS = [
  { value: 'draft', en: 'Draft', bn: 'খসড়া' },
  { value: 'pending', en: 'Under review', bn: 'রিভিউ চলছে' },
  { value: 'approved', en: 'Approved', bn: 'অনুমোদিত' },
  { value: 'rejected', en: 'Needs changes', bn: 'সংশোধন প্রয়োজন' },
];

export const NID_STATUS = [
  { value: 'not_submitted', en: 'Not submitted', bn: 'জমা হয়নি' },
  { value: 'pending', en: 'Pending verification', bn: 'যাচাইয়ের অপেক্ষায়' },
  { value: 'verified', en: 'NID verified', bn: 'এনআইডি যাচাইকৃত' },
  { value: 'rejected', en: 'Rejected', bn: 'প্রত্যাখ্যাত' },
];

/** Situations a member may choose to disclose so families looking for them can filter on it. */
export const SPECIAL_CATEGORIES = [
  { value: 'disability', en: 'Has a disability', bn: 'প্রতিবন্ধিতা আছে' },
  { value: 'infertility', en: 'Unable to have children', bn: 'সন্তান ধারণে অক্ষম' },
  { value: 'converted', en: 'Converted to my current faith', bn: 'বর্তমান ধর্মে ধর্মান্তরিত' },
  { value: 'orphan', en: 'Orphan', bn: 'এতিম' },
];

/** Why a member hides a live biodata (hiding keeps everything and can be undone). */
export const HIDE_REASONS = [
  { value: 'in_talks', en: 'In talks with a family', bn: 'একটি পরিবারের সাথে কথা চলছে' },
  { value: 'engaged', en: 'Engaged / marriage is fixed', bn: 'বিয়ে ঠিক হয়েছে' },
  { value: 'break', en: 'Taking a break', bn: 'কিছুদিনের বিরতি' },
  { value: 'privacy', en: 'Privacy concerns', bn: 'গোপনীয়তার কারণে' },
  { value: 'other', en: 'Other', bn: 'অন্যান্য' },
];

export const DELETE_REASONS = [
  { value: 'married_via_ghotok', en: 'Got married through Ghotok', bn: 'ঘটকের মাধ্যমে বিয়ে হয়েছে' },
  { value: 'married_elsewhere', en: 'Got married elsewhere', bn: 'অন্য মাধ্যমে বিয়ে হয়েছে' },
  { value: 'not_interested', en: 'No longer looking', bn: 'আর খুঁজছি না' },
  { value: 'privacy', en: 'Privacy concerns', bn: 'গোপনীয়তার কারণে' },
  { value: 'other', en: 'Other', bn: 'অন্যান্য' },
];

export const PAYMENT_METHODS = [
  { value: 'bkash', en: 'bKash', bn: 'বিকাশ' },
  { value: 'nagad', en: 'Nagad', bn: 'নগদ' },
  { value: 'rocket', en: 'Rocket', bn: 'রকেট' },
  // Online checkout only: cards, mobile banking and internet banking through SSLCommerz.
  { value: 'sslcommerz', en: 'Card / mobile banking', bn: 'কার্ড / মোবাইল ব্যাংকিং', gatewayOnly: true },
];

export const PAYMENT_STATUS = [
  { value: 'initiated', en: 'Awaiting payment', bn: 'পেমেন্টের অপেক্ষায়' },
  { value: 'pending', en: 'Pending review', bn: 'যাচাইয়ের অপেক্ষায়' },
  { value: 'verified', en: 'Verified', bn: 'যাচাইকৃত' },
  { value: 'rejected', en: 'Rejected', bn: 'বাতিল' },
  { value: 'failed', en: 'Failed', bn: 'ব্যর্থ' },
  { value: 'cancelled', en: 'Cancelled', bn: 'বাতিলকৃত' },
  { value: 'refunded', en: 'Refunded', bn: 'রিফান্ডকৃত' },
];

export const REFUND_STATUS = [
  { value: 'pending', en: 'Pending', bn: 'অপেক্ষমাণ' },
  { value: 'approved', en: 'Approved', bn: 'অনুমোদিত' },
  { value: 'rejected', en: 'Rejected', bn: 'প্রত্যাখ্যাত' },
];

export const REFUND_RESOLUTIONS = [
  { value: 'connection_credit', en: 'Refund as connection credit', bn: 'কানেকশন ক্রেডিট হিসেবে রিফান্ড' },
  { value: 'money_back', en: 'Return the money', bn: 'টাকা ফেরত' },
];

export const LEDGER_TYPES = [
  { value: 'purchase', en: 'Purchase', bn: 'ক্রয়' },
  { value: 'unlock', en: 'Contact unlocked', bn: 'যোগাযোগ আনলক' },
  { value: 'admin_grant', en: 'Granted by admin', bn: 'অ্যাডমিন প্রদান করেছেন' },
  { value: 'gift', en: 'Gift for an approved biodata', bn: 'অনুমোদিত বায়োডাটার উপহার' },
  { value: 'report_refund', en: 'Returned after a report', bn: 'রিপোর্টের পর ফেরত' },
  { value: 'admin_revoke', en: 'Revoked by admin', bn: 'অ্যাডমিন বাতিল করেছেন' },
  { value: 'refund_credit', en: 'Refund credit', bn: 'রিফান্ড ক্রেডিট' },
  { value: 'refund_revoke', en: 'Refunded (money returned)', bn: 'রিফান্ড (টাকা ফেরত)' },
];

export const ADJUSTMENT_ACTIONS = [
  { value: 'grant', en: 'Grant connections', bn: 'কানেকশন প্রদান' },
  { value: 'revoke', en: 'Revoke connections', bn: 'কানেকশন বাতিল' },
  { value: 'refund_credit', en: 'Refund as credit', bn: 'ক্রেডিট হিসেবে রিফান্ড' },
];

export const PROPOSAL_STATUS = [
  { value: 'pending', en: 'Awaiting reply', bn: 'উত্তরের অপেক্ষায়' },
  { value: 'accepted', en: 'Accepted', bn: 'গৃহীত' },
  { value: 'declined', en: 'Declined', bn: 'প্রত্যাখ্যাত' },
  { value: 'withdrawn', en: 'Withdrawn', bn: 'প্রত্যাহার করা হয়েছে' },
];

export const REPORT_REASONS = [
  { value: 'fake_info', en: 'Fake or misleading information', bn: 'ভুয়া বা বিভ্রান্তিকর তথ্য' },
  { value: 'wrong_contact', en: 'Wrong guardian number', bn: 'ভুল অভিভাবক নম্বর' },
  { value: 'already_married', en: 'Already married', bn: 'ইতিমধ্যে বিবাহিত' },
  { value: 'inappropriate', en: 'Inappropriate behaviour or contact', bn: 'অনুচিত আচরণ বা যোগাযোগ' },
  { value: 'fraud', en: 'Asking for money / fraud', bn: 'টাকা চাওয়া / প্রতারণা' },
  { value: 'other', en: 'Other', bn: 'অন্যান্য' },
];

export const REPORT_STATUS = [
  { value: 'open', en: 'Open', bn: 'খোলা' },
  { value: 'in_review', en: 'In review', bn: 'রিভিউ চলছে' },
  { value: 'resolved', en: 'Resolved', bn: 'সমাধান হয়েছে' },
  { value: 'dismissed', en: 'Dismissed', bn: 'খারিজ' },
];

export const TICKET_CATEGORIES = [
  { value: 'account', en: 'Account', bn: 'অ্যাকাউন্ট' },
  { value: 'biodata', en: 'Biodata', bn: 'বায়োডাটা' },
  { value: 'payment', en: 'Payment or connections', bn: 'পেমেন্ট বা কানেকশন' },
  { value: 'report', en: 'Report a problem', bn: 'সমস্যা জানান' },
  { value: 'other', en: 'Other', bn: 'অন্যান্য' },
];

export const TICKET_STATUS = [
  { value: 'open', en: 'Open', bn: 'খোলা' },
  { value: 'answered', en: 'Answered', bn: 'উত্তর দেওয়া হয়েছে' },
  { value: 'waiting', en: 'Waiting for support', bn: 'সাপোর্টের অপেক্ষায়' },
  { value: 'closed', en: 'Closed', bn: 'বন্ধ' },
];

export const TICKET_PRIORITY = [
  { value: 'low', en: 'Low', bn: 'কম' },
  { value: 'normal', en: 'Normal', bn: 'সাধারণ' },
  { value: 'high', en: 'High', bn: 'জরুরি' },
];

export const RESTORE_STATUS = [
  { value: 'pending', en: 'Pending', bn: 'অপেক্ষমাণ' },
  { value: 'approved', en: 'Restored', bn: 'পুনরুদ্ধার করা হয়েছে' },
  { value: 'declined', en: 'Declined', bn: 'প্রত্যাখ্যাত' },
];

export const SORT_OPTIONS = [
  { value: 'newest', en: 'Newest approved', bn: 'সর্বশেষ অনুমোদিত' },
  { value: 'oldest', en: 'Oldest first', bn: 'পুরোনো আগে' },
  { value: 'age_asc', en: 'Age: low to high', bn: 'বয়স: কম থেকে বেশি' },
  { value: 'age_desc', en: 'Age: high to low', bn: 'বয়স: বেশি থেকে কম' },
];

/** Converts ASCII digits in a string or number to Bangla digits. */
export function toBnDigits(input) {
  return String(input ?? '').replace(/[0-9]/g, (d) => BN_DIGITS[Number(d)]);
}

/** Formats a number for the given language, using Bangla digits for "bn". */
export function formatNumber(value, lang = 'en') {
  const s = Number(value ?? 0).toLocaleString('en-IN');
  return lang === 'bn' ? toBnDigits(s) : s;
}

/** Returns the label of `value` in `options` for `lang`, or the raw value. */
export function optionLabel(options, value, lang = 'en') {
  if (value === undefined || value === null || value === '') return '';
  const found = options.find((o) => String(o.value) === String(value));
  if (!found) return String(value);
  return found[lang] ?? found.en;
}

/** Returns the values of an option list, e.g. for enum validation. */
export function optionValues(options) {
  return options.map((o) => o.value);
}
