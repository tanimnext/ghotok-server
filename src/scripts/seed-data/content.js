// Default CMS content. Admins can edit all of it from the admin panel (Content).
// Text in [square brackets] is a placeholder for details only the business can supply.

export const PACKAGES = [
  {
    name: { en: 'Starter', bn: 'স্টার্টার' },
    description: {
      en: 'Good for a first look at a few families.',
      bn: 'কয়েকটি পরিবারের সাথে প্রথম যোগাযোগের জন্য।',
    },
    connections: 3,
    price: 300,
    sortOrder: 1,
  },
  {
    name: { en: 'Standard', bn: 'স্ট্যান্ডার্ড' },
    description: { en: 'Our most chosen package.', bn: 'সবচেয়ে জনপ্রিয় প্যাকেজ।' },
    connections: 5,
    price: 500,
    sortOrder: 2,
    highlight: true,
  },
];

export const PAGES = [
  {
    slug: 'about',
    title: { en: 'About Ghotok', bn: 'ঘটক সম্পর্কে' },
    body: {
      en: `Ghotok (ঘটক) is a modern, secure matchmaking platform for every faith in Bangladesh — Hindu, Muslim, Christian, Buddhist and others.

## What we believe
- Marriage is a decision families make together, so we connect you with **guardians**, not strangers.
- Privacy comes first: names and phone numbers are never public.
- Every biodata is reviewed by our team before it goes live.

## How Ghotok works
1. Create your biodata for free.
2. Browse and filter biodatas for free.
3. When you find a good match, use one **connection** to unlock the guardian's contact details.
4. Families talk, enquire and decide at their own pace.

Contact us any time at [support@ghotok.com.bd].`,
      bn: `ঘটক বাংলাদেশের সব ধর্মের মানুষের জন্য একটি আধুনিক ও নিরাপদ ঘটক প্ল্যাটফর্ম — হিন্দু, মুসলিম, খ্রিস্টান, বৌদ্ধসহ সবার জন্য।

## আমাদের বিশ্বাস
- বিয়ে পরিবারের সম্মিলিত সিদ্ধান্ত, তাই আমরা আপনাকে **অভিভাবকের** সাথে যুক্ত করি।
- গোপনীয়তাই প্রথম: নাম ও ফোন নম্বর কখনো প্রকাশ্যে দেখানো হয় না।
- প্রতিটি বায়োডাটা প্রকাশের আগে আমাদের টিম যাচাই করে।

## ঘটক যেভাবে কাজ করে
1. বিনামূল্যে বায়োডাটা তৈরি করুন।
2. বিনামূল্যে বায়োডাটা দেখুন ও ফিল্টার করুন।
3. পছন্দ হলে একটি **কানেকশন** দিয়ে অভিভাবকের যোগাযোগ আনলক করুন।
4. পরিবারগুলো কথা বলে, খোঁজখবর নিয়ে নিজেদের মতো সিদ্ধান্ত নেয়।

যেকোনো প্রয়োজনে যোগাযোগ করুন: [support@ghotok.com.bd]`,
    },
  },
  {
    slug: 'guide',
    title: { en: 'Guide', bn: 'গাইড' },
    body: {
      en: `## Creating your biodata
1. Create an account with your email or mobile number and verify it with the code we send.
2. Open **My dashboard → My biodata** and fill in each section. Your answers are saved as you go.
3. When every section is complete, press **Submit for review**. Our reviewers usually respond within [24 hours].
4. Optionally upload your NID to get the **NID verified** badge.

## Finding a match
- Use the filters on **Browse biodatas** to search by age, religion, district, education and more.
- Add biodatas you like to **Favorites**, and hide ones you are not interested in.
- Send a **proposal** to let a family know you are interested.

## Unlocking a guardian's contact
- Buy a connection package with bKash, Nagad or Rocket.
- On a biodata, press **Unlock with 1 connection**. You keep access to that contact forever.

## Staying safe
- Always involve your family and do your own enquiry.
- Never send money to anyone you meet on Ghotok.
- Report any biodata that feels wrong.`,
      bn: `## বায়োডাটা তৈরি
1. ইমেইল বা মোবাইল নম্বর দিয়ে অ্যাকাউন্ট খুলুন এবং পাঠানো কোড দিয়ে যাচাই করুন।
2. **আমার ড্যাশবোর্ড → আমার বায়োডাটা** থেকে প্রতিটি অংশ পূরণ করুন। তথ্য স্বয়ংক্রিয়ভাবে সংরক্ষিত হয়।
3. সব অংশ পূরণ হলে **রিভিউয়ের জন্য জমা দিন** চাপুন। সাধারণত [২৪ ঘণ্টার] মধ্যে রিভিউ করা হয়।
4. চাইলে এনআইডি আপলোড করে **এনআইডি যাচাইকৃত** ব্যাজ নিন।

## পাত্র/পাত্রী খোঁজা
- **বায়োডাটা দেখুন** পাতায় বয়স, ধর্ম, জেলা, শিক্ষা ইত্যাদি দিয়ে ফিল্টার করুন।
- পছন্দের বায়োডাটা **পছন্দের তালিকায়** রাখুন, অপছন্দেরগুলো লুকিয়ে রাখুন।
- আগ্রহ জানাতে **প্রস্তাব** পাঠান।

## অভিভাবকের যোগাযোগ আনলক
- বিকাশ, নগদ বা রকেটে কানেকশন প্যাকেজ কিনুন।
- বায়োডাটায় **১টি কানেকশন দিয়ে আনলক** চাপুন। একবার আনলক করলে সবসময় দেখতে পাবেন।

## নিরাপদ থাকুন
- সবসময় পরিবারকে সাথে রাখুন এবং নিজে খোঁজখবর নিন।
- ঘটকে পরিচিত কাউকে কখনো টাকা পাঠাবেন না।
- সন্দেহজনক বায়োডাটা রিপোর্ট করুন।`,
    },
  },
  {
    slug: 'privacy-policy',
    title: { en: 'Privacy policy', bn: 'গোপনীয়তা নীতি' },
    body: {
      en: `_Last updated: [date]_

## What we collect
- Account details: name, email and/or mobile number, and a hashed password.
- Biodata details you choose to provide.
- Private details: your name, your parents' names, your guardian's contact details and your NID images.
- Payment details: package, method, sender number and transaction ID.
- Usage data such as profile visits, favorites and proposals.

## Who can see what
- **Public:** the general, address (district level), education, family (without names), personal, occupation, marriage and partner sections of an approved biodata.
- **People who unlock your contact:** your name and your guardian's contact details.
- **Our reviewers:** everything, including NID images, only to verify and moderate.

## How we protect your data
- Contact details are never shown publicly or in search results.
- NID images are stored in private storage and opened only through short-lived links.
- All traffic is encrypted. Passwords are stored as one-way hashes.

## Your choices
- Hide your biodata at any time.
- Delete your biodata; you can ask us to restore it later.
- Deactivate your account from Account and security.

Questions: [support@ghotok.com.bd].`,
      bn: `_সর্বশেষ হালনাগাদ: [তারিখ]_

## আমরা যা সংগ্রহ করি
- অ্যাকাউন্টের তথ্য: নাম, ইমেইল এবং/অথবা মোবাইল নম্বর ও এনক্রিপ্টেড পাসওয়ার্ড।
- আপনার দেওয়া বায়োডাটার তথ্য।
- গোপন তথ্য: আপনার নাম, বাবা-মায়ের নাম, অভিভাবকের যোগাযোগ ও এনআইডির ছবি।
- পেমেন্টের তথ্য: প্যাকেজ, মাধ্যম, প্রেরকের নম্বর ও ট্রান্সজেকশন আইডি।
- প্রোফাইল ভিজিট, পছন্দ ও প্রস্তাবের মতো ব্যবহারের তথ্য।

## কে কী দেখতে পায়
- **সবাই:** অনুমোদিত বায়োডাটার সাধারণ, ঠিকানা (জেলা পর্যন্ত), শিক্ষা, পরিবার (নাম ছাড়া), ব্যক্তিগত, পেশা, বিয়ে ও প্রত্যাশিত জীবনসঙ্গীর তথ্য।
- **যারা যোগাযোগ আনলক করেন:** আপনার নাম ও অভিভাবকের যোগাযোগ।
- **আমাদের রিভিউয়ার:** যাচাই ও তদারকির জন্য এনআইডিসহ সব তথ্য।

## তথ্যের সুরক্ষা
- যোগাযোগের তথ্য কখনো প্রকাশ্যে বা সার্চ ফলাফলে দেখানো হয় না।
- এনআইডির ছবি গোপন স্টোরেজে থাকে এবং স্বল্পমেয়াদি লিংকে খোলা হয়।
- সব তথ্য আদান-প্রদান এনক্রিপ্টেড।

## আপনার নিয়ন্ত্রণ
- যেকোনো সময় বায়োডাটা লুকিয়ে রাখুন।
- বায়োডাটা মুছে ফেলুন; পরে পুনরুদ্ধারের আবেদন করতে পারবেন।
- অ্যাকাউন্ট ও নিরাপত্তা থেকে অ্যাকাউন্ট নিষ্ক্রিয় করুন।

প্রশ্ন থাকলে: [support@ghotok.com.bd]`,
    },
  },
  {
    slug: 'terms',
    title: { en: 'Terms and conditions', bn: 'শর্তাবলী' },
    body: {
      en: `_Last updated: [date]_

1. You must be at least 18 years old to create a biodata.
2. You must create a biodata only with your guardians' knowledge and give true information. False information may lead to removal without refund.
3. Use guardian contact details only to discuss marriage. Harassment, fraud or asking for money leads to a permanent ban.
4. Connections are used when you unlock a contact and are not refunded after use.
5. Ghotok introduces families; it does not guarantee the truth of any biodata or the outcome of any proposal. Please make your own enquiries.
6. We may hide or remove any biodata that breaks these terms.
7. These terms are governed by the laws of Bangladesh.`,
      bn: `_সর্বশেষ হালনাগাদ: [তারিখ]_

১. বায়োডাটা তৈরি করতে বয়স কমপক্ষে ১৮ বছর হতে হবে।
২. অভিভাবকের সম্মতিতে এবং সত্য তথ্য দিয়ে বায়োডাটা তৈরি করতে হবে। মিথ্যা তথ্যের কারণে বায়োডাটা মুছে ফেলা হতে পারে।
৩. অভিভাবকের যোগাযোগ শুধু বিয়ের আলোচনার জন্য ব্যবহার করুন। হয়রানি, প্রতারণা বা টাকা চাওয়া স্থায়ীভাবে নিষিদ্ধ।
৪. যোগাযোগ আনলক করলে কানেকশন খরচ হয় এবং ব্যবহারের পর তা ফেরতযোগ্য নয়।
৫. ঘটক পরিবারগুলোকে পরিচয় করিয়ে দেয়; কোনো বায়োডাটার সত্যতা বা প্রস্তাবের ফলাফলের নিশ্চয়তা দেয় না। নিজে খোঁজখবর নিন।
৬. শর্ত ভঙ্গকারী বায়োডাটা আমরা লুকিয়ে বা মুছে ফেলতে পারি।
৭. এই শর্তাবলী বাংলাদেশের আইন অনুযায়ী পরিচালিত।`,
    },
  },
  {
    slug: 'refund-policy',
    title: { en: 'Refund policy', bn: 'রিফান্ড নীতি' },
    body: {
      en: `_Last updated: [date]_

- **Unverified payments:** if we cannot verify your transaction ID, we will contact you. If you did pay, we credit your connections or return the money.
- **Unused connections:** you can ask for a refund of a package within [7 days] of purchase if none of its connections were used.
- **Used connections** are not refundable.
- **Wrong contact details:** if an unlocked guardian number is wrong or switched off, report it from the biodata page. After checking, we return the connection as credit.
- Refunds are sent to the same bKash, Nagad or Rocket number within [3 working days] of approval, or given as connection credit if you prefer.

Request a refund from **My dashboard → Connections and billing**.`,
      bn: `_সর্বশেষ হালনাগাদ: [তারিখ]_

- **যাচাই না হওয়া পেমেন্ট:** ট্রান্সজেকশন আইডি যাচাই করতে না পারলে আমরা যোগাযোগ করব। পেমেন্ট করে থাকলে কানেকশন দেওয়া হবে বা টাকা ফেরত দেওয়া হবে।
- **অব্যবহৃত কানেকশন:** কোনো কানেকশন ব্যবহার না করলে কেনার [৭ দিনের] মধ্যে রিফান্ড চাইতে পারবেন।
- **ব্যবহৃত কানেকশন** ফেরতযোগ্য নয়।
- **ভুল যোগাযোগের তথ্য:** আনলক করা নম্বর ভুল বা বন্ধ থাকলে বায়োডাটা পাতা থেকে রিপোর্ট করুন। যাচাই শেষে কানেকশনটি ক্রেডিট হিসেবে ফেরত দেওয়া হবে।
- অনুমোদনের [৩ কর্মদিবসের] মধ্যে একই বিকাশ, নগদ বা রকেট নম্বরে টাকা ফেরত দেওয়া হয়, অথবা চাইলে কানেকশন ক্রেডিট দেওয়া হয়।

রিফান্ডের আবেদন করুন **আমার ড্যাশবোর্ড → কানেকশন ও বিলিং** থেকে।`,
    },
  },
  {
    slug: 'child-safety',
    title: { en: 'Child safety policy', bn: 'শিশু সুরক্ষা নীতি' },
    body: {
      en: `_Last updated: [date]_

Ghotok is only for adults looking for marriage with their families' knowledge. We do not allow child marriage or any content that puts a child at risk.

- **Age limits:** a bride must be at least 18 and a groom at least 21, as the Child Marriage Restraint Act 2017 requires. The biodata form checks the date of birth and our reviewers check it again, against the NID when one is uploaded.
- **No minors:** we remove any biodata made for, or showing, someone under the legal age, and we ban the account.
- **Reporting:** use "Report" on any biodata, or write to [support@ghotok.com.bd]. Reports about a child's safety are reviewed first.
- **Authorities:** where a child may be in danger, we preserve the records and inform the police or call the national child helpline **1098**.`,
      bn: `_সর্বশেষ হালনাগাদ: [তারিখ]_

ঘটক কেবল প্রাপ্তবয়স্কদের জন্য, যারা পরিবারের জানাশোনায় বিয়ে করতে চান। বাল্যবিবাহ বা শিশুর জন্য ঝুঁকিপূর্ণ কোনো কিছু এখানে অনুমোদিত নয়।

- **বয়সসীমা:** বাল্যবিবাহ নিরোধ আইন ২০১৭ অনুযায়ী পাত্রীর বয়স কমপক্ষে ১৮ ও পাত্রের কমপক্ষে ২১ বছর হতে হবে। ফর্মে জন্মতারিখ যাচাই হয় এবং রিভিউয়াররা আবার যাচাই করেন; এনআইডি দিলে তার সাথেও মিলিয়ে দেখা হয়।
- **অপ্রাপ্তবয়স্ক নয়:** আইনি বয়সের কম কারও বায়োডাটা আমরা মুছে ফেলি এবং অ্যাকাউন্ট নিষিদ্ধ করি।
- **রিপোর্ট:** যেকোনো বায়োডাটায় "রিপোর্ট" ব্যবহার করুন অথবা [support@ghotok.com.bd] এ লিখুন। শিশুর নিরাপত্তা সংক্রান্ত রিপোর্ট সবার আগে দেখা হয়।
- **কর্তৃপক্ষ:** কোনো শিশু বিপদে থাকতে পারে মনে হলে আমরা তথ্য সংরক্ষণ করি এবং পুলিশকে জানাই বা জাতীয় শিশু হেল্পলাইন **১০৯৮** এ যোগাযোগ করি।`,
    },
  },
];

export const FAQS = [
  {
    question: { en: 'Is creating a biodata free?', bn: 'বায়োডাটা তৈরি করা কি বিনামূল্যে?' },
    answer: {
      en: "Yes. Creating, editing, browsing and filtering biodatas are always free. You only pay when you unlock a guardian's contact details.",
      bn: 'হ্যাঁ। বায়োডাটা তৈরি, সম্পাদনা, দেখা ও ফিল্টার করা সবসময় বিনামূল্যে। শুধু অভিভাবকের যোগাযোগ আনলক করতে খরচ হয়।',
    },
  },
  {
    question: { en: 'Which religions can use Ghotok?', bn: 'কোন কোন ধর্মের মানুষ ঘটক ব্যবহার করতে পারবেন?' },
    answer: {
      en: 'Everyone. Ghotok welcomes Hindu, Muslim, Christian, Buddhist and all other communities. You can filter by religion when searching.',
      bn: 'সবাই। হিন্দু, মুসলিম, খ্রিস্টান, বৌদ্ধসহ সব সম্প্রদায়ের মানুষ ঘটক ব্যবহার করতে পারবেন। খোঁজার সময় ধর্ম অনুযায়ী ফিল্টার করা যায়।',
    },
  },
  {
    question: { en: 'What is a connection?', bn: 'কানেকশন কী?' },
    answer: {
      en: "One connection unlocks one guardian's contact details on one biodata. Once unlocked, you keep access to that contact. Connections never expire.",
      bn: 'একটি কানেকশনে একটি বায়োডাটার অভিভাবকের যোগাযোগ আনলক হয়। একবার আনলক করলে সবসময় দেখতে পাবেন। কানেকশনের মেয়াদ শেষ হয় না।',
    },
  },
  {
    question: { en: 'How do I pay?', bn: 'কীভাবে পেমেন্ট করব?' },
    answer: {
      en: 'Choose a package and pay with bKash, Nagad or Rocket. Send money to the number shown and enter the transaction ID, or use online checkout where available. Connections are added after verification.',
      bn: 'প্যাকেজ বাছাই করে বিকাশ, নগদ বা রকেটে পেমেন্ট করুন। দেখানো নম্বরে টাকা পাঠিয়ে ট্রান্সজেকশন আইডি দিন, অথবা অনলাইন চেকআউট ব্যবহার করুন। যাচাইয়ের পর কানেকশন যোগ হবে।',
    },
  },
  {
    question: { en: 'Who can see my phone number?', bn: 'আমার ফোন নম্বর কে দেখতে পাবে?' },
    answer: {
      en: "Nobody, unless they use a connection to unlock your biodata. Even then they see your guardian's number, which you provide. Your name and your parents' names are also private.",
      bn: 'কেউ না, যদি না তিনি কানেকশন দিয়ে আপনার বায়োডাটা আনলক করেন। তখনও তিনি আপনার দেওয়া অভিভাবকের নম্বর দেখবেন। আপনার ও বাবা-মায়ের নামও গোপন থাকে।',
    },
  },
  {
    question: { en: 'How long does approval take?', bn: 'অনুমোদনে কত সময় লাগে?' },
    answer: {
      en: 'Our reviewers usually check a submitted biodata within [24 hours]. If something needs changing, you will see the reason in your dashboard.',
      bn: 'জমা দেওয়া বায়োডাটা সাধারণত [২৪ ঘণ্টার] মধ্যে যাচাই করা হয়। কিছু সংশোধন লাগলে ড্যাশবোর্ডে কারণ দেখতে পাবেন।',
    },
  },
  {
    question: { en: 'Can I hide or delete my biodata?', bn: 'বায়োডাটা কি লুকিয়ে রাখা বা মুছে ফেলা যায়?' },
    answer: {
      en: 'Yes. Hide it any time from your dashboard. You can also delete it; if you change your mind, request a restore and our team will bring it back.',
      bn: 'হ্যাঁ। ড্যাশবোর্ড থেকে যেকোনো সময় লুকিয়ে রাখুন। মুছেও ফেলতে পারেন; পরে মত বদলালে পুনরুদ্ধারের আবেদন করলে আমাদের টিম ফিরিয়ে আনবে।',
    },
  },
  {
    question: { en: 'What does “NID verified” mean?', bn: '“এনআইডি যাচাইকৃত” মানে কী?' },
    answer: {
      en: 'The biodata owner uploaded their National ID card and our reviewers checked it against the biodata. NID images are never shown to other users.',
      bn: 'বায়োডাটার মালিক জাতীয় পরিচয়পত্র আপলোড করেছেন এবং আমাদের রিভিউয়ার তা যাচাই করেছেন। এনআইডির ছবি অন্য কাউকে দেখানো হয় না।',
    },
  },
].map((f, i) => ({ ...f, sortOrder: i + 1 }));
