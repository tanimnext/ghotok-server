// Divisions and districts of Bangladesh with English and Bangla names.
// District values are stable slugs stored in the database.

export const DIVISIONS = [
  {
    value: 'dhaka',
    en: 'Dhaka',
    bn: 'ঢাকা',
    districts: [
      ['dhaka', 'Dhaka', 'ঢাকা'],
      ['faridpur', 'Faridpur', 'ফরিদপুর'],
      ['gazipur', 'Gazipur', 'গাজীপুর'],
      ['gopalganj', 'Gopalganj', 'গোপালগঞ্জ'],
      ['kishoreganj', 'Kishoreganj', 'কিশোরগঞ্জ'],
      ['madaripur', 'Madaripur', 'মাদারীপুর'],
      ['manikganj', 'Manikganj', 'মানিকগঞ্জ'],
      ['munshiganj', 'Munshiganj', 'মুন্সিগঞ্জ'],
      ['narayanganj', 'Narayanganj', 'নারায়ণগঞ্জ'],
      ['narsingdi', 'Narsingdi', 'নরসিংদী'],
      ['rajbari', 'Rajbari', 'রাজবাড়ী'],
      ['shariatpur', 'Shariatpur', 'শরীয়তপুর'],
      ['tangail', 'Tangail', 'টাঙ্গাইল'],
    ],
  },
  {
    value: 'chattogram',
    en: 'Chattogram',
    bn: 'চট্টগ্রাম',
    districts: [
      ['bandarban', 'Bandarban', 'বান্দরবান'],
      ['brahmanbaria', 'Brahmanbaria', 'ব্রাহ্মণবাড়িয়া'],
      ['chandpur', 'Chandpur', 'চাঁদপুর'],
      ['chattogram', 'Chattogram', 'চট্টগ্রাম'],
      ['coxs_bazar', 'Cox’s Bazar', 'কক্সবাজার'],
      ['cumilla', 'Cumilla', 'কুমিল্লা'],
      ['feni', 'Feni', 'ফেনী'],
      ['khagrachhari', 'Khagrachhari', 'খাগড়াছড়ি'],
      ['lakshmipur', 'Lakshmipur', 'লক্ষ্মীপুর'],
      ['noakhali', 'Noakhali', 'নোয়াখালী'],
      ['rangamati', 'Rangamati', 'রাঙ্গামাটি'],
    ],
  },
  {
    value: 'rajshahi',
    en: 'Rajshahi',
    bn: 'রাজশাহী',
    districts: [
      ['bogura', 'Bogura', 'বগুড়া'],
      ['chapainawabganj', 'Chapainawabganj', 'চাঁপাইনবাবগঞ্জ'],
      ['joypurhat', 'Joypurhat', 'জয়পুরহাট'],
      ['naogaon', 'Naogaon', 'নওগাঁ'],
      ['natore', 'Natore', 'নাটোর'],
      ['pabna', 'Pabna', 'পাবনা'],
      ['rajshahi', 'Rajshahi', 'রাজশাহী'],
      ['sirajganj', 'Sirajganj', 'সিরাজগঞ্জ'],
    ],
  },
  {
    value: 'khulna',
    en: 'Khulna',
    bn: 'খুলনা',
    districts: [
      ['bagerhat', 'Bagerhat', 'বাগেরহাট'],
      ['chuadanga', 'Chuadanga', 'চুয়াডাঙ্গা'],
      ['jashore', 'Jashore', 'যশোর'],
      ['jhenaidah', 'Jhenaidah', 'ঝিনাইদহ'],
      ['khulna', 'Khulna', 'খুলনা'],
      ['kushtia', 'Kushtia', 'কুষ্টিয়া'],
      ['magura', 'Magura', 'মাগুরা'],
      ['meherpur', 'Meherpur', 'মেহেরপুর'],
      ['narail', 'Narail', 'নড়াইল'],
      ['satkhira', 'Satkhira', 'সাতক্ষীরা'],
    ],
  },
  {
    value: 'barishal',
    en: 'Barishal',
    bn: 'বরিশাল',
    districts: [
      ['barguna', 'Barguna', 'বরগুনা'],
      ['barishal', 'Barishal', 'বরিশাল'],
      ['bhola', 'Bhola', 'ভোলা'],
      ['jhalokati', 'Jhalokati', 'ঝালকাঠি'],
      ['patuakhali', 'Patuakhali', 'পটুয়াখালী'],
      ['pirojpur', 'Pirojpur', 'পিরোজপুর'],
    ],
  },
  {
    value: 'sylhet',
    en: 'Sylhet',
    bn: 'সিলেট',
    districts: [
      ['habiganj', 'Habiganj', 'হবিগঞ্জ'],
      ['moulvibazar', 'Moulvibazar', 'মৌলভীবাজার'],
      ['sunamganj', 'Sunamganj', 'সুনামগঞ্জ'],
      ['sylhet', 'Sylhet', 'সিলেট'],
    ],
  },
  {
    value: 'rangpur',
    en: 'Rangpur',
    bn: 'রংপুর',
    districts: [
      ['dinajpur', 'Dinajpur', 'দিনাজপুর'],
      ['gaibandha', 'Gaibandha', 'গাইবান্ধা'],
      ['kurigram', 'Kurigram', 'কুড়িগ্রাম'],
      ['lalmonirhat', 'Lalmonirhat', 'লালমনিরহাট'],
      ['nilphamari', 'Nilphamari', 'নীলফামারী'],
      ['panchagarh', 'Panchagarh', 'পঞ্চগড়'],
      ['rangpur', 'Rangpur', 'রংপুর'],
      ['thakurgaon', 'Thakurgaon', 'ঠাকুরগাঁও'],
    ],
  },
  {
    value: 'mymensingh',
    en: 'Mymensingh',
    bn: 'ময়মনসিংহ',
    districts: [
      ['jamalpur', 'Jamalpur', 'জামালপুর'],
      ['mymensingh', 'Mymensingh', 'ময়মনসিংহ'],
      ['netrokona', 'Netrokona', 'নেত্রকোনা'],
      ['sherpur', 'Sherpur', 'শেরপুর'],
    ],
  },
].map((d) => ({
  value: d.value,
  en: d.en,
  bn: d.bn,
  districts: d.districts.map(([value, en, bn]) => ({ value, en, bn, division: d.value })),
}));

export const DIVISION_OPTIONS = DIVISIONS.map(({ value, en, bn }) => ({ value, en, bn }));

export const DISTRICTS = DIVISIONS.flatMap((d) => d.districts).sort((a, b) => a.en.localeCompare(b.en));

/** Returns the districts of a division, or all districts when no division is given. */
export function districtsOf(division) {
  if (!division) return DISTRICTS;
  return DIVISIONS.find((d) => d.value === division)?.districts ?? [];
}

/** Returns the division value that contains `district`, if any. */
export function divisionOf(district) {
  return DISTRICTS.find((d) => d.value === district)?.division;
}
