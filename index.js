// Ghotok API: the whole server in one file.
//
// Express + MongoDB (Mongoose) + Better Auth. Run it with `node index.js` (see package.json),
// seed the database with `node index.js seed` or `node index.js seed --demo`.
//
// How this file is organised
// --------------------------
// Each part of the API is a namespace object (for example `biodataService`, `models`,
// `adminValidation`), written as `const name = (() => { ...; return { exports }; })();`.
// Code in one part reaches another through its namespace (`models.Biodata`,
// `biodataService.findPublic(...)`), so you can search for `const biodataService =` to jump
// to a part, and for `biodataService.` to find everything that uses it.
//
// Sections, in order (each part only uses parts defined above it while the file loads):
//   1. Configuration: environment, logger, database connection
//   2. Shared rules: options, locations, the biodata definition, permissions (copy kept in ghotok-client)
//   3. Utilities
//   4. Database models (Mongoose), collected in `models`
//   5. Integrations: email, SMS, payment gateways (bKash, Nagad, SSLCommerz)
//   6. Authentication (Better Auth)
//   7. Services (business rules)
//   8. Request validation schemas (Zod)
//   9. Serializers (API response shapes)
//   10. Middleware
//   11. Controllers
//   12. Routes
//   13. Express application (`appModule.createApp`)
//   14. Seed data and the seed script
//   15. Start: running the server or the seed command, and the exports used by the tests
//
// Request pipeline (see `appModule`): security headers → CORS → logging → Better Auth
// (/api/auth) → JSON body → body sanitising → origin check → rate limit → load user → routes
// → errors. Every route is listed in docs/API.md.

import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { betterAuth } from 'better-auth';
import { mongodbAdapter } from 'better-auth/adapters/mongodb';
import { APIError } from 'better-auth/api';
import { fromNodeHeaders, toNodeHandler } from 'better-auth/node';
import { emailOTP, phoneNumber } from 'better-auth/plugins';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import express, { Router } from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import mongoose from 'mongoose';
import nodemailer from 'nodemailer';
import pino from 'pino';
import { pinoHttp } from 'pino-http';
import { z } from 'zod';

// ==============================================================================================
// CONFIGURATION
// ==============================================================================================

// --- config/env.js -----------------------------------------------------------------------------
const envConfig = (() => {
  const bool = (def) =>
    z
      .enum(['true', 'false', '1', '0', ''])
      .optional()
      .transform((v) => (v === undefined || v === '' ? def : v === 'true' || v === '1'));

  const list = (def) =>
    z
      .string()
      .optional()
      .transform((v) =>
        v
          ? v
              .split(',')
              .map((s) => s.trim())
              .filter(Boolean)
          : def,
      );

  const schema = z.object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().default(4000),
    MONGODB_URI: z.string().default('mongodb://127.0.0.1:27017/ghotok'),

    // Public URLs. CLIENT_URL is the website (members and admins); payment gateways
    // redirect there and emails link to it. API_PUBLIC_URL is where gateways call back.
    CLIENT_URL: z.string().default('http://localhost:3000'),
    API_PUBLIC_URL: z.string().default('http://localhost:4000'),
    CORS_ORIGINS: list(['http://localhost:3000']),
    TRUST_PROXY: z.coerce.number().int().default(1),

    // Auth (Better Auth). BETTER_AUTH_URL is the public URL the browser uses to reach
    // /api/auth: the website's own URL when it proxies /api to this server.
    BETTER_AUTH_URL: z.string().default('http://localhost:3000'),
    BETTER_AUTH_SECRET: z.string().min(32).default('dev-better-auth-secret-change-me-0123456789'),
    COOKIE_SECURE: bool(false),
    // Members must verify their email or phone before creating a biodata or contacting families.
    REQUIRE_VERIFICATION: bool(true),
    // Logs one-time codes and keeps the last one in memory. Never enable in production.
    OTP_DEV_ECHO: bool(false),

    // Email (SMTP). When SMTP_HOST is empty, emails are written to the log.
    SMTP_HOST: z.string().optional(),
    SMTP_PORT: z.coerce.number().int().default(587),
    SMTP_USER: z.string().optional(),
    SMTP_PASS: z.string().optional(),
    MAIL_FROM: z.string().default('Ghotok <no-reply@ghotok.com.bd>'),

    // SMS. When SMS_API_URL is empty, messages are written to the log.
    // The URL may contain {number} and {message} placeholders (e.g. BulkSMSBD, SSL Wireless GET APIs).
    SMS_API_URL: z.string().optional(),

    // Payment gateways. Manual "Send Money + transaction ID" works for all three methods without any keys.
    BKASH_ENABLED: bool(false),
    BKASH_BASE_URL: z.string().default('https://tokenized.sandbox.bka.sh/v1.2.0-beta'),
    BKASH_APP_KEY: z.string().optional(),
    BKASH_APP_SECRET: z.string().optional(),
    BKASH_USERNAME: z.string().optional(),
    BKASH_PASSWORD: z.string().optional(),
    NAGAD_ENABLED: bool(false),
    NAGAD_BASE_URL: z.string().default('http://sandbox.mynagad.com:10080/remote-payment-gateway-1.0'),
    NAGAD_MERCHANT_ID: z.string().optional(),
    NAGAD_MERCHANT_NUMBER: z.string().optional(),
    NAGAD_PUBLIC_KEY: z.string().optional(),
    NAGAD_MERCHANT_PRIVATE_KEY: z.string().optional(),
    // Sign in with Google (Better Auth): create OAuth credentials with the redirect URI
    // <BETTER_AUTH_URL>/api/auth/callback/google. Leave empty to turn it off.
    GOOGLE_CLIENT_ID: z.string().optional(),
    GOOGLE_CLIENT_SECRET: z.string().optional(),

    SSLCOMMERZ_ENABLED: bool(false),
    SSLCOMMERZ_BASE_URL: z.string().default('https://sandbox.sslcommerz.com'),
    SSLCOMMERZ_STORE_ID: z.string().optional(),
    SSLCOMMERZ_STORE_PASSWORD: z.string().optional(),

    // Seed
    SEED_ADMIN_EMAIL: z.string().default('admin@ghotok.com.bd'),
    SEED_ADMIN_PASSWORD: z.string().default('ChangeMe!2026'),
    SEED_ADMIN_NAME: z.string().default('Ghotok Admin'),

    LOG_LEVEL: z.string().default('info'),
  });

  function load() {
    const parsed = schema.safeParse(process.env);
    if (!parsed.success) {
      console.error('Invalid environment configuration:', parsed.error.issues);
      process.exit(1);
    }
    const env = parsed.data;
    if (env.NODE_ENV === 'production') {
      if (env.BETTER_AUTH_SECRET.startsWith('dev-')) {
        console.error('Set a strong BETTER_AUTH_SECRET in production.');
        process.exit(1);
      }
      if (env.OTP_DEV_ECHO) {
        console.error('OTP_DEV_ECHO must be false in production.');
        process.exit(1);
      }
    }
    return env;
  }

  const env = load();
  const isProd = env.NODE_ENV === 'production';
  const isTest = env.NODE_ENV === 'test';

  return { env, isProd, isTest };
})();

// --- config/logger.js --------------------------------------------------------------------------
const loggerConfig = (() => {
  const logger = pino({
    level: envConfig.isTest ? 'silent' : envConfig.env.LOG_LEVEL,
    redact: {
      paths: [
        'req.headers.authorization',
        'req.headers.cookie',
        'res.headers["set-cookie"]',
        '*.password',
        '*.passwordHash',
      ],
      censor: '[redacted]',
    },
  });

  return { logger };
})();

// --- config/db.js ------------------------------------------------------------------------------
const dbConfig = (() => {
  mongoose.set('strictQuery', true);

  async function connectDb(uri = envConfig.env.MONGODB_URI) {
    await mongoose.connect(uri, { autoIndex: true, serverSelectionTimeoutMS: 10000 });
    loggerConfig.logger.info({ db: mongoose.connection.name }, 'MongoDB connected');
    return mongoose.connection;
  }

  async function disconnectDb() {
    await mongoose.disconnect();
  }

  return { connectDb, disconnectDb };
})();

// ==============================================================================================
// SHARED BIODATA RULES, OPTIONS AND PERMISSIONS (COPY KEPT IN GHOTOK-CLIENT)
// ==============================================================================================

// --- shared/options.js -------------------------------------------------------------------------
const sharedOptions = (() => {
  // Every selectable value used in the platform, with English and Bangla labels.
  // Values are stored in the database; labels are only for display.

  const BN_DIGITS = ['০', '১', '২', '৩', '৪', '৫', '৬', '৭', '৮', '৯'];

  const ROLES = Object.freeze({
    USER: 'user',
    ADMIN: 'admin',
  });

  // Every account starts as "user". Someone becomes an admin only when their role is
  // changed to "admin" in the database (or by another admin in the admin panel).
  const ROLE_OPTIONS = [
    { value: 'user', en: 'Member', bn: 'সদস্য' },
    { value: 'admin', en: 'Admin', bn: 'অ্যাডমিন' },
  ];

  const USER_STATUS_OPTIONS = [
    { value: 'active', en: 'Active', bn: 'সক্রিয়' },
    { value: 'suspended', en: 'Suspended', bn: 'স্থগিত' },
    { value: 'banned', en: 'Banned', bn: 'নিষিদ্ধ' },
    { value: 'deactivated', en: 'Deactivated', bn: 'নিষ্ক্রিয়' },
  ];

  const BIODATA_TYPES = [
    { value: 'bride', en: 'Bride', bn: 'পাত্রী' },
    { value: 'groom', en: 'Groom', bn: 'পাত্র' },
  ];

  const MARITAL_STATUS = [
    { value: 'never_married', en: 'Never married', bn: 'অবিবাহিত' },
    { value: 'divorced', en: 'Divorced', bn: 'তালাকপ্রাপ্ত' },
    { value: 'widowed', en: 'Widowed', bn: 'বিধবা/বিপত্নীক' },
    { value: 'separated', en: 'Separated', bn: 'আলাদা থাকেন' },
  ];

  const RELIGIONS = [
    { value: 'hindu', en: 'Hindu', bn: 'হিন্দু' },
    { value: 'muslim', en: 'Muslim', bn: 'মুসলিম' },
    { value: 'christian', en: 'Christian', bn: 'খ্রিস্টান' },
    { value: 'buddhist', en: 'Buddhist', bn: 'বৌদ্ধ' },
    { value: 'other', en: 'Other', bn: 'অন্যান্য' },
  ];

  const COMPLEXIONS = [
    { value: 'very_fair', en: 'Very fair', bn: 'উজ্জ্বল ফর্সা' },
    { value: 'fair', en: 'Fair', bn: 'ফর্সা' },
    { value: 'wheatish', en: 'Wheatish', bn: 'উজ্জ্বল শ্যামলা' },
    { value: 'brown', en: 'Brown', bn: 'শ্যামলা' },
    { value: 'dark', en: 'Dark', bn: 'কালো' },
  ];

  const BLOOD_GROUPS = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'].map((g) => ({
    value: g,
    en: g,
    bn: g,
  }));

  const YES_NO = [
    { value: 'yes', en: 'Yes', bn: 'হ্যাঁ' },
    { value: 'no', en: 'No', bn: 'না' },
  ];

  const ALIVE_STATUS = [
    { value: 'alive', en: 'Alive', bn: 'জীবিত' },
    { value: 'deceased', en: 'Deceased', bn: 'মৃত' },
  ];

  const EDUCATION_MEDIUMS = [
    { value: 'general', en: 'General (Bangla medium)', bn: 'জেনারেল (বাংলা মাধ্যম)' },
    { value: 'english', en: 'English medium', bn: 'ইংরেজি মাধ্যম' },
    { value: 'english_version', en: 'English version', bn: 'ইংলিশ ভার্সন' },
    { value: 'madrasa', en: 'Madrasa', bn: 'মাদ্রাসা' },
    { value: 'technical', en: 'Technical / vocational', bn: 'কারিগরি' },
    { value: 'other', en: 'Other', bn: 'অন্যান্য' },
  ];

  // Ordered from lowest to highest so "minimum education" comparisons work by index.
  const EDUCATION_LEVELS = [
    { value: 'below_ssc', en: 'Below SSC', bn: 'এসএসসির নিচে' },
    { value: 'ssc', en: 'SSC / Dakhil / O level', bn: 'এসএসসি / দাখিল / ও লেভেল' },
    { value: 'hsc', en: 'HSC / Alim / A level', bn: 'এইচএসসি / আলিম / এ লেভেল' },
    { value: 'diploma', en: 'Diploma', bn: 'ডিপ্লোমা' },
    { value: 'bachelor', en: 'Bachelor’s degree', bn: 'স্নাতক' },
    { value: 'masters', en: 'Master’s degree', bn: 'স্নাতকোত্তর' },
    { value: 'doctorate', en: 'Doctorate (PhD)', bn: 'ডক্টরেট (পিএইচডি)' },
  ];

  const PROFESSIONS = [
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

  const INCOME_RANGES = [
    { value: 'none', en: 'No income', bn: 'আয় নেই' },
    { value: 'below_20k', en: 'Below ৳20,000', bn: '৳২০,০০০ এর নিচে' },
    { value: '20k_40k', en: '৳20,000 – ৳40,000', bn: '৳২০,০০০ – ৳৪০,০০০' },
    { value: '40k_70k', en: '৳40,000 – ৳70,000', bn: '৳৪০,০০০ – ৳৭০,০০০' },
    { value: '70k_100k', en: '৳70,000 – ৳1,00,000', bn: '৳৭০,০০০ – ৳১,০০,০০০' },
    { value: '100k_200k', en: '৳1,00,000 – ৳2,00,000', bn: '৳১,০০,০০০ – ৳২,০০,০০০' },
    { value: 'above_200k', en: 'Above ৳2,00,000', bn: '৳২,০০,০০০ এর বেশি' },
  ];

  const ECONOMIC_STATUS = [
    { value: 'lower', en: 'Lower class', bn: 'নিম্নবিত্ত' },
    { value: 'lower_middle', en: 'Lower middle class', bn: 'নিম্ন মধ্যবিত্ত' },
    { value: 'middle', en: 'Middle class', bn: 'মধ্যবিত্ত' },
    { value: 'upper_middle', en: 'Upper middle class', bn: 'উচ্চ মধ্যবিত্ত' },
    { value: 'upper', en: 'Upper class', bn: 'উচ্চবিত্ত' },
  ];

  const DIET = [
    { value: 'non_vegetarian', en: 'Non-vegetarian', bn: 'আমিষভোজী' },
    { value: 'vegetarian', en: 'Vegetarian', bn: 'নিরামিষভোজী' },
    { value: 'eggetarian', en: 'Eggetarian', bn: 'ডিম খান, মাংস খান না' },
  ];

  const PRESENT_LOCATION = [
    { value: 'bangladesh', en: 'In Bangladesh', bn: 'বাংলাদেশে' },
    { value: 'abroad', en: 'Abroad', bn: 'প্রবাসে' },
  ];

  const GUARDIAN_RELATIONS = [
    { value: 'father', en: 'Father', bn: 'বাবা' },
    { value: 'mother', en: 'Mother', bn: 'মা' },
    { value: 'brother', en: 'Brother', bn: 'ভাই' },
    { value: 'sister', en: 'Sister', bn: 'বোন' },
    { value: 'uncle', en: 'Uncle', bn: 'চাচা/মামা' },
    { value: 'aunt', en: 'Aunt', bn: 'চাচি/খালা/ফুফু' },
    { value: 'grandparent', en: 'Grandparent', bn: 'দাদা/দাদি/নানা/নানি' },
    { value: 'other', en: 'Other relative', bn: 'অন্যান্য আত্মীয়' },
  ];

  // Heights from 4'0" to 7'0", stored in inches.
  const HEIGHTS = Array.from({ length: 37 }, (_, i) => {
    const inches = 48 + i;
    const ft = Math.floor(inches / 12);
    const inch = inches % 12;
    const en = `${ft}′ ${inch}″`;
    return { value: inches, en, bn: toBnDigits(en) };
  });

  const BIODATA_STATUS = [
    { value: 'draft', en: 'Draft', bn: 'খসড়া' },
    { value: 'pending', en: 'Under review', bn: 'রিভিউ চলছে' },
    { value: 'approved', en: 'Approved', bn: 'অনুমোদিত' },
    { value: 'rejected', en: 'Needs changes', bn: 'সংশোধন প্রয়োজন' },
  ];

  /** Situations a member may choose to disclose so families looking for them can filter on it. */
  const SPECIAL_CATEGORIES = [
    { value: 'disability', en: 'Has a disability', bn: 'প্রতিবন্ধিতা আছে' },
    { value: 'infertility', en: 'Unable to have children', bn: 'সন্তান ধারণে অক্ষম' },
    { value: 'converted', en: 'Converted to my current faith', bn: 'বর্তমান ধর্মে ধর্মান্তরিত' },
    { value: 'orphan', en: 'Orphan', bn: 'এতিম' },
  ];

  /** Why a member hides a live biodata (hiding keeps everything and can be undone). */
  const HIDE_REASONS = [
    { value: 'in_talks', en: 'In talks with a family', bn: 'একটি পরিবারের সাথে কথা চলছে' },
    { value: 'engaged', en: 'Engaged / marriage is fixed', bn: 'বিয়ে ঠিক হয়েছে' },
    { value: 'break', en: 'Taking a break', bn: 'কিছুদিনের বিরতি' },
    { value: 'privacy', en: 'Privacy concerns', bn: 'গোপনীয়তার কারণে' },
    { value: 'other', en: 'Other', bn: 'অন্যান্য' },
  ];

  const DELETE_REASONS = [
    { value: 'married_via_ghotok', en: 'Got married through Ghotok', bn: 'ঘটকের মাধ্যমে বিয়ে হয়েছে' },
    { value: 'married_elsewhere', en: 'Got married elsewhere', bn: 'অন্য মাধ্যমে বিয়ে হয়েছে' },
    { value: 'not_interested', en: 'No longer looking', bn: 'আর খুঁজছি না' },
    { value: 'privacy', en: 'Privacy concerns', bn: 'গোপনীয়তার কারণে' },
    { value: 'other', en: 'Other', bn: 'অন্যান্য' },
  ];

  const PAYMENT_METHODS = [
    { value: 'bkash', en: 'bKash', bn: 'বিকাশ' },
    { value: 'nagad', en: 'Nagad', bn: 'নগদ' },
    { value: 'rocket', en: 'Rocket', bn: 'রকেট' },
    // Online checkout only: cards, mobile banking and internet banking through SSLCommerz.
    { value: 'sslcommerz', en: 'Card / mobile banking', bn: 'কার্ড / মোবাইল ব্যাংকিং', gatewayOnly: true },
  ];

  const PAYMENT_STATUS = [
    { value: 'initiated', en: 'Awaiting payment', bn: 'পেমেন্টের অপেক্ষায়' },
    { value: 'pending', en: 'Pending review', bn: 'যাচাইয়ের অপেক্ষায়' },
    { value: 'verified', en: 'Verified', bn: 'যাচাইকৃত' },
    { value: 'rejected', en: 'Rejected', bn: 'বাতিল' },
    { value: 'failed', en: 'Failed', bn: 'ব্যর্থ' },
    { value: 'cancelled', en: 'Cancelled', bn: 'বাতিলকৃত' },
    { value: 'refunded', en: 'Refunded', bn: 'রিফান্ডকৃত' },
  ];

  const REFUND_STATUS = [
    { value: 'pending', en: 'Pending', bn: 'অপেক্ষমাণ' },
    { value: 'approved', en: 'Approved', bn: 'অনুমোদিত' },
    { value: 'rejected', en: 'Rejected', bn: 'প্রত্যাখ্যাত' },
  ];

  const REFUND_RESOLUTIONS = [
    { value: 'connection_credit', en: 'Refund as connection credit', bn: 'কানেকশন ক্রেডিট হিসেবে রিফান্ড' },
    { value: 'money_back', en: 'Return the money', bn: 'টাকা ফেরত' },
  ];

  const LEDGER_TYPES = [
    { value: 'purchase', en: 'Purchase', bn: 'ক্রয়' },
    { value: 'unlock', en: 'Contact unlocked', bn: 'যোগাযোগ আনলক' },
    { value: 'admin_grant', en: 'Granted by admin', bn: 'অ্যাডমিন প্রদান করেছেন' },
    { value: 'gift', en: 'Gift for an approved biodata', bn: 'অনুমোদিত বায়োডাটার উপহার' },
    { value: 'report_refund', en: 'Returned after a report', bn: 'রিপোর্টের পর ফেরত' },
    { value: 'admin_revoke', en: 'Revoked by admin', bn: 'অ্যাডমিন বাতিল করেছেন' },
    { value: 'refund_credit', en: 'Refund credit', bn: 'রিফান্ড ক্রেডিট' },
    { value: 'refund_revoke', en: 'Refunded (money returned)', bn: 'রিফান্ড (টাকা ফেরত)' },
  ];

  const ADJUSTMENT_ACTIONS = [
    { value: 'grant', en: 'Grant connections', bn: 'কানেকশন প্রদান' },
    { value: 'revoke', en: 'Revoke connections', bn: 'কানেকশন বাতিল' },
    { value: 'refund_credit', en: 'Refund as credit', bn: 'ক্রেডিট হিসেবে রিফান্ড' },
  ];

  const PROPOSAL_STATUS = [
    { value: 'pending', en: 'Awaiting reply', bn: 'উত্তরের অপেক্ষায়' },
    { value: 'accepted', en: 'Accepted', bn: 'গৃহীত' },
    { value: 'declined', en: 'Declined', bn: 'প্রত্যাখ্যাত' },
    { value: 'withdrawn', en: 'Withdrawn', bn: 'প্রত্যাহার করা হয়েছে' },
  ];

  const REPORT_REASONS = [
    { value: 'fake_info', en: 'Fake or misleading information', bn: 'ভুয়া বা বিভ্রান্তিকর তথ্য' },
    { value: 'wrong_contact', en: 'Wrong guardian number', bn: 'ভুল অভিভাবক নম্বর' },
    { value: 'already_married', en: 'Already married', bn: 'ইতিমধ্যে বিবাহিত' },
    { value: 'inappropriate', en: 'Inappropriate behaviour or contact', bn: 'অনুচিত আচরণ বা যোগাযোগ' },
    { value: 'fraud', en: 'Asking for money / fraud', bn: 'টাকা চাওয়া / প্রতারণা' },
    { value: 'other', en: 'Other', bn: 'অন্যান্য' },
  ];

  const REPORT_STATUS = [
    { value: 'open', en: 'Open', bn: 'খোলা' },
    { value: 'in_review', en: 'In review', bn: 'রিভিউ চলছে' },
    { value: 'resolved', en: 'Resolved', bn: 'সমাধান হয়েছে' },
    { value: 'dismissed', en: 'Dismissed', bn: 'খারিজ' },
  ];

  const TICKET_CATEGORIES = [
    { value: 'account', en: 'Account', bn: 'অ্যাকাউন্ট' },
    { value: 'biodata', en: 'Biodata', bn: 'বায়োডাটা' },
    { value: 'payment', en: 'Payment or connections', bn: 'পেমেন্ট বা কানেকশন' },
    { value: 'report', en: 'Report a problem', bn: 'সমস্যা জানান' },
    { value: 'other', en: 'Other', bn: 'অন্যান্য' },
  ];

  const TICKET_STATUS = [
    { value: 'open', en: 'Open', bn: 'খোলা' },
    { value: 'answered', en: 'Answered', bn: 'উত্তর দেওয়া হয়েছে' },
    { value: 'waiting', en: 'Waiting for support', bn: 'সাপোর্টের অপেক্ষায়' },
    { value: 'closed', en: 'Closed', bn: 'বন্ধ' },
  ];

  const TICKET_PRIORITY = [
    { value: 'low', en: 'Low', bn: 'কম' },
    { value: 'normal', en: 'Normal', bn: 'সাধারণ' },
    { value: 'high', en: 'High', bn: 'জরুরি' },
  ];

  const RESTORE_STATUS = [
    { value: 'pending', en: 'Pending', bn: 'অপেক্ষমাণ' },
    { value: 'approved', en: 'Restored', bn: 'পুনরুদ্ধার করা হয়েছে' },
    { value: 'declined', en: 'Declined', bn: 'প্রত্যাখ্যাত' },
  ];

  const SORT_OPTIONS = [
    { value: 'newest', en: 'Newest approved', bn: 'সর্বশেষ অনুমোদিত' },
    { value: 'oldest', en: 'Oldest first', bn: 'পুরোনো আগে' },
    { value: 'age_asc', en: 'Age: low to high', bn: 'বয়স: কম থেকে বেশি' },
    { value: 'age_desc', en: 'Age: high to low', bn: 'বয়স: বেশি থেকে কম' },
  ];

  /** Converts ASCII digits in a string or number to Bangla digits. */
  function toBnDigits(input) {
    return String(input ?? '').replace(/[0-9]/g, (d) => BN_DIGITS[Number(d)]);
  }

  /** Formats a number for the given language, using Bangla digits for "bn". */
  function formatNumber(value, lang = 'en') {
    const s = Number(value ?? 0).toLocaleString('en-IN');
    return lang === 'bn' ? toBnDigits(s) : s;
  }

  /** Returns the label of `value` in `options` for `lang`, or the raw value. */
  function optionLabel(options, value, lang = 'en') {
    if (value === undefined || value === null || value === '') return '';
    const found = options.find((o) => String(o.value) === String(value));
    if (!found) return String(value);
    return found[lang] ?? found.en;
  }

  /** Returns the values of an option list, e.g. for enum validation. */
  function optionValues(options) {
    return options.map((o) => o.value);
  }

  return {
    ROLES,
    ROLE_OPTIONS,
    USER_STATUS_OPTIONS,
    BIODATA_TYPES,
    MARITAL_STATUS,
    RELIGIONS,
    COMPLEXIONS,
    BLOOD_GROUPS,
    YES_NO,
    ALIVE_STATUS,
    EDUCATION_MEDIUMS,
    EDUCATION_LEVELS,
    PROFESSIONS,
    INCOME_RANGES,
    ECONOMIC_STATUS,
    DIET,
    PRESENT_LOCATION,
    GUARDIAN_RELATIONS,
    HEIGHTS,
    BIODATA_STATUS,
    SPECIAL_CATEGORIES,
    HIDE_REASONS,
    DELETE_REASONS,
    PAYMENT_METHODS,
    PAYMENT_STATUS,
    REFUND_STATUS,
    REFUND_RESOLUTIONS,
    LEDGER_TYPES,
    ADJUSTMENT_ACTIONS,
    PROPOSAL_STATUS,
    REPORT_REASONS,
    REPORT_STATUS,
    TICKET_CATEGORIES,
    TICKET_STATUS,
    TICKET_PRIORITY,
    RESTORE_STATUS,
    SORT_OPTIONS,
    toBnDigits,
    formatNumber,
    optionLabel,
    optionValues,
  };
})();

// --- shared/locations.js -----------------------------------------------------------------------
const sharedLocations = (() => {
  // Divisions and districts of Bangladesh with English and Bangla names.
  // District values are stable slugs stored in the database.

  const DIVISIONS = [
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

  const DIVISION_OPTIONS = DIVISIONS.map(({ value, en, bn }) => ({ value, en, bn }));

  const DISTRICTS = DIVISIONS.flatMap((d) => d.districts).sort((a, b) => a.en.localeCompare(b.en));

  /** Returns the districts of a division, or all districts when no division is given. */
  function districtsOf(division) {
    if (!division) return DISTRICTS;
    return DIVISIONS.find((d) => d.value === division)?.districts ?? [];
  }

  /** Returns the division value that contains `district`, if any. */
  function divisionOf(district) {
    return DISTRICTS.find((d) => d.value === district)?.division;
  }

  return { DIVISIONS, DIVISION_OPTIONS, DISTRICTS, districtsOf, divisionOf };
})();

// --- shared/upazilas.js ------------------------------------------------------------------------
const sharedUpazilas = (() => {
  // Upazilas (sub-districts) of Bangladesh by district, with English and Bangla names.
  // Generated from nuhil/bangladesh-geocode (MIT License, (c) 2014 Nuhil Mehdy).
  // Values are stable slugs stored in the database: <district>_<upazila>.

  /* prettier-ignore */
  const RAW = {
  "bagerhat": [
    ["bagerhat_bagerhat_sadar","Bagerhat Sadar","বাগেরহাট সদর"],
    ["bagerhat_chitalmari","Chitalmari","চিতলমারী"],
    ["bagerhat_fakirhat","Fakirhat","ফকিরহাট"],
    ["bagerhat_kachua","Kachua","কচুয়া"],
    ["bagerhat_mollahat","Mollahat","মোল্লাহাট"],
    ["bagerhat_mongla","Mongla","মোংলা"],
    ["bagerhat_morrelganj","Morrelganj","মোড়েলগঞ্জ"],
    ["bagerhat_rampal","Rampal","রামপাল"],
    ["bagerhat_sarankhola","Sarankhola","শরণখোলা"],
  ],
  "bandarban": [
    ["bandarban_alikadam","Alikadam","আলীকদম"],
    ["bandarban_bandarban_sadar","Bandarban Sadar","বান্দরবান সদর"],
    ["bandarban_lama","Lama","লামা"],
    ["bandarban_naikhongchhari","Naikhongchhari","নাইক্ষ্যংছড়ি"],
    ["bandarban_rowangchhari","Rowangchhari","রোয়াংছড়ি"],
    ["bandarban_ruma","Ruma","রুমা"],
    ["bandarban_thanchi","Thanchi","থানচি"],
  ],
  "barguna": [
    ["barguna_amtali","Amtali","আমতলী"],
    ["barguna_bamna","Bamna","বামনা"],
    ["barguna_barguna_sadar","Barguna Sadar","বরগুনা সদর"],
    ["barguna_betagi","Betagi","বেতাগী"],
    ["barguna_pathorghata","Pathorghata","পাথরঘাটা"],
    ["barguna_taltali","Taltali","তালতলি"],
  ],
  "barishal": [
    ["barishal_agailjhara","Agailjhara","আগৈলঝাড়া"],
    ["barishal_babuganj","Babuganj","বাবুগঞ্জ"],
    ["barishal_bakerganj","Bakerganj","বাকেরগঞ্জ"],
    ["barishal_banaripara","Banaripara","বানারীপাড়া"],
    ["barishal_barisal_sadar","Barisal Sadar","বরিশাল সদর"],
    ["barishal_gournadi","Gournadi","গৌরনদী"],
    ["barishal_hizla","Hizla","হিজলা"],
    ["barishal_mehendiganj","Mehendiganj","মেহেন্দিগঞ্জ"],
    ["barishal_muladi","Muladi","মুলাদী"],
    ["barishal_wazirpur","Wazirpur","উজিরপুর"],
  ],
  "bhola": [
    ["bhola_bhola_sadar","Bhola Sadar","ভোলা সদর"],
    ["bhola_borhan_sddin","Borhan Sddin","বোরহান উদ্দিন"],
    ["bhola_charfesson","Charfesson","চরফ্যাশন"],
    ["bhola_doulatkhan","Doulatkhan","দৌলতখান"],
    ["bhola_lalmohan","Lalmohan","লালমোহন"],
    ["bhola_monpura","Monpura","মনপুরা"],
    ["bhola_tazumuddin","Tazumuddin","তজুমদ্দিন"],
  ],
  "bogura": [
    ["bogura_adamdighi","Adamdighi","আদমদিঘি"],
    ["bogura_bogra_sadar","Bogra Sadar","বগুড়া সদর"],
    ["bogura_dhunot","Dhunot","ধুনট"],
    ["bogura_dupchanchia","Dupchanchia","দুপচাচিঁয়া"],
    ["bogura_gabtali","Gabtali","গাবতলী"],
    ["bogura_kahaloo","Kahaloo","কাহালু"],
    ["bogura_nondigram","Nondigram","নন্দিগ্রাম"],
    ["bogura_shajahanpur","Shajahanpur","শাজাহানপুর"],
    ["bogura_shariakandi","Shariakandi","সারিয়াকান্দি"],
    ["bogura_sherpur","Sherpur","শেরপুর"],
    ["bogura_shibganj","Shibganj","শিবগঞ্জ"],
    ["bogura_sonatala","Sonatala","সোনাতলা"],
  ],
  "brahmanbaria": [
    ["brahmanbaria_akhaura","Akhaura","আখাউড়া"],
    ["brahmanbaria_ashuganj","Ashuganj","আশুগঞ্জ"],
    ["brahmanbaria_bancharampur","Bancharampur","বাঞ্ছারামপুর"],
    ["brahmanbaria_bijoynagar","Bijoynagar","বিজয়নগর"],
    ["brahmanbaria_brahmanbaria_sadar","Brahmanbaria Sadar","ব্রাহ্মণবাড়িয়া সদর"],
    ["brahmanbaria_kasba","Kasba","কসবা"],
    ["brahmanbaria_nabinagar","Nabinagar","নবীনগর"],
    ["brahmanbaria_nasirnagar","Nasirnagar","নাসিরনগর"],
    ["brahmanbaria_sarail","Sarail","সরাইল"],
  ],
  "chandpur": [
    ["chandpur_chandpur_sadar","Chandpur Sadar","চাঁদপুর সদর"],
    ["chandpur_faridgonj","Faridgonj","ফরিদগঞ্জ"],
    ["chandpur_haimchar","Haimchar","হাইমচর"],
    ["chandpur_hajiganj","Hajiganj","হাজীগঞ্জ"],
    ["chandpur_kachua","Kachua","কচুয়া"],
    ["chandpur_matlab_north","Matlab North","মতলব উত্তর"],
    ["chandpur_matlab_south","Matlab South","মতলব দক্ষিণ"],
    ["chandpur_shahrasti","Shahrasti","শাহরাস্তি"],
  ],
  "chapainawabganj": [
    ["chapainawabganj_bholahat","Bholahat","ভোলাহাট"],
    ["chapainawabganj_chapainawabganj_sadar","Chapainawabganj Sadar","চাঁপাইনবাবগঞ্জ সদর"],
    ["chapainawabganj_gomostapur","Gomostapur","গোমস্তাপুর"],
    ["chapainawabganj_nachol","Nachol","নাচোল"],
    ["chapainawabganj_shibganj","Shibganj","শিবগঞ্জ"],
  ],
  "chattogram": [
    ["chattogram_anwara","Anwara","আনোয়ারা"],
    ["chattogram_banshkhali","Banshkhali","বাঁশখালী"],
    ["chattogram_boalkhali","Boalkhali","বোয়ালখালী"],
    ["chattogram_chandanaish","Chandanaish","চন্দনাইশ"],
    ["chattogram_fatikchhari","Fatikchhari","ফটিকছড়ি"],
    ["chattogram_hathazari","Hathazari","হাটহাজারী"],
    ["chattogram_karnafuli","Karnafuli","কর্ণফুলী"],
    ["chattogram_lohagara","Lohagara","লোহাগাড়া"],
    ["chattogram_mirsharai","Mirsharai","মীরসরাই"],
    ["chattogram_patiya","Patiya","পটিয়া"],
    ["chattogram_rangunia","Rangunia","রাঙ্গুনিয়া"],
    ["chattogram_raozan","Raozan","রাউজান"],
    ["chattogram_sandwip","Sandwip","সন্দ্বীপ"],
    ["chattogram_satkania","Satkania","সাতকানিয়া"],
    ["chattogram_sitakunda","Sitakunda","সীতাকুন্ড"],
  ],
  "chuadanga": [
    ["chuadanga_alamdanga","Alamdanga","আলমডাঙ্গা"],
    ["chuadanga_chuadanga_sadar","Chuadanga Sadar","চুয়াডাঙ্গা সদর"],
    ["chuadanga_damurhuda","Damurhuda","দামুড়হুদা"],
    ["chuadanga_jibannagar","Jibannagar","জীবননগর"],
  ],
  "coxs_bazar": [
    ["coxs_bazar_chakaria","Chakaria","চকরিয়া"],
    ["coxs_bazar_coxsbazar_sadar","Coxsbazar Sadar","কক্সবাজার সদর"],
    ["coxs_bazar_eidgaon","Eidgaon","ঈদগাঁও"],
    ["coxs_bazar_kutubdia","Kutubdia","কুতুবদিয়া"],
    ["coxs_bazar_moheshkhali","Moheshkhali","মহেশখালী"],
    ["coxs_bazar_pekua","Pekua","পেকুয়া"],
    ["coxs_bazar_ramu","Ramu","রামু"],
    ["coxs_bazar_teknaf","Teknaf","টেকনাফ"],
    ["coxs_bazar_ukhiya","Ukhiya","উখিয়া"],
  ],
  "cumilla": [
    ["cumilla_barura","Barura","বরুড়া"],
    ["cumilla_brahmanpara","Brahmanpara","ব্রাহ্মণপাড়া"],
    ["cumilla_burichang","Burichang","বুড়িচং"],
    ["cumilla_chandina","Chandina","চান্দিনা"],
    ["cumilla_chauddagram","Chauddagram","চৌদ্দগ্রাম"],
    ["cumilla_comilla_sadar","Comilla Sadar","কুমিল্লা সদর"],
    ["cumilla_daudkandi","Daudkandi","দাউদকান্দি"],
    ["cumilla_debidwar","Debidwar","দেবিদ্বার"],
    ["cumilla_homna","Homna","হোমনা"],
    ["cumilla_laksam","Laksam","লাকসাম"],
    ["cumilla_lalmai","Lalmai","লালমাই"],
    ["cumilla_meghna","Meghna","মেঘনা"],
    ["cumilla_monohargonj","Monohargonj","মনোহরগঞ্জ"],
    ["cumilla_muradnagar","Muradnagar","মুরাদনগর"],
    ["cumilla_nangalkot","Nangalkot","নাঙ্গলকোট"],
    ["cumilla_sadarsouth","Sadarsouth","সদর দক্ষিণ"],
    ["cumilla_titas","Titas","তিতাস"],
  ],
  "dhaka": [
    ["dhaka_dhamrai","Dhamrai","ধামরাই"],
    ["dhaka_dohar","Dohar","দোহার"],
    ["dhaka_keraniganj","Keraniganj","কেরাণীগঞ্জ"],
    ["dhaka_nawabganj","Nawabganj","নবাবগঞ্জ"],
    ["dhaka_savar","Savar","সাভার"],
  ],
  "dinajpur": [
    ["dinajpur_birampur","Birampur","বিরামপুর"],
    ["dinajpur_birganj","Birganj","বীরগঞ্জ"],
    ["dinajpur_birol","Birol","বিরল"],
    ["dinajpur_bochaganj","Bochaganj","বোচাগঞ্জ"],
    ["dinajpur_chirirbandar","Chirirbandar","চিরিরবন্দর"],
    ["dinajpur_dinajpur_sadar","Dinajpur Sadar","দিনাজপুর সদর"],
    ["dinajpur_fulbari","Fulbari","ফুলবাড়ী"],
    ["dinajpur_ghoraghat","Ghoraghat","ঘোড়াঘাট"],
    ["dinajpur_hakimpur","Hakimpur","হাকিমপুর"],
    ["dinajpur_kaharol","Kaharol","কাহারোল"],
    ["dinajpur_khansama","Khansama","খানসামা"],
    ["dinajpur_nawabganj","Nawabganj","নবাবগঞ্জ"],
    ["dinajpur_parbatipur","Parbatipur","পার্বতীপুর"],
  ],
  "faridpur": [
    ["faridpur_alfadanga","Alfadanga","আলফাডাঙ্গা"],
    ["faridpur_bhanga","Bhanga","ভাঙ্গা"],
    ["faridpur_boalmari","Boalmari","বোয়ালমারী"],
    ["faridpur_charbhadrasan","Charbhadrasan","চরভদ্রাসন"],
    ["faridpur_faridpur_sadar","Faridpur Sadar","ফরিদপুর সদর"],
    ["faridpur_madhukhali","Madhukhali","মধুখালী"],
    ["faridpur_nagarkanda","Nagarkanda","নগরকান্দা"],
    ["faridpur_sadarpur","Sadarpur","সদরপুর"],
    ["faridpur_saltha","Saltha","সালথা"],
  ],
  "feni": [
    ["feni_chhagalnaiya","Chhagalnaiya","ছাগলনাইয়া"],
    ["feni_daganbhuiyan","Daganbhuiyan","দাগনভূঞা"],
    ["feni_feni_sadar","Feni Sadar","ফেনী সদর"],
    ["feni_fulgazi","Fulgazi","ফুলগাজী"],
    ["feni_parshuram","Parshuram","পরশুরাম"],
    ["feni_sonagazi","Sonagazi","সোনাগাজী"],
  ],
  "gaibandha": [
    ["gaibandha_gaibandha_sadar","Gaibandha Sadar","গাইবান্ধা সদর"],
    ["gaibandha_gobindaganj","Gobindaganj","গোবিন্দগঞ্জ"],
    ["gaibandha_palashbari","Palashbari","পলাশবাড়ী"],
    ["gaibandha_phulchari","Phulchari","ফুলছড়ি"],
    ["gaibandha_sadullapur","Sadullapur","সাদুল্লাপুর"],
    ["gaibandha_saghata","Saghata","সাঘাটা"],
    ["gaibandha_sundarganj","Sundarganj","সুন্দরগঞ্জ"],
  ],
  "gazipur": [
    ["gazipur_gazipur_sadar","Gazipur Sadar","গাজীপুর সদর"],
    ["gazipur_kaliakair","Kaliakair","কালিয়াকৈর"],
    ["gazipur_kaliganj","Kaliganj","কালীগঞ্জ"],
    ["gazipur_kapasia","Kapasia","কাপাসিয়া"],
    ["gazipur_sreepur","Sreepur","শ্রীপুর"],
  ],
  "gopalganj": [
    ["gopalganj_gopalganj_sadar","Gopalganj Sadar","গোপালগঞ্জ সদর"],
    ["gopalganj_kashiani","Kashiani","কাশিয়ানী"],
    ["gopalganj_kotalipara","Kotalipara","কোটালীপাড়া"],
    ["gopalganj_muksudpur","Muksudpur","মুকসুদপুর"],
    ["gopalganj_tungipara","Tungipara","টুংগীপাড়া"],
  ],
  "habiganj": [
    ["habiganj_ajmiriganj","Ajmiriganj","আজমিরীগঞ্জ"],
    ["habiganj_bahubal","Bahubal","বাহুবল"],
    ["habiganj_baniachong","Baniachong","বানিয়াচং"],
    ["habiganj_chunarughat","Chunarughat","চুনারুঘাট"],
    ["habiganj_habiganj_sadar","Habiganj Sadar","হবিগঞ্জ সদর"],
    ["habiganj_lakhai","Lakhai","লাখাই"],
    ["habiganj_madhabpur","Madhabpur","মাধবপুর"],
    ["habiganj_nabiganj","Nabiganj","নবীগঞ্জ"],
  ],
  "jamalpur": [
    ["jamalpur_bokshiganj","Bokshiganj","বকশীগঞ্জ"],
    ["jamalpur_dewangonj","Dewangonj","দেওয়ানগঞ্জ"],
    ["jamalpur_islampur","Islampur","ইসলামপুর"],
    ["jamalpur_jamalpur_sadar","Jamalpur Sadar","জামালপুর সদর"],
    ["jamalpur_madarganj","Madarganj","মাদারগঞ্জ"],
    ["jamalpur_melandah","Melandah","মেলান্দহ"],
    ["jamalpur_sarishabari","Sarishabari","সরিষাবাড়ী"],
  ],
  "jashore": [
    ["jashore_abhaynagar","Abhaynagar","অভয়নগর"],
    ["jashore_bagherpara","Bagherpara","বাঘারপাড়া"],
    ["jashore_chougachha","Chougachha","চৌগাছা"],
    ["jashore_jessore_sadar","Jessore Sadar","যশোর সদর"],
    ["jashore_jhikargacha","Jhikargacha","ঝিকরগাছা"],
    ["jashore_keshabpur","Keshabpur","কেশবপুর"],
    ["jashore_manirampur","Manirampur","মণিরামপুর"],
    ["jashore_sharsha","Sharsha","শার্শা"],
  ],
  "jhalokati": [
    ["jhalokati_jhalakathi_sadar","Jhalakathi Sadar","ঝালকাঠি সদর"],
    ["jhalokati_kathalia","Kathalia","কাঠালিয়া"],
    ["jhalokati_nalchity","Nalchity","নলছিটি"],
    ["jhalokati_rajapur","Rajapur","রাজাপুর"],
  ],
  "jhenaidah": [
    ["jhenaidah_harinakundu","Harinakundu","হরিণাকুন্ডু"],
    ["jhenaidah_jhenaidah_sadar","Jhenaidah Sadar","ঝিনাইদহ সদর"],
    ["jhenaidah_kaliganj","Kaliganj","কালীগঞ্জ"],
    ["jhenaidah_kotchandpur","Kotchandpur","কোটচাঁদপুর"],
    ["jhenaidah_moheshpur","Moheshpur","মহেশপুর"],
    ["jhenaidah_shailkupa","Shailkupa","শৈলকুপা"],
  ],
  "joypurhat": [
    ["joypurhat_akkelpur","Akkelpur","আক্কেলপুর"],
    ["joypurhat_joypurhat_sadar","Joypurhat Sadar","জয়পুরহাট সদর"],
    ["joypurhat_kalai","Kalai","কালাই"],
    ["joypurhat_khetlal","Khetlal","ক্ষেতলাল"],
    ["joypurhat_panchbibi","Panchbibi","পাঁচবিবি"],
  ],
  "khagrachhari": [
    ["khagrachhari_dighinala","Dighinala","দিঘীনালা"],
    ["khagrachhari_guimara","Guimara","গুইমারা"],
    ["khagrachhari_khagrachhari_sadar","Khagrachhari Sadar","খাগড়াছড়ি সদর"],
    ["khagrachhari_laxmichhari","Laxmichhari","লক্ষীছড়ি"],
    ["khagrachhari_manikchari","Manikchari","মানিকছড়ি"],
    ["khagrachhari_matiranga","Matiranga","মাটিরাঙ্গা"],
    ["khagrachhari_mohalchari","Mohalchari","মহালছড়ি"],
    ["khagrachhari_panchari","Panchari","পানছড়ি"],
    ["khagrachhari_ramgarh","Ramgarh","রামগড়"],
  ],
  "khulna": [
    ["khulna_botiaghata","Botiaghata","বটিয়াঘাটা"],
    ["khulna_dakop","Dakop","দাকোপ"],
    ["khulna_digholia","Digholia","দিঘলিয়া"],
    ["khulna_dumuria","Dumuria","ডুমুরিয়া"],
    ["khulna_fultola","Fultola","ফুলতলা"],
    ["khulna_koyra","Koyra","কয়রা"],
    ["khulna_paikgasa","Paikgasa","পাইকগাছা"],
    ["khulna_rupsha","Rupsha","রূপসা"],
    ["khulna_terokhada","Terokhada","তেরখাদা"],
  ],
  "kishoreganj": [
    ["kishoreganj_austagram","Austagram","অষ্টগ্রাম"],
    ["kishoreganj_bajitpur","Bajitpur","বাজিতপুর"],
    ["kishoreganj_bhairab","Bhairab","ভৈরব"],
    ["kishoreganj_hossainpur","Hossainpur","হোসেনপুর"],
    ["kishoreganj_itna","Itna","ইটনা"],
    ["kishoreganj_karimgonj","Karimgonj","করিমগঞ্জ"],
    ["kishoreganj_katiadi","Katiadi","কটিয়াদী"],
    ["kishoreganj_kishoreganj_sadar","Kishoreganj Sadar","কিশোরগঞ্জ সদর"],
    ["kishoreganj_kuliarchar","Kuliarchar","কুলিয়ারচর"],
    ["kishoreganj_mithamoin","Mithamoin","মিঠামইন"],
    ["kishoreganj_nikli","Nikli","নিকলী"],
    ["kishoreganj_pakundia","Pakundia","পাকুন্দিয়া"],
    ["kishoreganj_tarail","Tarail","তাড়াইল"],
  ],
  "kurigram": [
    ["kurigram_bhurungamari","Bhurungamari","ভুরুঙ্গামারী"],
    ["kurigram_charrajibpur","Charrajibpur","চর রাজিবপুর"],
    ["kurigram_chilmari","Chilmari","চিলমারী"],
    ["kurigram_kurigram_sadar","Kurigram Sadar","কুড়িগ্রাম সদর"],
    ["kurigram_nageshwari","Nageshwari","নাগেশ্বরী"],
    ["kurigram_phulbari","Phulbari","ফুলবাড়ী"],
    ["kurigram_rajarhat","Rajarhat","রাজারহাট"],
    ["kurigram_rowmari","Rowmari","রৌমারী"],
    ["kurigram_ulipur","Ulipur","উলিপুর"],
  ],
  "kushtia": [
    ["kushtia_bheramara","Bheramara","ভেড়ামারা"],
    ["kushtia_daulatpur","Daulatpur","দৌলতপুর"],
    ["kushtia_khoksa","Khoksa","খোকসা"],
    ["kushtia_kumarkhali","Kumarkhali","কুমারখালী"],
    ["kushtia_kushtia_sadar","Kushtia Sadar","কুষ্টিয়া সদর"],
    ["kushtia_mirpur","Mirpur","মিরপুর"],
  ],
  "lakshmipur": [
    ["lakshmipur_kamalnagar","Kamalnagar","কমলনগর"],
    ["lakshmipur_lakshmipur_sadar","Lakshmipur Sadar","লক্ষ্মীপুর সদর"],
    ["lakshmipur_raipur","Raipur","রায়পুর"],
    ["lakshmipur_ramganj","Ramganj","রামগঞ্জ"],
    ["lakshmipur_ramgati","Ramgati","রামগতি"],
  ],
  "lalmonirhat": [
    ["lalmonirhat_aditmari","Aditmari","আদিতমারী"],
    ["lalmonirhat_hatibandha","Hatibandha","হাতীবান্ধা"],
    ["lalmonirhat_kaliganj","Kaliganj","কালীগঞ্জ"],
    ["lalmonirhat_lalmonirhat_sadar","Lalmonirhat Sadar","লালমনিরহাট সদর"],
    ["lalmonirhat_patgram","Patgram","পাটগ্রাম"],
  ],
  "madaripur": [
    ["madaripur_dasar","Dasar","ডাসার"],
    ["madaripur_kalkini","Kalkini","কালকিনি"],
    ["madaripur_madaripur_sadar","Madaripur Sadar","মাদারীপুর সদর"],
    ["madaripur_rajoir","Rajoir","রাজৈর"],
    ["madaripur_shibchar","Shibchar","শিবচর"],
  ],
  "magura": [
    ["magura_magura_sadar","Magura Sadar","মাগুরা সদর"],
    ["magura_mohammadpur","Mohammadpur","মহম্মদপুর"],
    ["magura_shalikha","Shalikha","শালিখা"],
    ["magura_sreepur","Sreepur","শ্রীপুর"],
  ],
  "manikganj": [
    ["manikganj_doulatpur","Doulatpur","দৌলতপুর"],
    ["manikganj_gior","Gior","ঘিওর"],
    ["manikganj_harirampur","Harirampur","হরিরামপুর"],
    ["manikganj_manikganj_sadar","Manikganj Sadar","মানিকগঞ্জ সদর"],
    ["manikganj_saturia","Saturia","সাটুরিয়া"],
    ["manikganj_shibaloy","Shibaloy","শিবালয়"],
    ["manikganj_singiar","Singiar","সিংগাইর"],
  ],
  "meherpur": [
    ["meherpur_gangni","Gangni","গাংনী"],
    ["meherpur_meherpur_sadar","Meherpur Sadar","মেহেরপুর সদর"],
    ["meherpur_mujibnagar","Mujibnagar","মুজিবনগর"],
  ],
  "moulvibazar": [
    ["moulvibazar_barlekha","Barlekha","বড়লেখা"],
    ["moulvibazar_juri","Juri","জুড়ী"],
    ["moulvibazar_kamolganj","Kamolganj","কমলগঞ্জ"],
    ["moulvibazar_kulaura","Kulaura","কুলাউড়া"],
    ["moulvibazar_moulvibazar_sadar","Moulvibazar Sadar","মৌলভীবাজার সদর"],
    ["moulvibazar_rajnagar","Rajnagar","রাজনগর"],
    ["moulvibazar_sreemangal","Sreemangal","শ্রীমঙ্গল"],
  ],
  "munshiganj": [
    ["munshiganj_gajaria","Gajaria","গজারিয়া"],
    ["munshiganj_louhajanj","Louhajanj","লৌহজং"],
    ["munshiganj_munshiganj_sadar","Munshiganj Sadar","মুন্সিগঞ্জ সদর"],
    ["munshiganj_sirajdikhan","Sirajdikhan","সিরাজদিখান"],
    ["munshiganj_sreenagar","Sreenagar","শ্রীনগর"],
    ["munshiganj_tongibari","Tongibari","টংগীবাড়ি"],
  ],
  "mymensingh": [
    ["mymensingh_bhaluka","Bhaluka","ভালুকা"],
    ["mymensingh_dhobaura","Dhobaura","ধোবাউড়া"],
    ["mymensingh_fulbaria","Fulbaria","ফুলবাড়ীয়া"],
    ["mymensingh_gafargaon","Gafargaon","গফরগাঁও"],
    ["mymensingh_gouripur","Gouripur","গৌরীপুর"],
    ["mymensingh_haluaghat","Haluaghat","হালুয়াঘাট"],
    ["mymensingh_iswarganj","Iswarganj","ঈশ্বরগঞ্জ"],
    ["mymensingh_muktagacha","Muktagacha","মুক্তাগাছা"],
    ["mymensingh_mymensingh_sadar","Mymensingh Sadar","ময়মনসিংহ সদর"],
    ["mymensingh_nandail","Nandail","নান্দাইল"],
    ["mymensingh_phulpur","Phulpur","ফুলপুর"],
    ["mymensingh_tarakanda","Tarakanda","তারাকান্দা"],
    ["mymensingh_trishal","Trishal","ত্রিশাল"],
  ],
  "naogaon": [
    ["naogaon_atrai","Atrai","আত্রাই"],
    ["naogaon_badalgachi","Badalgachi","বদলগাছী"],
    ["naogaon_dhamoirhat","Dhamoirhat","ধামইরহাট"],
    ["naogaon_manda","Manda","মান্দা"],
    ["naogaon_mohadevpur","Mohadevpur","মহাদেবপুর"],
    ["naogaon_naogaon_sadar","Naogaon Sadar","নওগাঁ সদর"],
    ["naogaon_niamatpur","Niamatpur","নিয়ামতপুর"],
    ["naogaon_patnitala","Patnitala","পত্নিতলা"],
    ["naogaon_porsha","Porsha","পোরশা"],
    ["naogaon_raninagar","Raninagar","রাণীনগর"],
    ["naogaon_sapahar","Sapahar","সাপাহার"],
  ],
  "narail": [
    ["narail_kalia","Kalia","কালিয়া"],
    ["narail_lohagara","Lohagara","লোহাগড়া"],
    ["narail_narail_sadar","Narail Sadar","নড়াইল সদর"],
  ],
  "narayanganj": [
    ["narayanganj_araihazar","Araihazar","আড়াইহাজার"],
    ["narayanganj_bandar","Bandar","বন্দর"],
    ["narayanganj_narayanganj_sadar","Narayanganj Sadar","নারায়নগঞ্জ সদর"],
    ["narayanganj_rupganj","Rupganj","রূপগঞ্জ"],
    ["narayanganj_sonargaon","Sonargaon","সোনারগাঁ"],
  ],
  "narsingdi": [
    ["narsingdi_belabo","Belabo","বেলাবো"],
    ["narsingdi_monohardi","Monohardi","মনোহরদী"],
    ["narsingdi_narsingdi_sadar","Narsingdi Sadar","নরসিংদী সদর"],
    ["narsingdi_palash","Palash","পলাশ"],
    ["narsingdi_raipura","Raipura","রায়পুরা"],
    ["narsingdi_shibpur","Shibpur","শিবপুর"],
  ],
  "natore": [
    ["natore_bagatipara","Bagatipara","বাগাতিপাড়া"],
    ["natore_baraigram","Baraigram","বড়াইগ্রাম"],
    ["natore_gurudaspur","Gurudaspur","গুরুদাসপুর"],
    ["natore_lalpur","Lalpur","লালপুর"],
    ["natore_naldanga","Naldanga","নলডাঙ্গা"],
    ["natore_natore_sadar","Natore Sadar","নাটোর সদর"],
    ["natore_singra","Singra","সিংড়া"],
  ],
  "netrokona": [
    ["netrokona_atpara","Atpara","আটপাড়া"],
    ["netrokona_barhatta","Barhatta","বারহাট্টা"],
    ["netrokona_durgapur","Durgapur","দুর্গাপুর"],
    ["netrokona_kalmakanda","Kalmakanda","কলমাকান্দা"],
    ["netrokona_kendua","Kendua","কেন্দুয়া"],
    ["netrokona_khaliajuri","Khaliajuri","খালিয়াজুরী"],
    ["netrokona_madan","Madan","মদন"],
    ["netrokona_mohongonj","Mohongonj","মোহনগঞ্জ"],
    ["netrokona_netrokona_sadar","Netrokona Sadar","নেত্রকোণা সদর"],
    ["netrokona_purbadhala","Purbadhala","পূর্বধলা"],
  ],
  "nilphamari": [
    ["nilphamari_dimla","Dimla","ডিমলা"],
    ["nilphamari_domar","Domar","ডোমার"],
    ["nilphamari_jaldhaka","Jaldhaka","জলঢাকা"],
    ["nilphamari_kishorganj","Kishorganj","কিশোরগঞ্জ"],
    ["nilphamari_nilphamari_sadar","Nilphamari Sadar","নীলফামারী সদর"],
    ["nilphamari_syedpur","Syedpur","সৈয়দপুর"],
  ],
  "noakhali": [
    ["noakhali_begumganj","Begumganj","বেগমগঞ্জ"],
    ["noakhali_chatkhil","Chatkhil","চাটখিল"],
    ["noakhali_companiganj","Companiganj","কোম্পানীগঞ্জ"],
    ["noakhali_hatia","Hatia","হাতিয়া"],
    ["noakhali_kabirhat","Kabirhat","কবিরহাট"],
    ["noakhali_noakhali_sadar","Noakhali Sadar","নোয়াখালী সদর"],
    ["noakhali_senbug","Senbug","সেনবাগ"],
    ["noakhali_sonaimori","Sonaimori","সোনাইমুড়ী"],
    ["noakhali_subarnachar","Subarnachar","সুবর্ণচর"],
  ],
  "pabna": [
    ["pabna_atghoria","Atghoria","আটঘরিয়া"],
    ["pabna_bera","Bera","বেড়া"],
    ["pabna_bhangura","Bhangura","ভাঙ্গুড়া"],
    ["pabna_chatmohar","Chatmohar","চাটমোহর"],
    ["pabna_faridpur","Faridpur","ফরিদপুর"],
    ["pabna_ishurdi","Ishurdi","ঈশ্বরদী"],
    ["pabna_pabna_sadar","Pabna Sadar","পাবনা সদর"],
    ["pabna_santhia","Santhia","সাঁথিয়া"],
    ["pabna_sujanagar","Sujanagar","সুজানগর"],
  ],
  "panchagarh": [
    ["panchagarh_atwari","Atwari","আটোয়ারী"],
    ["panchagarh_boda","Boda","বোদা"],
    ["panchagarh_debiganj","Debiganj","দেবীগঞ্জ"],
    ["panchagarh_panchagarh_sadar","Panchagarh Sadar","পঞ্চগড় সদর"],
    ["panchagarh_tetulia","Tetulia","তেতুলিয়া"],
  ],
  "patuakhali": [
    ["patuakhali_bauphal","Bauphal","বাউফল"],
    ["patuakhali_dashmina","Dashmina","দশমিনা"],
    ["patuakhali_dumki","Dumki","দুমকি"],
    ["patuakhali_galachipa","Galachipa","গলাচিপা"],
    ["patuakhali_kalapara","Kalapara","কলাপাড়া"],
    ["patuakhali_mirzaganj","Mirzaganj","মির্জাগঞ্জ"],
    ["patuakhali_patuakhali_sadar","Patuakhali Sadar","পটুয়াখালী সদর"],
    ["patuakhali_rangabali","Rangabali","রাঙ্গাবালী"],
  ],
  "pirojpur": [
    ["pirojpur_bhandaria","Bhandaria","ভান্ডারিয়া"],
    ["pirojpur_kawkhali","Kawkhali","কাউখালী"],
    ["pirojpur_mathbaria","Mathbaria","মঠবাড়ীয়া"],
    ["pirojpur_nazirpur","Nazirpur","নাজিরপুর"],
    ["pirojpur_nesarabad","Nesarabad","নেছারাবাদ"],
    ["pirojpur_pirojpur_sadar","Pirojpur Sadar","পিরোজপুর সদর"],
    ["pirojpur_zianagar","Zianagar","জিয়ানগর"],
  ],
  "rajbari": [
    ["rajbari_baliakandi","Baliakandi","বালিয়াকান্দি"],
    ["rajbari_goalanda","Goalanda","গোয়ালন্দ"],
    ["rajbari_kalukhali","Kalukhali","কালুখালী"],
    ["rajbari_pangsa","Pangsa","পাংশা"],
    ["rajbari_rajbari_sadar","Rajbari Sadar","রাজবাড়ী সদর"],
  ],
  "rajshahi": [
    ["rajshahi_bagha","Bagha","বাঘা"],
    ["rajshahi_bagmara","Bagmara","বাগমারা"],
    ["rajshahi_charghat","Charghat","চারঘাট"],
    ["rajshahi_durgapur","Durgapur","দুর্গাপুর"],
    ["rajshahi_godagari","Godagari","গোদাগাড়ী"],
    ["rajshahi_mohonpur","Mohonpur","মোহনপুর"],
    ["rajshahi_paba","Paba","পবা"],
    ["rajshahi_puthia","Puthia","পুঠিয়া"],
    ["rajshahi_tanore","Tanore","তানোর"],
  ],
  "rangamati": [
    ["rangamati_baghaichari","Baghaichari","বাঘাইছড়ি"],
    ["rangamati_barkal","Barkal","বরকল"],
    ["rangamati_belaichari","Belaichari","বিলাইছড়ি"],
    ["rangamati_juraichari","Juraichari","জুরাছড়ি"],
    ["rangamati_kaptai","Kaptai","কাপ্তাই"],
    ["rangamati_kawkhali","Kawkhali","কাউখালী"],
    ["rangamati_langadu","Langadu","লংগদু"],
    ["rangamati_naniarchar","Naniarchar","নানিয়ারচর"],
    ["rangamati_rajasthali","Rajasthali","রাজস্থলী"],
    ["rangamati_rangamati_sadar","Rangamati Sadar","রাঙ্গামাটি সদর"],
  ],
  "rangpur": [
    ["rangpur_badargonj","Badargonj","বদরগঞ্জ"],
    ["rangpur_gangachara","Gangachara","গংগাচড়া"],
    ["rangpur_kaunia","Kaunia","কাউনিয়া"],
    ["rangpur_mithapukur","Mithapukur","মিঠাপুকুর"],
    ["rangpur_pirgacha","Pirgacha","পীরগাছা"],
    ["rangpur_pirgonj","Pirgonj","পীরগঞ্জ"],
    ["rangpur_rangpur_sadar","Rangpur Sadar","রংপুর সদর"],
    ["rangpur_taragonj","Taragonj","তারাগঞ্জ"],
  ],
  "satkhira": [
    ["satkhira_assasuni","Assasuni","আশাশুনি"],
    ["satkhira_debhata","Debhata","দেবহাটা"],
    ["satkhira_kalaroa","Kalaroa","কলারোয়া"],
    ["satkhira_kaliganj","Kaliganj","কালিগঞ্জ"],
    ["satkhira_satkhira_sadar","Satkhira Sadar","সাতক্ষীরা সদর"],
    ["satkhira_shyamnagar","Shyamnagar","শ্যামনগর"],
    ["satkhira_tala","Tala","তালা"],
  ],
  "shariatpur": [
    ["shariatpur_bhedarganj","Bhedarganj","ভেদরগঞ্জ"],
    ["shariatpur_damudya","Damudya","ডামুড্যা"],
    ["shariatpur_gosairhat","Gosairhat","গোসাইরহাট"],
    ["shariatpur_naria","Naria","নড়িয়া"],
    ["shariatpur_shariatpur_sadar","Shariatpur Sadar","শরিয়তপুর সদর"],
    ["shariatpur_zajira","Zajira","জাজিরা"],
  ],
  "sherpur": [
    ["sherpur_jhenaigati","Jhenaigati","ঝিনাইগাতী"],
    ["sherpur_nalitabari","Nalitabari","নালিতাবাড়ী"],
    ["sherpur_nokla","Nokla","নকলা"],
    ["sherpur_sherpur_sadar","Sherpur Sadar","শেরপুর সদর"],
    ["sherpur_sreebordi","Sreebordi","শ্রীবরদী"],
  ],
  "sirajganj": [
    ["sirajganj_belkuchi","Belkuchi","বেলকুচি"],
    ["sirajganj_chauhali","Chauhali","চৌহালি"],
    ["sirajganj_kamarkhand","Kamarkhand","কামারখন্দ"],
    ["sirajganj_kazipur","Kazipur","কাজীপুর"],
    ["sirajganj_raigonj","Raigonj","রায়গঞ্জ"],
    ["sirajganj_shahjadpur","Shahjadpur","শাহজাদপুর"],
    ["sirajganj_sirajganj_sadar","Sirajganj Sadar","সিরাজগঞ্জ সদর"],
    ["sirajganj_tarash","Tarash","তাড়াশ"],
    ["sirajganj_ullapara","Ullapara","উল্লাপাড়া"],
  ],
  "sunamganj": [
    ["sunamganj_bishwambarpur","Bishwambarpur","বিশ্বম্ভরপুর"],
    ["sunamganj_chhatak","Chhatak","ছাতক"],
    ["sunamganj_derai","Derai","দিরাই"],
    ["sunamganj_dharmapasha","Dharmapasha","ধর্মপাশা"],
    ["sunamganj_dowarabazar","Dowarabazar","দোয়ারাবাজার"],
    ["sunamganj_jagannathpur","Jagannathpur","জগন্নাথপুর"],
    ["sunamganj_jamalganj","Jamalganj","জামালগঞ্জ"],
    ["sunamganj_madhyanagar","Madhyanagar","মধ্যনগর"],
    ["sunamganj_shalla","Shalla","শাল্লা"],
    ["sunamganj_south_sunamganj","South Sunamganj","দক্ষিণ সুনামগঞ্জ"],
    ["sunamganj_sunamganj_sadar","Sunamganj Sadar","সুনামগঞ্জ সদর"],
    ["sunamganj_tahirpur","Tahirpur","তাহিরপুর"],
  ],
  "sylhet": [
    ["sylhet_balaganj","Balaganj","বালাগঞ্জ"],
    ["sylhet_beanibazar","Beanibazar","বিয়ানীবাজার"],
    ["sylhet_bishwanath","Bishwanath","বিশ্বনাথ"],
    ["sylhet_companiganj","Companiganj","কোম্পানীগঞ্জ"],
    ["sylhet_dakshinsurma","Dakshinsurma","দক্ষিণ সুরমা"],
    ["sylhet_fenchuganj","Fenchuganj","ফেঞ্চুগঞ্জ"],
    ["sylhet_golapganj","Golapganj","গোলাপগঞ্জ"],
    ["sylhet_gowainghat","Gowainghat","গোয়াইনঘাট"],
    ["sylhet_jaintiapur","Jaintiapur","জৈন্তাপুর"],
    ["sylhet_kanaighat","Kanaighat","কানাইঘাট"],
    ["sylhet_osmaninagar","Osmaninagar","ওসমানী নগর"],
    ["sylhet_sylhet_sadar","Sylhet Sadar","সিলেট সদর"],
    ["sylhet_zakiganj","Zakiganj","জকিগঞ্জ"],
  ],
  "tangail": [
    ["tangail_basail","Basail","বাসাইল"],
    ["tangail_bhuapur","Bhuapur","ভুয়াপুর"],
    ["tangail_delduar","Delduar","দেলদুয়ার"],
    ["tangail_dhanbari","Dhanbari","ধনবাড়ী"],
    ["tangail_ghatail","Ghatail","ঘাটাইল"],
    ["tangail_gopalpur","Gopalpur","গোপালপুর"],
    ["tangail_kalihati","Kalihati","কালিহাতী"],
    ["tangail_madhupur","Madhupur","মধুপুর"],
    ["tangail_mirzapur","Mirzapur","মির্জাপুর"],
    ["tangail_nagarpur","Nagarpur","নাগরপুর"],
    ["tangail_sakhipur","Sakhipur","সখিপুর"],
    ["tangail_tangail_sadar","Tangail Sadar","টাঙ্গাইল সদর"],
  ],
  "thakurgaon": [
    ["thakurgaon_baliadangi","Baliadangi","বালিয়াডাঙ্গী"],
    ["thakurgaon_haripur","Haripur","হরিপুর"],
    ["thakurgaon_pirganj","Pirganj","পীরগঞ্জ"],
    ["thakurgaon_ranisankail","Ranisankail","রাণীশংকৈল"],
    ["thakurgaon_thakurgaon_sadar","Thakurgaon Sadar","ঠাকুরগাঁও সদর"],
  ],
};

  // City corporations are listed with the upazilas of their district, first.
  const CITY_CORPORATIONS = {
    dhaka: [
      ['dhaka_dhaka_north_cc', 'Dhaka North City Corporation', 'ঢাকা উত্তর সিটি কর্পোরেশন'],
      ['dhaka_dhaka_south_cc', 'Dhaka South City Corporation', 'ঢাকা দক্ষিণ সিটি কর্পোরেশন'],
    ],
    chattogram: [['chattogram_chattogram_cc', 'Chattogram City Corporation', 'চট্টগ্রাম সিটি কর্পোরেশন']],
    gazipur: [['gazipur_gazipur_cc', 'Gazipur City Corporation', 'গাজীপুর সিটি কর্পোরেশন']],
    narayanganj: [
      ['narayanganj_narayanganj_cc', 'Narayanganj City Corporation', 'নারায়ণগঞ্জ সিটি কর্পোরেশন'],
    ],
    cumilla: [['cumilla_cumilla_cc', 'Cumilla City Corporation', 'কুমিল্লা সিটি কর্পোরেশন']],
    khulna: [['khulna_khulna_cc', 'Khulna City Corporation', 'খুলনা সিটি কর্পোরেশন']],
    rajshahi: [['rajshahi_rajshahi_cc', 'Rajshahi City Corporation', 'রাজশাহী সিটি কর্পোরেশন']],
    sylhet: [['sylhet_sylhet_cc', 'Sylhet City Corporation', 'সিলেট সিটি কর্পোরেশন']],
    barishal: [['barishal_barishal_cc', 'Barishal City Corporation', 'বরিশাল সিটি কর্পোরেশন']],
    rangpur: [['rangpur_rangpur_cc', 'Rangpur City Corporation', 'রংপুর সিটি কর্পোরেশন']],
    mymensingh: [['mymensingh_mymensingh_cc', 'Mymensingh City Corporation', 'ময়মনসিংহ সিটি কর্পোরেশন']],
  };

  /** Upazilas (and city corporations) keyed by district value: { value, en, bn, district }. */
  const UPAZILAS_BY_DISTRICT = Object.fromEntries(
    Object.entries(RAW).map(([district, list]) => [
      district,
      [...(CITY_CORPORATIONS[district] ?? []), ...list].map(([value, en, bn]) => ({
        value,
        en,
        bn,
        district,
      })),
    ]),
  );

  const UPAZILAS = Object.values(UPAZILAS_BY_DISTRICT).flat();

  /** The upazilas of a district (empty when no district is given). */
  function upazilasOf(district) {
    return UPAZILAS_BY_DISTRICT[district] ?? [];
  }

  /** The district an upazila value belongs to, if any. */
  function districtOfUpazila(upazila) {
    return UPAZILAS.find((u) => u.value === upazila)?.district;
  }

  return { UPAZILAS_BY_DISTRICT, UPAZILAS, upazilasOf, districtOfUpazila };
})();

// --- shared/biodata.js -------------------------------------------------------------------------
const sharedBiodata = (() => {
  // The biodata form, defined once and used everywhere:
  // - the API validates and stores sections with it,
  // - the web client renders the multi-step editor and the public profile from it,
  // - the admin panel renders full biodatas for review from it.

  /** Minimum age for a groom's biodata (Child Marriage Restraint Act 2017). Brides: 18, set on the field. */
  const GROOM_MIN_AGE = 21;

  const notNeverMarried = (b) => !!b?.general?.maritalStatus && b.general.maritalStatus !== 'never_married';

  const BIODATA_SECTIONS = [
    {
      key: 'general',
      title: { en: 'General information', bn: 'সাধারণ তথ্য' },
      fields: [
        {
          key: 'biodataType',
          type: 'select',
          options: sharedOptions.BIODATA_TYPES,
          required: true,
          label: { en: 'Biodata type', bn: 'বায়োডাটার ধরন' },
        },
        {
          key: 'maritalStatus',
          type: 'select',
          options: sharedOptions.MARITAL_STATUS,
          required: true,
          label: { en: 'Marital status', bn: 'বৈবাহিক অবস্থা' },
        },
        {
          key: 'religion',
          type: 'select',
          options: sharedOptions.RELIGIONS,
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
          options: sharedOptions.HEIGHTS,
          numeric: true,
          required: true,
          label: { en: 'Height', bn: 'উচ্চতা' },
        },
        { key: 'weight', type: 'number', min: 30, max: 200, label: { en: 'Weight (kg)', bn: 'ওজন (কেজি)' } },
        {
          key: 'complexion',
          type: 'select',
          options: sharedOptions.COMPLEXIONS,
          required: true,
          label: { en: 'Complexion', bn: 'গাত্রবর্ণ' },
        },
        {
          key: 'bloodGroup',
          type: 'select',
          options: sharedOptions.BLOOD_GROUPS,
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
          options: sharedLocations.DIVISION_OPTIONS,
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
          options: sharedOptions.PRESENT_LOCATION,
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
          options: sharedOptions.EDUCATION_MEDIUMS,
          required: true,
          label: { en: 'Education medium', bn: 'পড়াশোনার মাধ্যম' },
        },
        {
          key: 'highestEducation',
          type: 'select',
          options: sharedOptions.EDUCATION_LEVELS,
          required: true,
          label: { en: 'Highest education', bn: 'সর্বোচ্চ শিক্ষাগত যোগ্যতা' },
        },
        {
          key: 'institution',
          type: 'text',
          maxLength: 120,
          label: { en: 'Institution of highest degree', bn: 'সর্বোচ্চ ডিগ্রির প্রতিষ্ঠান' },
        },
        {
          key: 'subject',
          type: 'text',
          maxLength: 120,
          label: { en: 'Subject / group', bn: 'বিষয় / বিভাগ' },
        },
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
          label: {
            en: 'HSC or equivalent (year, group, result)',
            bn: 'এইচএসসি বা সমমান (সাল, বিভাগ, ফলাফল)',
          },
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
          options: sharedOptions.ALIVE_STATUS,
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
          options: sharedOptions.ALIVE_STATUS,
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
          options: sharedOptions.ECONOMIC_STATUS,
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
        {
          key: 'diet',
          type: 'select',
          options: sharedOptions.DIET,
          label: { en: 'Diet', bn: 'খাদ্যাভ্যাস' },
        },
        {
          key: 'smoking',
          type: 'select',
          options: sharedOptions.YES_NO,
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
          options: sharedOptions.SPECIAL_CATEGORIES,
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
          options: sharedOptions.PROFESSIONS,
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
          options: sharedOptions.INCOME_RANGES,
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
          options: sharedOptions.YES_NO,
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
          options: sharedOptions.HEIGHTS,
          numeric: true,
          label: { en: 'Minimum height', bn: 'সর্বনিম্ন উচ্চতা' },
        },
        {
          key: 'heightMax',
          type: 'select',
          options: sharedOptions.HEIGHTS,
          numeric: true,
          label: { en: 'Maximum height', bn: 'সর্বোচ্চ উচ্চতা' },
        },
        {
          key: 'religions',
          type: 'multiselect',
          options: sharedOptions.RELIGIONS,
          label: { en: 'Religion', bn: 'ধর্ম' },
        },
        {
          key: 'maritalStatuses',
          type: 'multiselect',
          options: sharedOptions.MARITAL_STATUS,
          label: { en: 'Marital status', bn: 'বৈবাহিক অবস্থা' },
        },
        {
          key: 'complexions',
          type: 'multiselect',
          options: sharedOptions.COMPLEXIONS,
          label: { en: 'Complexion', bn: 'গাত্রবর্ণ' },
        },
        {
          key: 'minEducation',
          type: 'select',
          options: sharedOptions.EDUCATION_LEVELS,
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
          options: sharedOptions.ECONOMIC_STATUS,
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
        if (v.heightMin != null && v.heightMax != null && v.heightMin > v.heightMax)
          errors.heightMax = 'range';
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
          options: sharedOptions.YES_NO,
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
          options: sharedOptions.YES_NO,
          required: true,
          mustBe: 'yes',
          label: { en: 'Is all the information you have given true?', bn: 'আপনার দেওয়া সব তথ্য কি সত্য?' },
        },
        {
          key: 'acceptResponsibility',
          type: 'select',
          options: sharedOptions.YES_NO,
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
          options: sharedOptions.GUARDIAN_RELATIONS,
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

  const SECTION_KEYS = BIODATA_SECTIONS.map((s) => s.key);

  const VALIDATION_MESSAGES = {
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

  const PHONE_REGEX = /^01[3-9]\d{8}$/;
  const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

  /** Normalises Bangladeshi mobile numbers (+8801…, 8801…, 01…) to 01XXXXXXXXX. */
  function normalizePhone(value) {
    if (value === undefined || value === null) return '';
    let s = String(value).replace(/[\s\-()]/g, '');
    // Accept Bangla digits too.
    s = s.replace(/[০-৯]/g, (d) => String('০১২৩৪৫৬৭৮৯'.indexOf(d)));
    if (s.startsWith('+88')) s = s.slice(3);
    else if (s.startsWith('88') && s.length === 13) s = s.slice(2);
    return s;
  }

  function isValidPhone(value) {
    return PHONE_REGEX.test(normalizePhone(value));
  }

  function isValidEmail(value) {
    return EMAIL_REGEX.test(String(value ?? '').trim());
  }

  /** Whole years between `dob` and `now`. */
  function ageFromDob(dob, now = new Date()) {
    if (!dob) return null;
    const d = new Date(dob);
    if (Number.isNaN(d.getTime())) return null;
    let age = now.getFullYear() - d.getFullYear();
    const m = now.getMonth() - d.getMonth();
    if (m < 0 || (m === 0 && now.getDate() < d.getDate())) age -= 1;
    return age;
  }

  const isEmpty = (v) => v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0);

  function getSection(key) {
    return BIODATA_SECTIONS.find((s) => s.key === key);
  }

  function isFieldVisible(field, biodata) {
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
        if (!sharedLocations.DISTRICTS.some((d) => d.value === raw)) return { error: 'invalid' };
        return { value: String(raw) };
      }
      case 'upazila': {
        if (!sharedUpazilas.UPAZILAS.some((u) => u.value === raw)) return { error: 'invalid' };
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
  function validateSection(sectionKey, input, { biodata = {}, partial = false } = {}) {
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
      if (
        field.type === 'upazila' &&
        v !== undefined &&
        sharedUpazilas.districtOfUpazila(v) !== src[field.districtField]
      ) {
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
  function validateBiodata(biodata) {
    const result = {};
    for (const section of BIODATA_SECTIONS) {
      const { errors } = validateSection(section.key, biodata?.[section.key] ?? {}, { biodata });
      if (Object.keys(errors).length) result[section.key] = errors;
    }
    return result;
  }

  /** Completion summary used by the editor progress bar and the submit button. */
  function biodataCompletion(biodata) {
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
  function publicSections(biodata) {
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
  function formatFieldValue(field, value, lang = 'en') {
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
      const d = sharedLocations.DISTRICTS.find((x) => x.value === value);
      return d ? d[lang] : String(value);
    }
    if (field.type === 'upazila') {
      const u = sharedUpazilas.UPAZILAS.find((x) => x.value === value);
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
  function setFieldValue(section, values, key, value) {
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

  return {
    GROOM_MIN_AGE,
    BIODATA_SECTIONS,
    SECTION_KEYS,
    VALIDATION_MESSAGES,
    PHONE_REGEX,
    normalizePhone,
    isValidPhone,
    isValidEmail,
    ageFromDob,
    getSection,
    isFieldVisible,
    validateSection,
    validateBiodata,
    biodataCompletion,
    publicSections,
    formatFieldValue,
    setFieldValue,
  };
})();

// --- shared/permissions.js ---------------------------------------------------------------------
const sharedPermissions = (() => {
  // Role-based access control. The API enforces it; the client uses the same map to show
  // or hide admin screens. There are two roles: members ("user") and admins ("admin").

  const ADMIN = [sharedOptions.ROLES.ADMIN];

  const PERMISSIONS = Object.freeze({
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
  function can(role, permission) {
    return (PERMISSIONS[permission] ?? []).includes(role);
  }

  /** True for accounts that can open the admin panel. */
  function isStaff(role) {
    return role === sharedOptions.ROLES.ADMIN;
  }

  return { PERMISSIONS, can, isStaff };
})();

// --- shared/index.js ---------------------------------------------------------------------------
const shared = (() => {
  // Rules and constants shared with the Ghotok client. The client keeps its own copy of
  // these files: change the biodata definition, options or permissions in both repositories.

  return {
    ROLES: sharedOptions.ROLES,
    ROLE_OPTIONS: sharedOptions.ROLE_OPTIONS,
    USER_STATUS_OPTIONS: sharedOptions.USER_STATUS_OPTIONS,
    BIODATA_TYPES: sharedOptions.BIODATA_TYPES,
    MARITAL_STATUS: sharedOptions.MARITAL_STATUS,
    RELIGIONS: sharedOptions.RELIGIONS,
    COMPLEXIONS: sharedOptions.COMPLEXIONS,
    BLOOD_GROUPS: sharedOptions.BLOOD_GROUPS,
    YES_NO: sharedOptions.YES_NO,
    ALIVE_STATUS: sharedOptions.ALIVE_STATUS,
    EDUCATION_MEDIUMS: sharedOptions.EDUCATION_MEDIUMS,
    EDUCATION_LEVELS: sharedOptions.EDUCATION_LEVELS,
    PROFESSIONS: sharedOptions.PROFESSIONS,
    INCOME_RANGES: sharedOptions.INCOME_RANGES,
    ECONOMIC_STATUS: sharedOptions.ECONOMIC_STATUS,
    DIET: sharedOptions.DIET,
    PRESENT_LOCATION: sharedOptions.PRESENT_LOCATION,
    GUARDIAN_RELATIONS: sharedOptions.GUARDIAN_RELATIONS,
    HEIGHTS: sharedOptions.HEIGHTS,
    BIODATA_STATUS: sharedOptions.BIODATA_STATUS,
    SPECIAL_CATEGORIES: sharedOptions.SPECIAL_CATEGORIES,
    HIDE_REASONS: sharedOptions.HIDE_REASONS,
    DELETE_REASONS: sharedOptions.DELETE_REASONS,
    PAYMENT_METHODS: sharedOptions.PAYMENT_METHODS,
    PAYMENT_STATUS: sharedOptions.PAYMENT_STATUS,
    REFUND_STATUS: sharedOptions.REFUND_STATUS,
    REFUND_RESOLUTIONS: sharedOptions.REFUND_RESOLUTIONS,
    LEDGER_TYPES: sharedOptions.LEDGER_TYPES,
    ADJUSTMENT_ACTIONS: sharedOptions.ADJUSTMENT_ACTIONS,
    PROPOSAL_STATUS: sharedOptions.PROPOSAL_STATUS,
    REPORT_REASONS: sharedOptions.REPORT_REASONS,
    REPORT_STATUS: sharedOptions.REPORT_STATUS,
    TICKET_CATEGORIES: sharedOptions.TICKET_CATEGORIES,
    TICKET_STATUS: sharedOptions.TICKET_STATUS,
    TICKET_PRIORITY: sharedOptions.TICKET_PRIORITY,
    RESTORE_STATUS: sharedOptions.RESTORE_STATUS,
    SORT_OPTIONS: sharedOptions.SORT_OPTIONS,
    toBnDigits: sharedOptions.toBnDigits,
    formatNumber: sharedOptions.formatNumber,
    optionLabel: sharedOptions.optionLabel,
    optionValues: sharedOptions.optionValues,
    DIVISIONS: sharedLocations.DIVISIONS,
    DIVISION_OPTIONS: sharedLocations.DIVISION_OPTIONS,
    DISTRICTS: sharedLocations.DISTRICTS,
    districtsOf: sharedLocations.districtsOf,
    divisionOf: sharedLocations.divisionOf,
    UPAZILAS_BY_DISTRICT: sharedUpazilas.UPAZILAS_BY_DISTRICT,
    UPAZILAS: sharedUpazilas.UPAZILAS,
    upazilasOf: sharedUpazilas.upazilasOf,
    districtOfUpazila: sharedUpazilas.districtOfUpazila,
    GROOM_MIN_AGE: sharedBiodata.GROOM_MIN_AGE,
    BIODATA_SECTIONS: sharedBiodata.BIODATA_SECTIONS,
    SECTION_KEYS: sharedBiodata.SECTION_KEYS,
    VALIDATION_MESSAGES: sharedBiodata.VALIDATION_MESSAGES,
    PHONE_REGEX: sharedBiodata.PHONE_REGEX,
    normalizePhone: sharedBiodata.normalizePhone,
    isValidPhone: sharedBiodata.isValidPhone,
    isValidEmail: sharedBiodata.isValidEmail,
    ageFromDob: sharedBiodata.ageFromDob,
    getSection: sharedBiodata.getSection,
    isFieldVisible: sharedBiodata.isFieldVisible,
    validateSection: sharedBiodata.validateSection,
    validateBiodata: sharedBiodata.validateBiodata,
    biodataCompletion: sharedBiodata.biodataCompletion,
    publicSections: sharedBiodata.publicSections,
    formatFieldValue: sharedBiodata.formatFieldValue,
    setFieldValue: sharedBiodata.setFieldValue,
    PERMISSIONS: sharedPermissions.PERMISSIONS,
    can: sharedPermissions.can,
    isStaff: sharedPermissions.isStaff,
  };
})();

// ==============================================================================================
// UTILITIES
// ==============================================================================================

// --- utils/api-error.js ------------------------------------------------------------------------
const apiErrorUtils = (() => {
  /**
   * An error that maps to an HTTP response. Throw it from any layer; the error
   * middleware turns it into `{ error: { code, message, details } }`.
   *
   * `code` is a stable, machine-readable identifier the clients use to show a
   * translated message (see web/src/lib/i18n). `message` is an English fallback.
   */
  class ApiError extends Error {
    constructor(status, code, message, details) {
      super(message ?? code);
      this.name = 'ApiError';
      this.status = status;
      this.code = code;
      this.details = details;
    }
  }

  const badRequest = (code = 'BAD_REQUEST', message, details) => new ApiError(400, code, message, details);
  const unauthorized = (code = 'UNAUTHORIZED', message = 'Please log in to continue.') =>
    new ApiError(401, code, message);
  const paymentRequired = (code, message) => new ApiError(402, code, message);
  const forbidden = (code = 'FORBIDDEN', message = 'You do not have permission to do this.', details) =>
    new ApiError(403, code, message, details);
  const notFound = (what = 'Resource') => new ApiError(404, 'NOT_FOUND', `${what} not found.`);
  const conflict = (code = 'CONFLICT', message, details) => new ApiError(409, code, message, details);
  const tooMany = (code = 'RATE_LIMITED', message) => new ApiError(429, code, message);

  /** A 400 VALIDATION_ERROR whose details map field names to error codes or messages. */
  const validationError = (fields, message = 'Please check the highlighted fields.') =>
    new ApiError(400, 'VALIDATION_ERROR', message, { fields });

  return {
    ApiError,
    badRequest,
    unauthorized,
    paymentRequired,
    forbidden,
    notFound,
    conflict,
    tooMany,
    validationError,
  };
})();

// --- utils/pagination.js -----------------------------------------------------------------------
const paginationUtils = (() => {
  /**
   * Reads `page` and `limit` from a query object.
   * @returns {{ page: number, limit: number, skip: number }}
   */
  function pageParams(query = {}, { defaultLimit = 20, maxLimit = 100 } = {}) {
    const page = Math.max(1, Number.parseInt(query.page, 10) || 1);
    const limit = Math.min(maxLimit, Math.max(1, Number.parseInt(query.limit, 10) || defaultLimit));
    return { page, limit, skip: (page - 1) * limit };
  }

  /** The standard list response: `{ items, total, page, limit, pages }`. */
  function paged(items, total, { page, limit }) {
    return { items, total, page, limit, pages: Math.max(1, Math.ceil(total / limit)) };
  }

  /** Runs a paginated find + count in parallel and returns the standard list response. */
  async function paginate(query, countQuery, params, map = (x) => x) {
    const [items, total] = await Promise.all([query.skip(params.skip).limit(params.limit), countQuery]);
    return paged(items.map(map), total, params);
  }

  return { pageParams, paged, paginate };
})();

// --- utils/request.js --------------------------------------------------------------------------
const requestUtils = (() => {
  /**
   * Request details that services need without depending on Express.
   * @typedef {{ actor?: import('mongoose').Document, ip?: string, userAgent?: string }} RequestContext
   */

  /** @returns {RequestContext} */
  function requestContext(req) {
    return {
      actor: req.user,
      ip: req.ip,
      userAgent: String(req.get('user-agent') ?? '').slice(0, 300),
    };
  }

  return { requestContext };
})();

// --- utils/strings.js --------------------------------------------------------------------------
const stringsUtils = (() => {
  /** Escapes a user-supplied string for safe use inside a RegExp. */
  function escapeRegex(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  /** A comma-separated query value (or repeated param) → array of trimmed, non-empty strings. */
  function csv(value) {
    if (value === undefined || value === null || value === '') return [];
    return (Array.isArray(value) ? value : String(value).split(','))
      .map((s) => String(s).trim())
      .filter(Boolean);
  }

  /** Today's date (UTC) as YYYY-MM-DD. */
  function dayKey(date = new Date()) {
    return date.toISOString().slice(0, 10);
  }

  return { escapeRegex, csv, dayKey };
})();

// ==============================================================================================
// DATABASE MODELS (MONGOOSE)
// ==============================================================================================

// --- models/audit-log.model.js -----------------------------------------------------------------
const auditLogModel = (() => {
  const { Schema } = mongoose;

  /** A record of a staff (or security-relevant) action, shown in Admin → Audit log. */
  const auditLogSchema = new Schema(
    {
      actor: { type: Schema.Types.ObjectId, ref: 'User' },
      actorRole: String,
      action: { type: String, required: true, index: true }, // e.g. "payment.verify"
      targetType: String,
      targetId: String,
      summary: String,
      meta: Schema.Types.Mixed,
      ip: String,
    },
    { timestamps: { createdAt: true, updatedAt: false } },
  );

  auditLogSchema.index({ createdAt: -1 });
  auditLogSchema.index({ targetType: 1, targetId: 1 });

  const AuditLog = mongoose.model('AuditLog', auditLogSchema);

  return { AuditLog };
})();

// --- models/banner.model.js --------------------------------------------------------------------
const bannerModel = (() => {
  const { Schema } = mongoose;

  /**
   * A printable wedding banner design that visitors can download for free. Both
   * images are hosted on ImgBB: a preview for the gallery and the full-size design
   * for download. `downloads` counts each download.
   */
  const bannerSchema = new Schema(
    {
      title: {
        en: { type: String, required: true, maxlength: 120 },
        bn: { type: String, maxlength: 120 },
      },
      imageUrl: { type: String, required: true, maxlength: 500 },
      downloadUrl: { type: String, required: true, maxlength: 500 },
      downloads: { type: Number, default: 0 },
      isActive: { type: Boolean, default: true },
      sortOrder: { type: Number, default: 0 },
    },
    { timestamps: true },
  );

  const Banner = mongoose.model('Banner', bannerSchema);

  return { Banner };
})();

// --- models/biodata.model.js -------------------------------------------------------------------
const biodataModel = (() => {
  const { Schema } = mongoose;

  // Mongoose sub-schemas are generated from the shared form definition so the
  // database shape can never drift from the form. Values are validated with the
  // shared validator before they reach the model.
  function fieldType(field) {
    if (field.type === 'multiselect') return [String];
    if (field.type === 'number' || (field.type === 'select' && field.numeric)) return Number;
    return String;
  }

  const sectionSchemas = Object.fromEntries(
    shared.BIODATA_SECTIONS.map((section) => [
      section.key,
      {
        type: new Schema(Object.fromEntries(section.fields.map((f) => [f.key, { type: fieldType(f) }])), {
          _id: false,
          minimize: true,
        }),
        default: () => ({}),
      },
    ]),
  );

  /**
   * A member's biodata (one per user).
   *
   * Lifecycle (`status`): draft → pending (submitted) → approved | rejected.
   * Editing an approved biodata sends it back to pending. Visibility is separate:
   * `isHidden` (owner's choice), `blocked` (staff), and `deletedAt` (soft delete,
   * restorable through the recovery queue). Only PUBLIC_FILTER matches are public.
   */
  const biodataSchema = new Schema(
    {
      biodataNo: { type: String, required: true, unique: true },
      user: { type: Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
      status: {
        type: String,
        enum: shared.optionValues(shared.BIODATA_STATUS),
        default: 'draft',
        index: true,
      },
      rejectionReason: { type: String, maxlength: 1000 },
      // When the owner accepted the eligibility rules and pledge before starting.
      pledgeAcceptedAt: Date,
      submittedAt: Date,
      approvedAt: Date,
      firstApprovedAt: Date,
      reviewedAt: Date,
      reviewedBy: { type: Schema.Types.ObjectId, ref: 'User' },

      isHidden: { type: Boolean, default: false },
      hideReason: { type: String, enum: [...shared.optionValues(shared.HIDE_REASONS), null] },
      hideNote: { type: String, maxlength: 500 },
      // Answers a reviewer asked the owner to correct ("Needs changes"). Cleared on approval.
      corrections: [
        new Schema(
          {
            section: { type: String, required: true },
            field: { type: String, required: true },
            note: { type: String, maxlength: 300 },
            // The value when the correction was requested, to tell whether it has changed since.
            previous: Schema.Types.Mixed,
          },
          { _id: false },
        ),
      ],
      // Staff can pause editing and resubmitting until this date (repeated misuse).
      editSuspendedUntil: { type: Date, default: null },
      // Set by staff when the owner's account is suspended or banned.
      blocked: { type: Boolean, default: false },

      deletedAt: { type: Date, default: null, index: true },
      deleteReason: { type: String, enum: [...shared.optionValues(shared.DELETE_REASONS), null] },
      deleteNote: { type: String, maxlength: 500 },

      stats: {
        views: { type: Number, default: 0 },
        favorites: { type: Number, default: 0 },
        unlocks: { type: Number, default: 0 },
      },

      completion: { type: Number, default: 0 },

      ...sectionSchemas,

      // Denormalised search fields, recomputed from the sections on every save.
      type: { type: String, index: true },
      religion: String,
      maritalStatus: String,
      birthDate: Date,
      heightIn: Number,
      complexion: String,
      division: String,
      district: String,
      presentDistrict: String,
      upazila: String,
      presentUpazila: String,
      educationMedium: String,
      specialCategories: { type: [String], default: undefined },
      educationLevel: String,
      educationRank: Number,
      profession: String,
      economicStatus: String,
    },
    { timestamps: true, minimize: true },
  );

  biodataSchema.index({ status: 1, isHidden: 1, blocked: 1, deletedAt: 1, type: 1, approvedAt: -1 });
  biodataSchema.index({ religion: 1, maritalStatus: 1, birthDate: 1 });
  biodataSchema.index({ district: 1, upazila: 1 });
  biodataSchema.index({ presentDistrict: 1, presentUpazila: 1 });

  biodataSchema.pre('validate', function syncDerived(next) {
    const g = this.general ?? {};
    const a = this.address ?? {};
    this.type = g.biodataType;
    this.religion = g.religion;
    this.maritalStatus = g.maritalStatus;
    this.birthDate = g.dateOfBirth ? new Date(`${g.dateOfBirth}T00:00:00.000Z`) : undefined;
    this.heightIn = g.height;
    this.complexion = g.complexion;
    this.district = a.permanentDistrict;
    this.division = a.permanentDivision ?? shared.divisionOf(a.permanentDistrict);
    const inBangladesh = a.presentLocation === 'bangladesh';
    this.presentDistrict = inBangladesh ? a.presentDistrict : undefined;
    this.upazila = a.permanentUpazila || undefined;
    this.presentUpazila = inBangladesh ? a.presentUpazila || undefined : undefined;
    this.educationMedium = this.education?.educationMedium;
    const categories = this.personal?.specialCategories;
    this.specialCategories = categories?.length ? [...categories] : undefined;
    this.educationLevel = this.education?.highestEducation;
    const rank = shared.EDUCATION_LEVELS.findIndex((e) => e.value === this.educationLevel);
    this.educationRank = rank >= 0 ? rank : undefined;
    this.profession = this.occupation?.profession;
    this.economicStatus = this.family?.economicStatus;
    this.completion = shared.biodataCompletion(this.sectionsObject()).percent;
    next();
  });

  /** Plain object with only the form sections, for the shared validator. */
  biodataSchema.methods.sectionsObject = function sectionsObject() {
    const out = {};
    for (const s of shared.BIODATA_SECTIONS) {
      const v = this[s.key];
      out[s.key] = v && typeof v.toObject === 'function' ? v.toObject() : { ...(v ?? {}) };
    }
    return out;
  };

  biodataSchema.methods.isPublic = function isPublic() {
    return this.status === 'approved' && !this.isHidden && !this.blocked && !this.deletedAt;
  };

  /** Mongo filter for biodatas visible to the public. */
  const PUBLIC_FILTER = Object.freeze({
    status: 'approved',
    isHidden: false,
    blocked: { $ne: true },
    deletedAt: null,
  });

  const Biodata = mongoose.model('Biodata', biodataSchema);

  return { PUBLIC_FILTER, Biodata };
})();

// --- models/connection-transaction.model.js ----------------------------------------------------
const connectionTransactionModel = (() => {
  const { Schema } = mongoose;

  /**
   * Append-only ledger of connection balance changes. `User.connectionBalance`
   * is the source of truth for spending; every change to it writes one row here.
   */
  const connectionTransactionSchema = new Schema(
    {
      user: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
      type: { type: String, enum: shared.optionValues(shared.LEDGER_TYPES), required: true },
      delta: { type: Number, required: true },
      balanceAfter: { type: Number, required: true },
      payment: { type: Schema.Types.ObjectId, ref: 'Payment' },
      biodata: { type: Schema.Types.ObjectId, ref: 'Biodata' },
      refund: { type: Schema.Types.ObjectId, ref: 'RefundRequest' },
      actor: { type: Schema.Types.ObjectId, ref: 'User' }, // staff member, for manual changes
      reason: { type: String, maxlength: 500 },
    },
    { timestamps: { createdAt: true, updatedAt: false } },
  );

  connectionTransactionSchema.index({ user: 1, createdAt: -1 });
  connectionTransactionSchema.index({ type: 1, createdAt: -1 });

  const ConnectionTransaction = mongoose.model('ConnectionTransaction', connectionTransactionSchema);

  return { ConnectionTransaction };
})();

// --- models/contact-message.model.js -----------------------------------------------------------
const contactMessageModel = (() => {
  const { Schema } = mongoose;

  const CONTACT_MESSAGE_STATUS = ['new', 'read', 'replied', 'archived'];

  /** A message sent through the public contact form (no account needed). */
  const contactMessageSchema = new Schema(
    {
      name: { type: String, required: true, maxlength: 80 },
      email: { type: String, maxlength: 120 },
      phone: { type: String, maxlength: 20 },
      subject: { type: String, maxlength: 160 },
      message: { type: String, required: true, maxlength: 3000 },
      user: { type: Schema.Types.ObjectId, ref: 'User' },
      status: { type: String, enum: CONTACT_MESSAGE_STATUS, default: 'new', index: true },
      ip: String,
    },
    { timestamps: true },
  );

  const ContactMessage = mongoose.model('ContactMessage', contactMessageSchema);

  return { CONTACT_MESSAGE_STATUS, ContactMessage };
})();

// --- models/contact-unlock.model.js ------------------------------------------------------------
const contactUnlockModel = (() => {
  const { Schema } = mongoose;

  /** A paid contact unlock. Permanent: once a user pays for a contact, they keep access to it. */
  const contactUnlockSchema = new Schema(
    {
      user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
      biodata: { type: Schema.Types.ObjectId, ref: 'Biodata', required: true },
      transaction: { type: Schema.Types.ObjectId, ref: 'ConnectionTransaction' },
      // Set when staff uphold the member's report about this biodata and return the connection.
      refundedAt: Date,
    },
    { timestamps: true },
  );

  // The unique index is what makes unlocking idempotent under concurrent requests.
  contactUnlockSchema.index({ user: 1, biodata: 1 }, { unique: true });
  contactUnlockSchema.index({ biodata: 1 });

  const ContactUnlock = mongoose.model('ContactUnlock', contactUnlockSchema);

  return { ContactUnlock };
})();

// --- models/counter.model.js -------------------------------------------------------------------
const counterModel = (() => {
  const counterSchema = new mongoose.Schema(
    { _id: String, seq: { type: Number, default: 0 } },
    { versionKey: false },
  );

  const Counter = mongoose.model('Counter', counterSchema);

  /** Atomically returns the next number of a named sequence, starting after `start`. */
  async function nextSequence(name, start = 0) {
    const doc = await Counter.findOneAndUpdate(
      { _id: name },
      { $inc: { seq: 1 } },
      { upsert: true, new: true },
    );
    return start + doc.seq;
  }

  return { Counter, nextSequence };
})();

// --- models/dislike.model.js -------------------------------------------------------------------
const dislikeModel = (() => {
  const { Schema } = mongoose;

  /** A biodata a user marked "not interested". Disliked biodatas are hidden from that user's search. */
  const dislikeSchema = new Schema(
    {
      user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
      biodata: { type: Schema.Types.ObjectId, ref: 'Biodata', required: true },
    },
    { timestamps: true },
  );

  dislikeSchema.index({ user: 1, biodata: 1 }, { unique: true });
  dislikeSchema.index({ biodata: 1, createdAt: -1 });

  const Dislike = mongoose.model('Dislike', dislikeSchema);

  return { Dislike };
})();

// --- models/faq.model.js -----------------------------------------------------------------------
const faqModel = (() => {
  const { Schema } = mongoose;

  const i18nText = { en: { type: String, default: '' }, bn: { type: String, default: '' } };

  /** A frequently asked question shown on the FAQ page. */
  const faqSchema = new Schema(
    {
      question: i18nText,
      answer: i18nText,
      category: { type: String, default: 'general' },
      sortOrder: { type: Number, default: 0 },
      isActive: { type: Boolean, default: true },
    },
    { timestamps: true },
  );

  const Faq = mongoose.model('Faq', faqSchema);

  return { Faq };
})();

// --- models/favorite.model.js ------------------------------------------------------------------
const favoriteModel = (() => {
  const { Schema } = mongoose;

  /** A biodata a user has added to their favorites ("shortlist"). */
  const favoriteSchema = new Schema(
    {
      user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
      biodata: { type: Schema.Types.ObjectId, ref: 'Biodata', required: true },
    },
    { timestamps: true },
  );

  favoriteSchema.index({ user: 1, biodata: 1 }, { unique: true });
  favoriteSchema.index({ biodata: 1, createdAt: -1 });

  const Favorite = mongoose.model('Favorite', favoriteSchema);

  return { Favorite };
})();

// --- models/marriage-report.model.js -----------------------------------------------------------
const marriageReportModel = (() => {
  const { Schema } = mongoose;

  const STORY_STATUS = ['pending', 'published', 'hidden'];

  /**
   * "We got married": filled in by a member when they delete their biodata because
   * they married. It feeds the success count, and with the member's consent and staff
   * approval its story is shown on the home page.
   */
  const marriageReportSchema = new Schema(
    {
      user: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
      biodata: { type: Schema.Types.ObjectId, ref: 'Biodata', required: true },
      viaGhotok: { type: Boolean, default: false },
      marriedOn: Date,
      place: { type: String, maxlength: 120 },
      // The partner's biodata, when they were registered on Ghotok too.
      partnerBiodata: { type: Schema.Types.ObjectId, ref: 'Biodata' },
      partner: {
        name: { type: String, maxlength: 80 },
        district: String,
        profession: String,
        education: String,
      },
      story: { type: String, maxlength: 2000 },
      // The member agreed to their story being shown on the site (without names).
      shareStory: { type: Boolean, default: false },
      storyStatus: { type: String, enum: STORY_STATUS, default: 'pending', index: true },
      // Staff may tidy the text before publishing it.
      publishedStory: { type: String, maxlength: 2000 },
      publishedAt: Date,
    },
    { timestamps: true },
  );

  const MarriageReport = mongoose.model('MarriageReport', marriageReportSchema);

  return { STORY_STATUS, MarriageReport };
})();

// --- models/notification.model.js --------------------------------------------------------------
const notificationModel = (() => {
  const { Schema } = mongoose;

  const RETENTION_DAYS = 180;

  /**
   * An in-app notification. Only the `type` and its `data` are stored; the
   * clients render the text in the reader's language (see the web dictionaries).
   */
  const notificationSchema = new Schema(
    {
      user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
      type: { type: String, required: true },
      data: { type: Schema.Types.Mixed, default: {} },
      link: String,
      readAt: Date,
    },
    { timestamps: { createdAt: true, updatedAt: false } },
  );

  notificationSchema.index({ user: 1, createdAt: -1 });
  notificationSchema.index({ createdAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * RETENTION_DAYS });

  const Notification = mongoose.model('Notification', notificationSchema);

  return { Notification };
})();

// --- models/package.model.js -------------------------------------------------------------------
const packageModel = (() => {
  const { Schema } = mongoose;

  const i18nText = { en: { type: String, trim: true }, bn: { type: String, trim: true } };

  /** A connection package customers can buy, e.g. 3 connections for ৳300. Managed by super admins. */
  const packageSchema = new Schema(
    {
      name: { en: { type: String, required: true, trim: true }, bn: { type: String, trim: true } },
      description: i18nText,
      connections: { type: Number, required: true, min: 1 },
      price: { type: Number, required: true, min: 1 }, // BDT
      isActive: { type: Boolean, default: true },
      highlight: { type: Boolean, default: false },
      sortOrder: { type: Number, default: 0 },
    },
    { timestamps: true },
  );

  const Package = mongoose.model('Package', packageSchema);

  return { Package };
})();

// --- models/page.model.js ----------------------------------------------------------------------
const pageModel = (() => {
  const { Schema } = mongoose;

  const i18nText = { en: { type: String, default: '' }, bn: { type: String, default: '' } };

  /** An editable content page (about, guide, policies). The body is simple Markdown. */
  const pageSchema = new Schema(
    {
      slug: { type: String, required: true, unique: true, lowercase: true, trim: true },
      title: i18nText,
      body: i18nText,
      isPublished: { type: Boolean, default: true },
      updatedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    },
    { timestamps: true },
  );

  const Page = mongoose.model('Page', pageSchema);

  return { Page };
})();

// --- models/payment.model.js -------------------------------------------------------------------
const paymentModel = (() => {
  const { Schema } = mongoose;

  /**
   * A purchase of a connection package.
   *
   * - mode "manual": the customer sends money and submits a transaction ID; staff verify it.
   *   Status: pending → verified | rejected (→ refunded)
   * - mode "gateway": online checkout through bKash or Nagad.
   *   Status: initiated → verified | failed | cancelled (→ refunded)
   *
   * `creditedAt` is set exactly once, when the connections are added to the balance.
   */
  const paymentSchema = new Schema(
    {
      invoiceNo: { type: String, required: true, unique: true },
      user: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
      package: { type: Schema.Types.ObjectId, ref: 'Package' },
      packageName: { en: String, bn: String }, // snapshot, so history survives package edits
      connections: { type: Number, required: true, min: 1 },
      amount: { type: Number, required: true, min: 1 }, // BDT
      method: { type: String, enum: shared.optionValues(shared.PAYMENT_METHODS), required: true },
      mode: { type: String, enum: ['manual', 'gateway'], required: true },
      senderNumber: String,
      trxId: { type: String, trim: true },
      status: {
        type: String,
        enum: shared.optionValues(shared.PAYMENT_STATUS),
        default: 'pending',
        index: true,
      },
      gateway: {
        paymentId: { type: String, index: true },
        response: Schema.Types.Mixed,
      },
      reviewedBy: { type: Schema.Types.ObjectId, ref: 'User' },
      reviewedAt: Date,
      rejectReason: { type: String, maxlength: 500 },
      creditedAt: Date,
      refundedAt: Date,
    },
    { timestamps: true },
  );

  paymentSchema.index({ method: 1, trxId: 1 });
  paymentSchema.index({ createdAt: -1 });

  const Payment = mongoose.model('Payment', paymentSchema);

  return { Payment };
})();

// --- models/profile-visit.model.js -------------------------------------------------------------
const profileVisitModel = (() => {
  const { Schema } = mongoose;

  const RETENTION_DAYS = 400;

  /**
   * One row per viewer per biodata per day. Counting rows gives the
   * "visits today / 7 days / 30 days" figures on the user dashboard.
   * `viewerKey` is `u:<userId>` for members or `v:<cookie id>` for anonymous visitors.
   */
  const profileVisitSchema = new Schema(
    {
      biodata: { type: Schema.Types.ObjectId, ref: 'Biodata', required: true },
      viewerKey: { type: String, required: true },
      day: { type: String, required: true }, // YYYY-MM-DD (UTC)
    },
    { timestamps: { createdAt: true, updatedAt: false } },
  );

  profileVisitSchema.index({ biodata: 1, viewerKey: 1, day: 1 }, { unique: true });
  profileVisitSchema.index({ biodata: 1, createdAt: -1 });
  profileVisitSchema.index({ createdAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * RETENTION_DAYS });

  const ProfileVisit = mongoose.model('ProfileVisit', profileVisitSchema);

  return { ProfileVisit };
})();

// --- models/proposal.model.js ------------------------------------------------------------------
const proposalModel = (() => {
  const { Schema } = mongoose;

  /** An expression of interest from one member to the owner of a biodata. */
  const proposalSchema = new Schema(
    {
      from: { type: Schema.Types.ObjectId, ref: 'User', required: true },
      fromBiodata: { type: Schema.Types.ObjectId, ref: 'Biodata' },
      to: { type: Schema.Types.ObjectId, ref: 'User', required: true },
      toBiodata: { type: Schema.Types.ObjectId, ref: 'Biodata', required: true },
      message: { type: String, maxlength: 1000 },
      status: {
        type: String,
        enum: shared.optionValues(shared.PROPOSAL_STATUS),
        default: 'pending',
        index: true,
      },
      respondedAt: Date,
      responseNote: { type: String, maxlength: 500 },
    },
    { timestamps: true },
  );

  proposalSchema.index({ from: 1, createdAt: -1 });
  proposalSchema.index({ to: 1, createdAt: -1 });
  proposalSchema.index({ from: 1, toBiodata: 1, status: 1 });

  const Proposal = mongoose.model('Proposal', proposalSchema);

  return { Proposal };
})();

// --- models/refund-request.model.js ------------------------------------------------------------
const refundRequestModel = (() => {
  const { Schema } = mongoose;

  /** A customer's request to refund a payment, decided by a super admin. */
  const refundRequestSchema = new Schema(
    {
      user: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
      payment: { type: Schema.Types.ObjectId, ref: 'Payment', required: true },
      reason: { type: String, required: true, maxlength: 1000 },
      status: {
        type: String,
        enum: shared.optionValues(shared.REFUND_STATUS),
        default: 'pending',
        index: true,
      },
      resolution: { type: String, enum: shared.optionValues(shared.REFUND_RESOLUTIONS) },
      connections: Number, // credited (connection_credit) or revoked (money_back)
      amount: Number, // BDT returned (money_back)
      refundTrxId: String,
      note: { type: String, maxlength: 1000 },
      decidedBy: { type: Schema.Types.ObjectId, ref: 'User' },
      decidedAt: Date,
    },
    { timestamps: true },
  );

  const RefundRequest = mongoose.model('RefundRequest', refundRequestSchema);

  return { RefundRequest };
})();

// --- models/report.model.js --------------------------------------------------------------------
const reportModel = (() => {
  const { Schema } = mongoose;

  /** A complaint about a biodata or its owner, handled by support staff. */
  const reportSchema = new Schema(
    {
      reporter: { type: Schema.Types.ObjectId, ref: 'User', required: true },
      biodata: { type: Schema.Types.ObjectId, ref: 'Biodata' },
      targetUser: { type: Schema.Types.ObjectId, ref: 'User' },
      reason: { type: String, enum: shared.optionValues(shared.REPORT_REASONS), required: true },
      details: { type: String, maxlength: 2000 },
      status: { type: String, enum: shared.optionValues(shared.REPORT_STATUS), default: 'open', index: true },
      actionTaken: { type: String, maxlength: 500 },
      handledBy: { type: Schema.Types.ObjectId, ref: 'User' },
      handledAt: Date,
      // The support conversation about this report.
      ticket: { type: Schema.Types.ObjectId, ref: 'SupportTicket' },
      // Whether the reporter got their connection back when the report was upheld.
      connectionRefunded: { type: Boolean, default: false },
    },
    { timestamps: true },
  );

  reportSchema.index({ createdAt: -1 });
  reportSchema.index({ targetUser: 1 });

  const Report = mongoose.model('Report', reportSchema);

  return { Report };
})();

// --- models/restore-request.model.js -----------------------------------------------------------
const restoreRequestModel = (() => {
  const { Schema } = mongoose;

  /** A member's request to bring back their soft-deleted biodata (the "recovery queue"). */
  const restoreRequestSchema = new Schema(
    {
      biodata: { type: Schema.Types.ObjectId, ref: 'Biodata', required: true },
      user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
      reason: { type: String, maxlength: 1000 },
      status: {
        type: String,
        enum: shared.optionValues(shared.RESTORE_STATUS),
        default: 'pending',
        index: true,
      },
      note: { type: String, maxlength: 500 },
      // A permanent decline stops the member from asking again.
      permanent: { type: Boolean, default: false },
      decidedBy: { type: Schema.Types.ObjectId, ref: 'User' },
      decidedAt: Date,
    },
    { timestamps: true },
  );

  restoreRequestSchema.index({ biodata: 1, createdAt: -1 });

  const RestoreRequest = mongoose.model('RestoreRequest', restoreRequestSchema);

  return { RestoreRequest };
})();

// --- models/setting.model.js -------------------------------------------------------------------
const settingModel = (() => {
  const { Schema } = mongoose;

  /** A group of site settings (e.g. "site", "payments"). Defaults live in settings.service.js. */
  const settingSchema = new Schema(
    {
      key: { type: String, required: true, unique: true },
      value: Schema.Types.Mixed,
      updatedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    },
    { timestamps: true },
  );

  const Setting = mongoose.model('Setting', settingSchema);

  return { Setting };
})();

// --- models/support-ticket.model.js ------------------------------------------------------------
const supportTicketModel = (() => {
  const { Schema } = mongoose;

  const attachmentSchema = new Schema(
    {
      // An image hosted on ImgBB (uploaded by the browser).
      url: { type: String, required: true, maxlength: 500 },
    },
    { _id: false },
  );

  const messageSchema = new Schema(
    {
      author: { type: Schema.Types.ObjectId, ref: 'User', required: true },
      staff: { type: Boolean, default: false },
      // A message may be only images.
      body: { type: String, default: '', maxlength: 20000 },
      attachments: { type: [attachmentSchema], default: undefined },
    },
    { timestamps: { createdAt: true, updatedAt: false } },
  );

  /**
   * A support conversation between a member and staff.
   * Status: open → answered (staff replied) ⇄ waiting (member replied) → closed
   */
  const supportTicketSchema = new Schema(
    {
      ticketNo: { type: String, required: true, unique: true },
      user: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
      subject: { type: String, required: true, maxlength: 160 },
      category: { type: String, enum: shared.optionValues(shared.TICKET_CATEGORIES), default: 'other' },
      status: { type: String, enum: shared.optionValues(shared.TICKET_STATUS), default: 'open', index: true },
      priority: { type: String, enum: shared.optionValues(shared.TICKET_PRIORITY), default: 'normal' },
      assignedTo: { type: Schema.Types.ObjectId, ref: 'User' },
      messages: [messageSchema],
      // A ticket opened by reporting a biodata.
      report: { type: Schema.Types.ObjectId, ref: 'Report' },
      biodata: { type: Schema.Types.ObjectId, ref: 'Biodata' },
      lastMessageAt: { type: Date, default: Date.now },
      lastStaffMessageAt: Date,
      // When the member last opened the ticket, to flag new replies.
      userReadAt: Date,
      closedAt: Date,
    },
    { timestamps: true },
  );

  supportTicketSchema.index({ lastMessageAt: -1 });

  const SupportTicket = mongoose.model('SupportTicket', supportTicketSchema);

  return { SupportTicket };
})();

// --- models/user.model.js ----------------------------------------------------------------------
const userModel = (() => {
  const { Schema } = mongoose;

  /** Members who sign up with an SMS code get a placeholder email on this domain (see config/auth.js). */
  const PHONE_EMAIL_DOMAIN = 'phone.ghotok.local';

  /**
   * An account, stored in Better Auth's `user` collection. Better Auth creates and
   * signs in accounts (name, email, emailVerified, image, phoneNumber,
   * phoneNumberVerified, role, status, connectionBalance, language); this model adds
   * the fields only the API uses and lets the rest of the code query accounts.
   *
   * `role` is "user" for members and "admin" for admins. Passwords live in Better
   * Auth's `account` collection and sessions in `session`.
   */
  const userSchema = new Schema(
    {
      name: { type: String, required: true, trim: true, maxlength: 80 },
      email: { type: String, required: true, trim: true, lowercase: true, maxlength: 120 },
      emailVerified: { type: Boolean, default: false },
      image: String,
      phoneNumber: { type: String, trim: true, maxlength: 20 },
      phoneNumberVerified: { type: Boolean, default: false },
      role: { type: String, enum: shared.optionValues(shared.ROLE_OPTIONS), default: 'user', index: true },
      status: {
        type: String,
        enum: shared.optionValues(shared.USER_STATUS_OPTIONS),
        default: 'active',
        index: true,
      },
      statusReason: { type: String, maxlength: 500 },
      connectionBalance: { type: Number, default: 0, min: 0 },
      connectionsPurchased: { type: Number, default: 0 },
      connectionsUsed: { type: Number, default: 0 },
      language: { type: String, enum: ['en', 'bn'], default: 'en' },
      lastLoginAt: Date,
      deactivatedAt: Date,
    },
    // Better Auth writes createdAt/updatedAt itself; Mongoose keeps them current on its own writes.
    { collection: 'user', timestamps: true },
  );

  userSchema.index({ email: 1 }, { unique: true });
  userSchema.index(
    { phoneNumber: 1 },
    { unique: true, partialFilterExpression: { phoneNumber: { $type: 'string' } } },
  );
  userSchema.index({ createdAt: -1 });

  /** The email to show and contact, or null for SMS-only accounts. */
  userSchema.virtual('contactEmail').get(function contactEmail() {
    return this.email?.endsWith(`@${PHONE_EMAIL_DOMAIN}`) ? null : this.email;
  });

  userSchema.virtual('isVerified').get(function isVerified() {
    return !!(this.emailVerified || this.phoneNumberVerified);
  });

  const User = mongoose.model('User', userSchema);

  return { PHONE_EMAIL_DOMAIN, User };
})();

// --- models/index.js ---------------------------------------------------------------------------
const models = (() => {
  // Barrel export of every Mongoose model.

  return {
    AuditLog: auditLogModel.AuditLog,
    Banner: bannerModel.Banner,
    Biodata: biodataModel.Biodata,
    PUBLIC_FILTER: biodataModel.PUBLIC_FILTER,
    ConnectionTransaction: connectionTransactionModel.ConnectionTransaction,
    ContactMessage: contactMessageModel.ContactMessage,
    CONTACT_MESSAGE_STATUS: contactMessageModel.CONTACT_MESSAGE_STATUS,
    ContactUnlock: contactUnlockModel.ContactUnlock,
    Counter: counterModel.Counter,
    nextSequence: counterModel.nextSequence,
    Dislike: dislikeModel.Dislike,
    Faq: faqModel.Faq,
    Favorite: favoriteModel.Favorite,
    MarriageReport: marriageReportModel.MarriageReport,
    STORY_STATUS: marriageReportModel.STORY_STATUS,
    Notification: notificationModel.Notification,
    Package: packageModel.Package,
    Page: pageModel.Page,
    Payment: paymentModel.Payment,
    ProfileVisit: profileVisitModel.ProfileVisit,
    Proposal: proposalModel.Proposal,
    RefundRequest: refundRequestModel.RefundRequest,
    Report: reportModel.Report,
    RestoreRequest: restoreRequestModel.RestoreRequest,
    Setting: settingModel.Setting,
    SupportTicket: supportTicketModel.SupportTicket,
    User: userModel.User,
  };
})();

// ==============================================================================================
// INTEGRATIONS: EMAIL, SMS, PAYMENT GATEWAYS
// ==============================================================================================

// --- integrations/messaging/dev-outbox.js ------------------------------------------------------
const devOutboxIntegration = (() => {
  // With OTP_DEV_ECHO (development and tests only) the last code sent to each email or
  // phone number is kept in memory and logged, so you can sign in without a mail or SMS
  // provider. The API refuses to start in production with OTP_DEV_ECHO on.

  const codes = new Map();

  function recordDevCode(to, code) {
    if (!envConfig.env.OTP_DEV_ECHO) return;
    codes.set(to, code);
    loggerConfig.logger.info({ to, code }, 'Development one-time code');
  }

  /** The last code sent to `to` (tests and local development only). */
  function lastDevCode(to) {
    return codes.get(to);
  }

  return { recordDevCode, lastDevCode };
})();

// --- integrations/messaging/email.js -----------------------------------------------------------
const emailIntegration = (() => {
  let transport;

  function getTransport() {
    if (!envConfig.env.SMTP_HOST) return null;
    transport ??= nodemailer.createTransport({
      host: envConfig.env.SMTP_HOST,
      port: envConfig.env.SMTP_PORT,
      secure: envConfig.env.SMTP_PORT === 465,
      auth: envConfig.env.SMTP_USER
        ? { user: envConfig.env.SMTP_USER, pass: envConfig.env.SMTP_PASS }
        : undefined,
    });
    return transport;
  }

  /** Sends an email through SMTP, or logs it when SMTP is not configured (development). */
  async function sendEmail({ to, subject, text, html }) {
    const t = getTransport();
    if (!t) {
      loggerConfig.logger.info({ to, subject, text }, 'Email (SMTP not configured, logged instead)');
      return;
    }
    await t.sendMail({ from: envConfig.env.MAIL_FROM, to, subject, text, html });
  }

  return { sendEmail };
})();

// --- integrations/messaging/sms.js -------------------------------------------------------------
const smsIntegration = (() => {
  /**
   * Sends an SMS through any GET-based Bangladeshi SMS API configured in SMS_API_URL
   * ({number} → 8801XXXXXXXXX, {message} → the text), or logs it when not configured.
   */
  async function sendSms({ to, message }) {
    if (!envConfig.env.SMS_API_URL) {
      loggerConfig.logger.info({ to, message }, 'SMS (gateway not configured, logged instead)');
      return;
    }
    const url = envConfig.env.SMS_API_URL.replace('{number}', encodeURIComponent(`88${to}`)).replace(
      '{message}',
      encodeURIComponent(message),
    );
    const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) throw new Error(`SMS gateway responded ${res.status}`);
  }

  return { sendSms };
})();

// --- integrations/payments/bkash.js ------------------------------------------------------------
const bkashIntegration = (() => {
  // bKash Tokenized Checkout (https://developer.bka.sh). Flow:
  // grant token → create payment → customer pays on bkashURL → bKash redirects to
  // our callback with ?paymentID&status → execute payment → credit connections.

  let token = { idToken: null, expiresAt: 0 };

  async function post(path, body, headers = {}) {
    const res = await fetch(`${envConfig.env.BKASH_BASE_URL}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...headers },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30000),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`bKash ${path} failed with ${res.status}: ${JSON.stringify(json)}`);
    return json;
  }

  async function idToken() {
    if (token.idToken && Date.now() < token.expiresAt) return token.idToken;
    const json = await post(
      '/tokenized/checkout/token/grant',
      { app_key: envConfig.env.BKASH_APP_KEY, app_secret: envConfig.env.BKASH_APP_SECRET },
      { username: envConfig.env.BKASH_USERNAME, password: envConfig.env.BKASH_PASSWORD },
    );
    if (!json.id_token)
      throw new Error(`bKash token grant failed: ${json.statusMessage ?? JSON.stringify(json)}`);
    token = {
      idToken: json.id_token,
      expiresAt: Date.now() + (Number(json.expires_in ?? 3600) - 120) * 1000,
    };
    return token.idToken;
  }

  async function authed(path, body) {
    return post(path, body, { Authorization: await idToken(), 'X-APP-Key': envConfig.env.BKASH_APP_KEY });
  }

  const bkash = {
    name: 'bkash',
    get enabled() {
      return (
        envConfig.env.BKASH_ENABLED &&
        !!(
          envConfig.env.BKASH_APP_KEY &&
          envConfig.env.BKASH_APP_SECRET &&
          envConfig.env.BKASH_USERNAME &&
          envConfig.env.BKASH_PASSWORD
        )
      );
    },

    async startCheckout(payment, { callbackURL }) {
      const json = await authed('/tokenized/checkout/create', {
        mode: '0011',
        payerReference: String(payment.user).slice(-12),
        callbackURL,
        amount: payment.amount.toFixed(2),
        currency: 'BDT',
        intent: 'sale',
        merchantInvoiceNumber: payment.invoiceNo,
      });
      if (json.statusCode !== '0000' || !json.bkashURL)
        throw new Error(`bKash create failed: ${json.statusMessage ?? JSON.stringify(json)}`);
      return { paymentId: json.paymentID, redirectURL: json.bkashURL, raw: json };
    },

    /** Handles the redirect back from bKash. */
    async completeCheckout(query) {
      const paymentId = String(query.paymentID ?? '');
      if (!paymentId) return { paymentId, success: false, raw: query };
      if (query.status !== 'success')
        return { paymentId, success: false, cancelled: query.status === 'cancel', raw: query };
      let json = await authed('/tokenized/checkout/execute', { paymentID: paymentId }).catch((err) => ({
        error: err.message,
      }));
      // If execute timed out or was already called, the status query is authoritative.
      if (json.transactionStatus !== 'Completed') {
        json = await authed('/tokenized/checkout/payment/status', { paymentID: paymentId }).catch((err) => ({
          error: err.message,
        }));
      }
      return {
        paymentId,
        success: json.transactionStatus === 'Completed',
        trxId: json.trxID,
        amount: json.amount ? Number(json.amount) : undefined,
        raw: json,
      };
    },
  };

  return { bkash };
})();

// --- integrations/payments/nagad.js ------------------------------------------------------------
const nagadIntegration = (() => {
  // Nagad Payment Gateway (merchant checkout API v-0.2.0). Request payloads are
  // encrypted with Nagad's public key and signed with the merchant's private key;
  // responses are encrypted with the merchant's public key.

  const pem = (raw, label) => {
    const s = String(raw ?? '')
      .trim()
      .replace(/\\n/g, '\n');
    if (s.includes('BEGIN')) return s;
    const body =
      s
        .replace(/\s+/g, '')
        .match(/.{1,64}/g)
        ?.join('\n') ?? '';
    return `-----BEGIN ${label}-----\n${body}\n-----END ${label}-----`;
  };

  const nagadPublicKey = () => pem(envConfig.env.NAGAD_PUBLIC_KEY, 'PUBLIC KEY');
  const merchantPrivateKey = () => pem(envConfig.env.NAGAD_MERCHANT_PRIVATE_KEY, 'PRIVATE KEY');

  function encrypt(data) {
    return crypto
      .publicEncrypt(
        { key: nagadPublicKey(), padding: crypto.constants.RSA_PKCS1_PADDING },
        Buffer.from(data),
      )
      .toString('base64');
  }

  function sign(data) {
    return crypto.createSign('SHA256').update(data).sign(merchantPrivateKey(), 'base64');
  }

  // Node.js refuses RSA_PKCS1_PADDING in privateDecrypt (CVE-2023-46809), so we
  // decrypt without padding and remove the PKCS#1 v1.5 type-2 padding ourselves.
  function decrypt(b64) {
    const raw = crypto.privateDecrypt(
      { key: merchantPrivateKey(), padding: crypto.constants.RSA_NO_PADDING },
      Buffer.from(b64, 'base64'),
    );
    if (raw[0] !== 0x00 || raw[1] !== 0x02) throw new Error('Nagad: unexpected padding');
    const sep = raw.indexOf(0x00, 2);
    if (sep < 10) throw new Error('Nagad: unexpected padding');
    return raw.subarray(sep + 1).toString('utf8');
  }

  function dhakaTimestamp() {
    const parts = Object.fromEntries(
      new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Asia/Dhaka',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
      })
        .formatToParts(new Date())
        .map((p) => [p.type, p.value]),
    );
    return `${parts.year}${parts.month}${parts.day}${parts.hour === '24' ? '00' : parts.hour}${parts.minute}${parts.second}`;
  }

  async function request(path, { method = 'POST', body, ip } = {}) {
    const res = await fetch(`${envConfig.env.NAGAD_BASE_URL}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        'X-KM-Api-Version': 'v-0.2.0',
        'X-KM-IP-V4': ip ?? '127.0.0.1',
        'X-KM-Client-Type': 'PC_WEB',
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(30000),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`Nagad ${path} failed with ${res.status}: ${JSON.stringify(json)}`);
    return json;
  }

  const orderIdOf = (payment) => payment.invoiceNo.replace(/[^A-Za-z0-9]/g, '').slice(0, 20);

  const nagad = {
    name: 'nagad',
    get enabled() {
      return (
        envConfig.env.NAGAD_ENABLED &&
        !!(
          envConfig.env.NAGAD_MERCHANT_ID &&
          envConfig.env.NAGAD_MERCHANT_NUMBER &&
          envConfig.env.NAGAD_PUBLIC_KEY &&
          envConfig.env.NAGAD_MERCHANT_PRIVATE_KEY
        )
      );
    },

    async startCheckout(payment, { callbackURL, ip }) {
      const merchantId = envConfig.env.NAGAD_MERCHANT_ID;
      const orderId = orderIdOf(payment);
      const dateTime = dhakaTimestamp();
      const init = {
        merchantId,
        datetime: dateTime,
        orderId,
        challenge: crypto.randomBytes(20).toString('hex'),
      };
      const initRes = await request(`/api/dfs/check-out/initialize/${merchantId}/${orderId}`, {
        ip,
        body: {
          accountNumber: envConfig.env.NAGAD_MERCHANT_NUMBER,
          dateTime,
          sensitiveData: encrypt(JSON.stringify(init)),
          signature: sign(JSON.stringify(init)),
        },
      });
      if (!initRes.sensitiveData) throw new Error(`Nagad initialize failed: ${JSON.stringify(initRes)}`);
      const { paymentReferenceId, challenge } = JSON.parse(decrypt(initRes.sensitiveData));
      const order = {
        merchantId,
        orderId,
        currencyCode: '050',
        amount: payment.amount.toFixed(2),
        challenge,
      };
      const completeRes = await request(`/api/dfs/check-out/complete/${paymentReferenceId}`, {
        ip,
        body: {
          sensitiveData: encrypt(JSON.stringify(order)),
          signature: sign(JSON.stringify(order)),
          merchantCallbackURL: callbackURL,
          additionalMerchantInfo: { invoiceNo: payment.invoiceNo },
        },
      });
      if (completeRes.status !== 'Success' || !completeRes.callBackUrl)
        throw new Error(`Nagad complete failed: ${JSON.stringify(completeRes)}`);
      return {
        paymentId: paymentReferenceId,
        redirectURL: completeRes.callBackUrl,
        raw: { initialize: initRes, complete: completeRes },
      };
    },

    /** Handles the redirect back from Nagad (?payment_ref_id&status). The verify API is authoritative. */
    async completeCheckout(query) {
      const paymentId = String(query.payment_ref_id ?? '');
      if (!paymentId) return { paymentId, success: false, raw: query };
      const json = await request(`/api/dfs/verify/payment/${encodeURIComponent(paymentId)}`, {
        method: 'GET',
      }).catch((err) => ({ error: err.message }));
      return {
        paymentId,
        success: json.status === 'Success',
        cancelled: query.status === 'Aborted' || json.status === 'Aborted',
        trxId: json.issuerPaymentRefNo,
        amount: json.amount ? Number(json.amount) : undefined,
        raw: json,
      };
    },
  };

  return { nagad };
})();

// --- integrations/payments/sslcommerz.js -------------------------------------------------------
const sslcommerzIntegration = (() => {
  // SSLCommerz hosted checkout (https://developer.sslcommerz.com): cards, mobile
  // banking (bKash, Nagad, Rocket and others) and internet banking. Flow:
  // create a session → customer pays on GatewayPageURL → SSLCommerz POSTs the
  // result to our return URL (and separately to the IPN URL) → we confirm it with
  // the validation API before crediting anything.

  const form = (data) => new URLSearchParams(Object.entries(data).map(([k, v]) => [k, String(v ?? '')]));

  async function validate(valId) {
    const url = new URL(`${envConfig.env.SSLCOMMERZ_BASE_URL}/validator/api/validationserverAPI.php`);
    url.search = form({
      val_id: valId,
      store_id: envConfig.env.SSLCOMMERZ_STORE_ID,
      store_passwd: envConfig.env.SSLCOMMERZ_STORE_PASSWORD,
      format: 'json',
    }).toString();
    const res = await fetch(url, { signal: AbortSignal.timeout(30000) });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`SSLCommerz validation failed with ${res.status}`);
    return json;
  }

  const sslcommerz = {
    name: 'sslcommerz',
    get enabled() {
      return (
        envConfig.env.SSLCOMMERZ_ENABLED &&
        !!(envConfig.env.SSLCOMMERZ_STORE_ID && envConfig.env.SSLCOMMERZ_STORE_PASSWORD)
      );
    },

    /** @param {{ returnURL: string, ipnURL: string, customer: { name: string, email?: string, phone?: string } }} opts */
    async startCheckout(payment, { returnURL, ipnURL, customer }) {
      const res = await fetch(`${envConfig.env.SSLCOMMERZ_BASE_URL}/gwprocess/v4/api.php`, {
        method: 'POST',
        body: form({
          store_id: envConfig.env.SSLCOMMERZ_STORE_ID,
          store_passwd: envConfig.env.SSLCOMMERZ_STORE_PASSWORD,
          total_amount: payment.amount.toFixed(2),
          currency: 'BDT',
          tran_id: payment.invoiceNo,
          success_url: returnURL,
          fail_url: returnURL,
          cancel_url: returnURL,
          ipn_url: ipnURL,
          cus_name: customer.name,
          cus_email: customer.email || 'no-email@ghotok.com.bd',
          cus_phone: customer.phone || '01700000000',
          cus_add1: 'Bangladesh',
          cus_city: 'Dhaka',
          cus_country: 'Bangladesh',
          shipping_method: 'NO',
          num_of_item: 1,
          product_name: `${payment.connections} connections`,
          product_category: 'Service',
          product_profile: 'non-physical-goods',
        }),
        signal: AbortSignal.timeout(30000),
      });
      const json = await res.json().catch(() => ({}));
      if (json.status !== 'SUCCESS' || !json.GatewayPageURL) {
        throw new Error(`SSLCommerz session failed: ${json.failedreason ?? JSON.stringify(json)}`);
      }
      return {
        paymentId: payment.invoiceNo,
        redirectURL: json.GatewayPageURL,
        raw: { sessionkey: json.sessionkey },
      };
    },

    /** `body` is SSLCommerz's form post to the return or IPN URL. */
    async completeCheckout(body) {
      const paymentId = body.tran_id;
      if (body.status === 'CANCELLED') return { paymentId, success: false, cancelled: true, raw: body };
      if (!body.val_id) return { paymentId, success: false, raw: body };
      const v = await validate(body.val_id);
      const success =
        (v.status === 'VALID' || v.status === 'VALIDATED') && v.tran_id === paymentId && v.currency === 'BDT';
      return {
        paymentId,
        success,
        amount: Number(v.amount),
        trxId: v.bank_tran_id || v.val_id,
        raw: { status: v.status, val_id: v.val_id, card_type: v.card_type, risk_level: v.risk_level },
      };
    },
  };

  return { sslcommerz };
})();

// --- integrations/messaging/index.js -----------------------------------------------------------
const messaging = (() => {
  /** Sends a message to an email address or a phone number, whichever `to` is. Never throws. */
  async function deliver(to, { subject, text }) {
    try {
      if (to.includes('@')) await emailIntegration.sendEmail({ to, subject, text });
      else await smsIntegration.sendSms({ to, message: text });
    } catch (err) {
      loggerConfig.logger.error({ err, to }, 'Message delivery failed');
    }
  }

  return { deliver, sendEmail: emailIntegration.sendEmail, sendSms: smsIntegration.sendSms };
})();

// --- integrations/payments/index.js ------------------------------------------------------------
const paymentGateways = (() => {
  // Automatic checkout providers. Rocket (DBBL) has no public merchant API, so it —
  // like bKash and Nagad when their keys are not configured — uses manual
  // "Send Money + transaction ID" verification by an admin. SSLCommerz is
  // gateway-only (cards and mobile banking on one hosted page).
  const gateways = {
    bkash: bkashIntegration.bkash,
    nagad: nagadIntegration.nagad,
    sslcommerz: sslcommerzIntegration.sslcommerz,
  };

  function gatewayFor(method) {
    const g = gateways[method];
    return g?.enabled ? g : null;
  }

  return { gateways, gatewayFor };
})();

// ==============================================================================================
// AUTHENTICATION (BETTER AUTH)
// ==============================================================================================

// --- config/auth.js ----------------------------------------------------------------------------
const authConfig = (() => {
  // Authentication is handled by Better Auth (https://www.better-auth.com), mounted at
  // /api/auth by app.js. It stores its data in the same MongoDB database, in the
  // `user`, `session`, `account` and `verification` collections; the rest of the API
  // reads accounts through the Mongoose `User` model (models/user.model.js).
  //
  // Members sign in with email + password, a one-time code by email or SMS, or Google.
  // Every new account gets the role "user". An account becomes an admin only when its
  // `role` is changed to "admin" in the database (or by another admin).

  const OTP_MINUTES = 10;
  const INACTIVE = ['suspended', 'banned'];

  const MESSAGES = {
    'sign-in': ['Your Ghotok sign-in code', 'sign-in code', 'লগইন কোড'],
    'email-verification': ['Verify your Ghotok account', 'verification code', 'যাচাই কোড'],
    'forget-password': ['Reset your Ghotok password', 'password reset code', 'পাসওয়ার্ড রিসেট কোড'],
    'change-email': ['Confirm your new email', 'confirmation code', 'নিশ্চিতকরণ কোড'],
  };

  /** Sends a code by email or SMS. Not awaited by the caller, so timing does not reveal accounts. */
  function sendCode(to, purpose, code) {
    const [subject, en, bn] = MESSAGES[purpose] ?? MESSAGES['sign-in'];
    devOutboxIntegration.recordDevCode(to, code);
    return messaging.deliver(to, {
      subject,
      text: `Ghotok: your ${en} is ${code}. It expires in ${OTP_MINUTES} minutes. Never share it. / ঘটক ${bn}: ${code}`,
    });
  }

  /** Rejects suspended or banned accounts; signing in again reactivates a deactivated one. */
  async function beforeSessionCreate(session) {
    const users = mongoose.connection.collection('user');
    const user = await users.findOne(
      { _id: new mongoose.Types.ObjectId(String(session.userId)) },
      { projection: { status: 1 } },
    );
    if (INACTIVE.includes(user?.status)) {
      throw new APIError('FORBIDDEN', {
        code: 'ACCOUNT_INACTIVE',
        message: `Your account is ${user.status}. Please contact support.`,
      });
    }
    const set = { lastLoginAt: new Date() };
    if (user?.status === 'deactivated') Object.assign(set, { status: 'active', deactivatedAt: null });
    await users.updateOne({ _id: user._id }, { $set: set });
  }

  function createAuth() {
    return betterAuth({
      appName: 'Ghotok',
      baseURL: envConfig.env.BETTER_AUTH_URL,
      basePath: '/api/auth',
      secret: envConfig.env.BETTER_AUTH_SECRET,
      trustedOrigins: envConfig.env.CORS_ORIGINS,
      // Mongoose owns the connection; Better Auth uses the same database. A standalone
      // MongoDB (no replica set) cannot run transactions, so they are off.
      database: mongodbAdapter(mongoose.connection.db, { transaction: false }),
      emailAndPassword: {
        enabled: true,
        minPasswordLength: 8,
        maxPasswordLength: 128,
        requireEmailVerification: false,
        revokeSessionsOnPasswordReset: true,
      },
      socialProviders:
        envConfig.env.GOOGLE_CLIENT_ID && envConfig.env.GOOGLE_CLIENT_SECRET
          ? {
              google: {
                clientId: envConfig.env.GOOGLE_CLIENT_ID,
                clientSecret: envConfig.env.GOOGLE_CLIENT_SECRET,
              },
            }
          : {},
      account: { accountLinking: { enabled: true, trustedProviders: ['google'] } },
      session: {
        expiresIn: 60 * 60 * 24 * 30, // 30 days; "remember me" off ends it with the browser session
        updateAge: 60 * 60 * 24,
      },
      user: {
        additionalFields: {
          // input: false — a client can never choose these at sign-up or with update-user.
          role: { type: 'string', defaultValue: 'user', input: false },
          status: { type: 'string', defaultValue: 'active', input: false },
          connectionBalance: { type: 'number', defaultValue: 0, input: false },
          language: { type: 'string', defaultValue: 'en', required: false },
        },
      },
      databaseHooks: {
        user: {
          create: {
            // Belt and braces: whatever the source (sign-up, OTP, Google), a new account is a member.
            before: async (user) => ({ data: { ...user, role: 'user', status: 'active' } }),
          },
        },
        session: { create: { before: beforeSessionCreate } },
      },
      plugins: [
        emailOTP({
          otpLength: 6,
          expiresIn: OTP_MINUTES * 60,
          allowedAttempts: 5,
          storeOTP: 'hashed',
          sendVerificationOnSignUp: true,
          async sendVerificationOTP({ email, otp, type }) {
            void sendCode(email, type, otp);
          },
        }),
        phoneNumber({
          otpLength: 6,
          expiresIn: OTP_MINUTES * 60,
          allowedAttempts: 5,
          // Numbers are stored as 01XXXXXXXXX; the client normalises before sending.
          phoneNumberValidator: (value) =>
            value === shared.normalizePhone(value) && shared.isValidPhone(value),
          sendOTP: ({ phoneNumber: to, code }) => {
            void sendCode(to, 'sign-in', code);
          },
          sendPasswordResetOTP: ({ phoneNumber: to, code }) => {
            void sendCode(to, 'forget-password', code);
          },
          // A first sign-in by SMS code creates the account (no password until the member sets one).
          signUpOnVerification: {
            getTempEmail: (value) => `${value}@phone.ghotok.local`,
            getTempName: (value) => value,
          },
        }),
      ],
      advanced: {
        cookiePrefix: 'ghotok',
        useSecureCookies: envConfig.env.COOKIE_SECURE,
        ipAddress: { ipAddressHeaders: ['x-forwarded-for'] },
      },
      rateLimit: { enabled: envConfig.env.NODE_ENV === 'production', window: 60, max: 100 },
    });
  }

  let instance;

  /**
   * The Better Auth instance, created on first use (after Mongoose has connected,
   * because the adapter needs the database handle).
   */
  function getAuth() {
    if (!mongoose.connection.db) throw new Error('Connect to MongoDB before using auth.');
    instance ??= createAuth();
    return instance;
  }

  return { getAuth };
})();

// ==============================================================================================
// SERVICES (BUSINESS RULES)
// ==============================================================================================

// --- services/account.service.js ---------------------------------------------------------------
const accountService = (() => {
  // A member managing their own account. Passwords, sessions and sign-in methods are
  // changed through Better Auth's endpoints (/api/auth/*) from the client.

  async function updateProfile(user, { name, language }) {
    if (name !== undefined) user.name = name;
    if (language !== undefined) user.language = language;
    await user.save();
    return user;
  }

  /**
   * Deactivates the account: removes the biodata, withdraws proposals and signs out
   * everywhere. Accounts with a password must confirm it; signing in again reactivates.
   */
  async function deactivate(user, { password, reason }) {
    if (
      (await credentialsService.hasPassword(user._id)) &&
      !(password && (await credentialsService.checkPassword(user._id, password)))
    ) {
      throw new apiErrorUtils.ApiError(400, 'WRONG_PASSWORD', 'The password is incorrect.', {
        fields: { password: 'invalid' },
      });
    }
    user.status = 'deactivated';
    user.deactivatedAt = new Date();
    user.statusReason = reason;
    await user.save();
    await models.Biodata.updateOne(
      { user: user._id, deletedAt: null },
      { deletedAt: new Date(), deleteReason: 'other', deleteNote: 'Account deactivated' },
    );
    await models.Proposal.updateMany({ from: user._id, status: 'pending' }, { status: 'withdrawn' });
    await credentialsService.revokeAllSessions(user._id);
  }

  return { updateProfile, deactivate };
})();

// --- services/analytics.service.js -------------------------------------------------------------
const analyticsService = (() => {
  // Admin overview (work queues) and analytics (time series and breakdowns).
  // Days are grouped in Bangladesh time.

  const TZ = 'Asia/Dhaka';
  const LIVE = { status: 'approved', deletedAt: null, isHidden: false, blocked: { $ne: true } };

  /** Work queues for the admin overview. Finance figures only for staff allowed to see payments. */
  async function adminOverview(actor) {
    const [
      pendingBiodatas,
      openReports,
      pendingRestores,
      openTickets,
      newMessages,
      reports,
      restores,
      biodatas,
    ] = await Promise.all([
      models.Biodata.countDocuments({ status: 'pending', deletedAt: null }),
      models.Report.countDocuments({ status: { $in: ['open', 'in_review'] } }),
      models.RestoreRequest.countDocuments({ status: 'pending' }),
      models.SupportTicket.countDocuments({ status: { $in: ['open', 'waiting'] } }),
      models.ContactMessage.countDocuments({ status: 'new' }),
      models.Report.find({ status: { $in: ['open', 'in_review'] } })
        .sort({ createdAt: -1 })
        .limit(5)
        .populate('biodata', 'biodataNo')
        .populate('targetUser', 'name')
        .lean(),
      models.RestoreRequest.find({ status: 'pending' })
        .sort({ createdAt: 1 })
        .limit(5)
        .populate('biodata', 'biodataNo deletedAt')
        .lean(),
      models.Biodata.find({ status: 'pending', deletedAt: null })
        .sort({ submittedAt: 1 })
        .limit(5)
        .populate('user', 'name email phoneNumber role status'),
    ]);
    const overview = {
      kpis: { pendingBiodatas, openReports, pendingRestores, openTickets, newMessages },
      reports: reports.map((r) => ({
        id: r._id,
        reason: r.reason,
        status: r.status,
        createdAt: r.createdAt,
        biodataNo: r.biodata?.biodataNo ?? null,
        targetName: r.targetUser?.name ?? null,
      })),
      restores: restores.map((r) => ({
        id: r._id,
        createdAt: r.createdAt,
        biodataNo: r.biodata?.biodataNo ?? null,
        deletedAt: r.biodata?.deletedAt ?? null,
      })),
      biodatas: biodatas.map(biodataSerializer.toAdminRow),
    };
    if (shared.can(actor.role, 'payments.manage')) {
      const since30 = new Date(Date.now() - 30 * 864e5);
      const [pendingPayments, pendingRefunds, revenue, payments] = await Promise.all([
        models.Payment.countDocuments({ status: 'pending' }),
        models.RefundRequest.countDocuments({ status: 'pending' }),
        models.Payment.aggregate([
          { $match: { status: 'verified', creditedAt: { $gte: since30 } } },
          { $group: { _id: null, total: { $sum: '$amount' } } },
        ]),
        models.Payment.find({ status: 'pending' })
          .sort({ createdAt: 1 })
          .limit(6)
          .populate('user', 'name email phoneNumber role status'),
      ]);
      Object.assign(overview.kpis, { pendingPayments, pendingRefunds, revenue30: revenue[0]?.total ?? 0 });
      overview.payments = payments.map((p) => ({
        ...paymentSerializer.toPaymentDTO(p),
        user: userSerializer.toUserSummary(p.user),
      }));
    }
    return overview;
  }

  function lastDays(days) {
    const fmt = new Intl.DateTimeFormat('en-CA', {
      timeZone: TZ,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    return Array.from({ length: days }, (_, i) => fmt.format(new Date(Date.now() - (days - 1 - i) * 864e5)));
  }

  async function perDay(Model, dateField, match, since, sumField) {
    const rows = await Model.aggregate([
      { $match: { ...match, [dateField]: { $gte: since } } },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: `$${dateField}`, timezone: TZ } },
          n: { $sum: sumField ? `$${sumField}` : 1 },
        },
      },
    ]);
    return new Map(rows.map((r) => [r._id, r.n]));
  }

  const groupCount = (Model, match, field) =>
    Model.aggregate([
      { $match: match },
      { $group: { _id: `$${field}`, n: { $sum: 1 } } },
      { $sort: { n: -1 } },
    ]);

  const asBreakdown = (rows) =>
    rows.map((r) => ({
      key: r._id ?? 'unknown',
      count: r.n,
      ...(r.amount !== undefined ? { amount: r.amount } : {}),
    }));

  /** Daily series and breakdowns for the analytics page. */
  async function analytics(days) {
    const since = new Date(Date.now() - days * 864e5);
    const sold = { status: { $in: ['verified', 'refunded'] } };
    const [revenue, sales, signups, submissions, approvals, unlocks, visits] = await Promise.all([
      perDay(models.Payment, 'creditedAt', sold, since, 'amount'),
      perDay(models.Payment, 'creditedAt', sold, since),
      perDay(models.User, 'createdAt', { role: 'user' }, since),
      perDay(models.Biodata, 'submittedAt', {}, since),
      perDay(models.Biodata, 'approvedAt', {}, since),
      perDay(models.ConnectionTransaction, 'createdAt', { type: 'unlock' }, since),
      perDay(models.ProfileVisit, 'createdAt', {}, since),
    ]);
    const series = lastDays(days).map((day) => ({
      day,
      revenue: revenue.get(day) ?? 0,
      sales: sales.get(day) ?? 0,
      signups: signups.get(day) ?? 0,
      submissions: submissions.get(day) ?? 0,
      approvals: approvals.get(day) ?? 0,
      unlocks: unlocks.get(day) ?? 0,
      visits: visits.get(day) ?? 0,
    }));

    const [
      users,
      biodataStatus,
      type,
      religion,
      district,
      paymentMethod,
      totals,
      connections,
      deleteReasons,
    ] = await Promise.all([
      groupCount(models.User, {}, 'role'),
      groupCount(models.Biodata, { deletedAt: null }, 'status'),
      groupCount(models.Biodata, LIVE, 'type'),
      groupCount(models.Biodata, LIVE, 'religion'),
      models.Biodata.aggregate([
        { $match: LIVE },
        { $group: { _id: '$district', n: { $sum: 1 } } },
        { $sort: { n: -1 } },
        { $limit: 10 },
      ]),
      models.Payment.aggregate([
        { $match: { status: 'verified' } },
        { $group: { _id: '$method', n: { $sum: 1 }, amount: { $sum: '$amount' } } },
      ]),
      models.Payment.aggregate([
        { $match: sold },
        { $group: { _id: '$status', amount: { $sum: '$amount' }, n: { $sum: 1 } } },
      ]),
      models.ConnectionTransaction.aggregate([{ $group: { _id: '$type', n: { $sum: '$delta' } } }]),
      groupCount(models.Biodata, { deletedAt: { $ne: null } }, 'deleteReason'),
    ]);
    return {
      days,
      series,
      totals: {
        revenue: totals.find((t) => t._id === 'verified')?.amount ?? 0,
        refunded: totals.find((t) => t._id === 'refunded')?.amount ?? 0,
        sales: totals.reduce((sum, t) => sum + t.n, 0),
        connectionsSold: connections.find((c) => c._id === 'purchase')?.n ?? 0,
        connectionsUsed: -(connections.find((c) => c._id === 'unlock')?.n ?? 0),
      },
      breakdowns: {
        users: asBreakdown(users),
        biodataStatus: asBreakdown(biodataStatus),
        type: asBreakdown(type),
        religion: asBreakdown(religion),
        district: asBreakdown(district),
        paymentMethod: asBreakdown(paymentMethod),
        deleteReasons: asBreakdown(deleteReasons),
      },
    };
  }

  return { adminOverview, analytics };
})();

// --- services/attachment.service.js ------------------------------------------------------------
const attachmentService = (() => {
  // Images attached to support messages and reports. The browser uploads them to
  // ImgBB and sends the links; the validators only accept ImgBB URLs.

  /** Stored shape of the attachment links of one message. */
  function toAttachments(urls = []) {
    return urls.length ? urls.map((url) => ({ url })) : undefined;
  }

  return { toAttachments };
})();

// --- services/audit.service.js -----------------------------------------------------------------
const auditService = (() => {
  /**
   * Records a staff or security-relevant action. Never throws: an audit failure
   * must not undo the action it describes.
   * @param {import('../utils/request.js').RequestContext} ctx
   * @param {string} action dotted name, e.g. "payment.verify"
   */
  async function recordAudit(ctx, action, { targetType, targetId, summary, meta } = {}) {
    try {
      await models.AuditLog.create({
        actor: ctx?.actor?._id,
        actorRole: ctx?.actor?.role,
        action,
        targetType,
        targetId: targetId ? String(targetId) : undefined,
        summary,
        meta,
        ip: ctx?.ip,
      });
    } catch (err) {
      loggerConfig.logger.error({ err, action }, 'Audit log write failed');
    }
  }

  function listAuditLogs({ action, targetId }, params) {
    const filter = {};
    if (action) filter.action = new RegExp(`^${stringsUtils.escapeRegex(action)}`);
    if (targetId) filter.targetId = targetId;
    return paginationUtils.paginate(
      models.AuditLog.find(filter)
        .sort({ createdAt: -1 })
        .populate('actor', 'name email phoneNumber role status')
        .lean(),
      models.AuditLog.countDocuments(filter),
      params,
      (a) => ({
        id: a._id,
        action: a.action,
        summary: a.summary ?? null,
        targetType: a.targetType ?? null,
        targetId: a.targetId ?? null,
        meta: a.meta ?? null,
        ip: a.ip ?? null,
        createdAt: a.createdAt,
        actor: userSerializer.toUserSummary(a.actor),
      }),
    );
  }

  return { recordAudit, listAuditLogs };
})();

// --- services/banner.service.js ----------------------------------------------------------------
const bannerService = (() => {
  // Printable wedding banners: staff upload a preview and the full design to ImgBB
  // from the admin panel; visitors download them for free.

  function toBannerDTO(b, { admin = false } = {}) {
    return {
      id: b._id.toString(),
      title: b.title,
      imageUrl: b.imageUrl,
      downloads: b.downloads,
      ...(admin ? { downloadUrl: b.downloadUrl, isActive: b.isActive, sortOrder: b.sortOrder } : {}),
    };
  }

  async function activeBanners() {
    const items = await models.Banner.find({ isActive: true }).sort({ sortOrder: 1, createdAt: -1 });
    return items.map((b) => toBannerDTO(b));
  }

  /** Counts a download and returns the link to the full-size design. */
  async function downloadBanner(id) {
    const b = await models.Banner.findOneAndUpdate(
      { _id: id, isActive: true },
      { $inc: { downloads: 1 } },
      { new: true },
    );
    if (!b) throw apiErrorUtils.notFound('Banner');
    return { url: b.downloadUrl };
  }

  // ----- Staff -------------------------------------------------------------------

  async function listBanners() {
    const items = await models.Banner.find().sort({ sortOrder: 1, createdAt: -1 });
    return items.map((b) => toBannerDTO(b, { admin: true }));
  }

  async function createBanner(data, ctx) {
    const b = await models.Banner.create({
      title: data.title,
      imageUrl: data.imageUrl,
      downloadUrl: data.downloadUrl ?? data.imageUrl,
      sortOrder: data.sortOrder ?? 0,
      isActive: data.isActive ?? true,
    });
    await auditService.recordAudit(ctx, 'banner.create', {
      targetType: 'banner',
      targetId: b._id,
      summary: `Added banner ${b.title.en}`,
    });
    return toBannerDTO(b, { admin: true });
  }

  async function updateBanner(id, data, ctx) {
    const b = await models.Banner.findById(id);
    if (!b) throw apiErrorUtils.notFound('Banner');
    for (const key of ['title', 'imageUrl', 'downloadUrl', 'sortOrder', 'isActive'])
      if (data[key] !== undefined) b[key] = data[key];
    await b.save();
    await auditService.recordAudit(ctx, 'banner.update', {
      targetType: 'banner',
      targetId: b._id,
      summary: `Updated banner ${b.title.en}`,
    });
    return toBannerDTO(b, { admin: true });
  }

  async function deleteBanner(id, ctx) {
    const b = await models.Banner.findByIdAndDelete(id);
    if (!b) throw apiErrorUtils.notFound('Banner');
    await auditService.recordAudit(ctx, 'banner.delete', {
      targetType: 'banner',
      targetId: b._id,
      summary: `Deleted banner ${b.title.en}`,
    });
  }

  return { activeBanners, downloadBanner, listBanners, createBanner, updateBanner, deleteBanner };
})();

// --- services/biodata-review.service.js --------------------------------------------------------
const biodataReviewService = (() => {
  // Staff work on biodatas: review queue, approval, edits, hiding, deletion
  // and the soft-delete recovery queue.

  const OWNER_FIELDS = 'name email phoneNumber role status';

  async function load(id) {
    const b = await models.Biodata.findById(id).populate('user', OWNER_FIELDS);
    if (!b) throw apiErrorUtils.notFound('Biodata');
    return b;
  }

  async function listBiodatas({ status, type, religion, hidden, blocked, deleted, q }, query) {
    const filter = {};
    if (deleted === 'true') filter.deletedAt = { $ne: null };
    else if (deleted !== 'all') filter.deletedAt = null;
    if (status) filter.status = status;
    if (type) filter.type = type;
    if (religion) filter.religion = religion;
    if (hidden === 'true') filter.isHidden = true;
    if (blocked === 'true') filter.blocked = true;
    if (q) {
      const re = new RegExp(stringsUtils.escapeRegex(q), 'i');
      const users = await models.User.find({
        $or: [{ name: re }, { email: q.toLowerCase() }, { phoneNumber: q }],
      })
        .select('_id')
        .limit(50);
      filter.$or = [
        { biodataNo: new RegExp(`^${stringsUtils.escapeRegex(q)}`, 'i') },
        { user: { $in: users.map((u) => u._id) } },
      ];
    }
    // The review queue is first-in, first-out.
    const sort = status === 'pending' ? { submittedAt: 1 } : { updatedAt: -1 };
    return paginationUtils.paginate(
      models.Biodata.find(filter).sort(sort).populate('user', OWNER_FIELDS),
      models.Biodata.countDocuments(filter),
      paginationUtils.pageParams(query, { defaultLimit: 20 }),
      biodataSerializer.toAdminRow,
    );
  }

  async function getBiodataForReview(id) {
    const b = await load(id);
    const [visits, favoritedBy, unlocks, proposals, reports, restoreRequest] = await Promise.all([
      visitService.visitStats(b._id),
      models.Favorite.countDocuments({ biodata: b._id }),
      models.ContactUnlock.countDocuments({ biodata: b._id }),
      models.Proposal.countDocuments({ toBiodata: b._id }),
      models.Report.find({ biodata: b._id }).sort({ createdAt: -1 }).limit(10).lean(),
      models.RestoreRequest.findOne({ biodata: b._id }).sort({ createdAt: -1 }).lean(),
    ]);
    return {
      biodata: {
        ...biodataSerializer.toFullView(b),
        corrections: biodataService.correctionsState(b),
        deleteNote: b.deleteNote ?? null,
        reviewedAt: b.reviewedAt ?? null,
      },
      completion: shared.biodataCompletion(b.sectionsObject()),
      owner: userSerializer.toUserSummary(b.user),
      activity: { visits, favoritedBy, unlocks, proposals },
      reports: reports.map((r) => ({
        id: r._id,
        reason: r.reason,
        status: r.status,
        createdAt: r.createdAt,
      })),
      restoreRequest,
    };
  }

  /** Approves a complete biodata; it becomes public. */
  async function approveBiodata(id, ctx) {
    const b = await load(id);
    if (b.deletedAt)
      throw apiErrorUtils.conflict('BIODATA_DELETED', 'Restore the biodata before approving it.');
    const errors = shared.validateBiodata(b.sectionsObject());
    if (Object.keys(errors).length) {
      throw apiErrorUtils.badRequest('INCOMPLETE', 'This biodata is incomplete and cannot be approved.', {
        sections: errors,
      });
    }
    const now = new Date();
    const firstApproval = !b.firstApprovedAt;
    Object.assign(b, {
      status: 'approved',
      approvedAt: now,
      reviewedAt: now,
      reviewedBy: ctx.actor._id,
      rejectionReason: undefined,
      corrections: [],
    });
    b.firstApprovedAt ??= now;
    await b.save();
    // A one-time gift of connections the first time a biodata goes live.
    const { approvalGift } = await settingsService.getSetting('payments');
    if (firstApproval && approvalGift > 0) {
      await connectionService.changeBalance(b.user._id, approvalGift, {
        type: 'gift',
        biodata: b._id,
        actor: ctx.actor._id,
        reason: `Approval gift for ${b.biodataNo}`,
      });
      await notificationService.notify(
        b.user._id,
        'connections_gift',
        { n: approvalGift },
        '/dashboard/connections',
      );
    }
    await notificationService.notify(
      b.user._id,
      'biodata_approved',
      { biodataNo: b.biodataNo },
      `/biodatas/${b.biodataNo}`,
    );
    await auditService.recordAudit(ctx, 'biodata.approve', {
      targetType: 'biodata',
      targetId: b._id,
      summary: `Approved ${b.biodataNo}`,
    });
    return biodataSerializer.toAdminRow(b);
  }

  /**
   * Sends a biodata back to its owner with the changes needed: a general message and,
   * optionally, the specific answers to correct (each with a note). The owner cannot
   * resubmit until every flagged answer has changed.
   */
  async function rejectBiodata(id, { reason, corrections = [] }, ctx) {
    const b = await load(id);
    const sections = b.sectionsObject();
    Object.assign(b, {
      status: 'rejected',
      rejectionReason: reason,
      reviewedAt: new Date(),
      reviewedBy: ctx.actor._id,
      corrections: corrections.map((c) => ({ ...c, previous: sections[c.section]?.[c.field] ?? null })),
    });
    await b.save();
    await notificationService.notify(
      b.user._id,
      'biodata_rejected',
      { biodataNo: b.biodataNo, reason },
      '/dashboard/biodata',
    );
    await auditService.recordAudit(ctx, 'biodata.reject', {
      targetType: 'biodata',
      targetId: b._id,
      summary: `Rejected ${b.biodataNo}`,
      meta: { reason, corrections: corrections.map((c) => `${c.section}.${c.field}`) },
    });
    return biodataSerializer.toAdminRow(b);
  }

  /** Staff correction of one section. Does not change the review status. */
  async function editSection(id, section, data, ctx) {
    const b = await load(id);
    const { value, errors } = shared.validateSection(section, data, {
      biodata: b.sectionsObject(),
      partial: true,
    });
    if (Object.keys(errors).length) throw apiErrorUtils.validationError(errors);
    b.set(section, value);
    await b.save();
    await auditService.recordAudit(ctx, 'biodata.edit', {
      targetType: 'biodata',
      targetId: b._id,
      summary: `Edited ${section} of ${b.biodataNo}`,
    });
    return {
      biodata: biodataSerializer.toFullView(b),
      completion: shared.biodataCompletion(b.sectionsObject()),
    };
  }

  /** Pauses (or resumes, with `until: null`) the owner's editing and resubmitting. */
  async function setEditSuspension(id, { until, reason }, ctx) {
    const b = await load(id);
    b.editSuspendedUntil = until ?? null;
    await b.save();
    if (until)
      await notificationService.notify(
        b.user._id,
        'edit_suspended',
        { biodataNo: b.biodataNo, until, reason },
        '/dashboard/biodata',
      );
    await auditService.recordAudit(ctx, until ? 'biodata.suspend_edit' : 'biodata.resume_edit', {
      targetType: 'biodata',
      targetId: b._id,
      summary: until
        ? `Editing of ${b.biodataNo} paused until ${until.toISOString().slice(0, 10)}`
        : `Editing of ${b.biodataNo} resumed`,
      meta: { reason },
    });
    return biodataSerializer.toAdminRow(b);
  }

  /** Hides (or un-hides) a biodata from the public, independent of the owner's own setting. */
  async function setBlocked(id, { blocked, reason }, ctx) {
    const b = await load(id);
    b.blocked = blocked;
    await b.save();
    await auditService.recordAudit(ctx, blocked ? 'biodata.block' : 'biodata.unblock', {
      targetType: 'biodata',
      targetId: b._id,
      summary: `${blocked ? 'Hid' : 'Unhid'} ${b.biodataNo}`,
      meta: { reason },
    });
    return biodataSerializer.toAdminRow(b);
  }

  async function softDelete(id, reason, ctx) {
    const b = await load(id);
    if (!b.deletedAt) {
      Object.assign(b, {
        deletedAt: new Date(),
        deleteReason: 'other',
        deleteNote: `Removed by staff: ${reason}`,
      });
      await b.save();
      await models.Proposal.updateMany({ toBiodata: b._id, status: 'pending' }, { status: 'withdrawn' });
    }
    await auditService.recordAudit(ctx, 'biodata.soft_delete', {
      targetType: 'biodata',
      targetId: b._id,
      summary: `Deleted ${b.biodataNo}`,
      meta: { reason },
    });
    return biodataSerializer.toAdminRow(b);
  }

  async function restore(b, note, ctx) {
    Object.assign(b, { deletedAt: null, deleteReason: undefined, deleteNote: undefined });
    await b.save();
    await models.RestoreRequest.updateMany(
      { biodata: b._id, status: 'pending' },
      { status: 'approved', decidedBy: ctx.actor._id, decidedAt: new Date(), note },
    );
    await notificationService.notify(
      b.user._id ?? b.user,
      'restore_approved',
      { biodataNo: b.biodataNo },
      '/dashboard',
    );
    await auditService.recordAudit(ctx, 'biodata.restore', {
      targetType: 'biodata',
      targetId: b._id,
      summary: `Restored ${b.biodataNo}`,
    });
  }

  async function restoreBiodata(id, note, ctx) {
    const b = await load(id);
    if (!b.deletedAt) throw apiErrorUtils.conflict('NOT_DELETED', 'This biodata is not deleted.');
    await restore(b, note, ctx);
    return biodataSerializer.toAdminRow(b);
  }

  // ----- Recovery queue ------------------------------------------------------------

  function listRestoreRequests({ status }, query) {
    const filter = status ? { status } : {};
    return paginationUtils.paginate(
      models.RestoreRequest.find(filter)
        .sort({ createdAt: status === 'pending' ? 1 : -1 })
        .populate('biodata', 'biodataNo deletedAt deleteReason deleteNote type')
        .populate('user', OWNER_FIELDS)
        .lean(),
      models.RestoreRequest.countDocuments(filter),
      paginationUtils.pageParams(query, { defaultLimit: 20 }),
      (r) => ({
        id: r._id,
        status: r.status,
        reason: r.reason ?? null,
        note: r.note ?? null,
        permanent: !!r.permanent,
        createdAt: r.createdAt,
        decidedAt: r.decidedAt ?? null,
        biodata: r.biodata
          ? {
              id: r.biodata._id,
              biodataNo: r.biodata.biodataNo,
              deletedAt: r.biodata.deletedAt,
              deleteReason: r.biodata.deleteReason,
              deleteNote: r.biodata.deleteNote ?? null,
            }
          : null,
        user: userSerializer.toUserSummary(r.user),
      }),
    );
  }

  async function approveRestoreRequest(id, note, ctx) {
    const request = await models.RestoreRequest.findOne({ _id: id, status: 'pending' });
    if (!request) throw apiErrorUtils.notFound('Request');
    const b = await models.Biodata.findById(request.biodata);
    if (!b) throw apiErrorUtils.notFound('Biodata');
    await restore(b, note, ctx);
  }

  async function declineRestoreRequest(id, { note, permanent = false }, ctx) {
    const request = await models.RestoreRequest.findOneAndUpdate(
      { _id: id, status: 'pending' },
      { status: 'declined', note, permanent, decidedBy: ctx.actor._id, decidedAt: new Date() },
      { new: true },
    ).populate('biodata', 'biodataNo');
    if (!request) throw apiErrorUtils.notFound('Request');
    await notificationService.notify(
      request.user,
      'restore_declined',
      { biodataNo: request.biodata?.biodataNo, note },
      '/dashboard/settings',
    );
    await auditService.recordAudit(ctx, 'restore.decline', {
      targetType: 'restore_request',
      targetId: request._id,
      summary: `Declined restore of ${request.biodata?.biodataNo}`,
    });
  }

  return {
    listBiodatas,
    getBiodataForReview,
    approveBiodata,
    rejectBiodata,
    editSection,
    setEditSuspension,
    setBlocked,
    softDelete,
    restoreBiodata,
    listRestoreRequests,
    approveRestoreRequest,
    declineRestoreRequest,
  };
})();

// --- services/biodata.service.js ---------------------------------------------------------------
const biodataService = (() => {
  // A member's own biodata, and the public view of other members' biodatas.

  const FIRST_BIODATA_NO = 1000;

  const sameValue = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

  /** The reviewer's correction requests, each marked `changed` once the owner has edited that answer. */
  function correctionsState(b) {
    const sections = b.sectionsObject();
    return (b.corrections ?? []).map((c) => ({
      section: c.section,
      field: c.field,
      note: c.note ?? null,
      // The answer when staff asked for the change (the owner's own data, so both views may show it).
      previous: c.previous ?? null,
      changed: !sameValue(sections[c.section]?.[c.field], c.previous),
    }));
  }

  /** The owner's view plus the editor's completion summary. */
  const ownerView = (b) => ({
    biodata: { ...biodataSerializer.toFullView(b), corrections: correctionsState(b) },
    completion: shared.biodataCompletion(b.sectionsObject()),
  });

  function findOwn(userId) {
    return models.Biodata.findOne({ user: userId });
  }

  async function requireOwn(userId) {
    const b = await findOwn(userId);
    if (!b) throw apiErrorUtils.notFound('Biodata');
    return b;
  }

  /** The owner's biodata for editing; it must have been started (pledge accepted) first. */
  async function requireStarted(userId) {
    const b = await findOwn(userId);
    if (!b)
      throw apiErrorUtils.conflict(
        'PLEDGE_REQUIRED',
        'Please read and accept the pledge before creating your biodata.',
      );
    return b;
  }

  function assertEditable(b) {
    if (b.deletedAt) {
      throw apiErrorUtils.conflict(
        'BIODATA_DELETED',
        'This biodata has been deleted. Request a restore to edit it again.',
      );
    }
    if (b.editSuspendedUntil && b.editSuspendedUntil > new Date()) {
      throw apiErrorUtils.forbidden('EDIT_SUSPENDED', 'Editing your biodata has been paused by our team.', {
        until: b.editSuspendedUntil,
      });
    }
  }

  /**
   * Starts the member's biodata once they have accepted the eligibility rules and
   * the pledge (the API schema requires `pledge: true`). Idempotent.
   */
  async function createOwn(userId) {
    const existing = await findOwn(userId);
    if (existing) return existing;
    const seq = await models.nextSequence('biodata', FIRST_BIODATA_NO);
    return models.Biodata.create({ user: userId, biodataNo: `GH-${seq}`, pledgeAcceptedAt: new Date() });
  }

  /**
   * Saves one form section. Missing required fields are allowed (drafts); invalid
   * values are not. Changing a live biodata sends it back to review.
   * @returns {Promise<{ biodata: object, statusChanged: boolean }>}
   */
  async function saveSection(userId, section, data) {
    const b = await requireStarted(userId);
    assertEditable(b);
    const { value, errors } = shared.validateSection(section, data, {
      biodata: b.sectionsObject(),
      partial: true,
    });
    if (Object.keys(errors).length) throw apiErrorUtils.validationError(errors);

    b.set(section, value);
    const wasApproved = b.status === 'approved';
    if (wasApproved) {
      const { complete } = shared.biodataCompletion(b.sectionsObject());
      b.status = complete ? 'pending' : 'draft';
      if (complete) b.submittedAt = new Date();
    }
    await b.save();
    return { biodata: b, statusChanged: wasApproved };
  }

  /** Submits a complete biodata for review. */
  async function submitForReview(userId) {
    const b = await requireOwn(userId);
    assertEditable(b);
    const errors = shared.validateBiodata(b.sectionsObject());
    if (Object.keys(errors).length) {
      throw apiErrorUtils.badRequest('INCOMPLETE', 'Please complete every section before submitting.', {
        sections: errors,
      });
    }
    const unchanged = correctionsState(b).filter((c) => !c.changed);
    if (b.status === 'rejected' && unchanged.length) {
      throw apiErrorUtils.conflict(
        'CORRECTIONS_PENDING',
        'Please correct every flagged answer before submitting.',
        {
          fields: unchanged.map(({ section, field }) => ({ section, field })),
        },
      );
    }
    if (b.status === 'draft' || b.status === 'rejected') {
      b.status = 'pending';
      b.submittedAt = new Date();
      b.rejectionReason = undefined;
      await b.save();
    }
    return b;
  }

  /** Hides a biodata from search (with the owner's reason) or makes it live again. */
  async function setHidden(userId, { hidden, reason, note }) {
    const b = await requireOwn(userId);
    assertEditable(b);
    b.isHidden = hidden;
    b.hideReason = hidden ? reason : undefined;
    b.hideNote = hidden ? note : undefined;
    await b.save();
    return b;
  }

  const MARRIED = ['married_via_ghotok', 'married_elsewhere'];

  /** Records "we got married" details; the partner is linked when they were on Ghotok too. */
  async function recordMarriage(userId, b, reason, marriage) {
    let partnerBiodata;
    if (marriage.partnerBiodataNo) {
      partnerBiodata = await models.Biodata.findOne({
        biodataNo: marriage.partnerBiodataNo.toUpperCase(),
      }).select('_id');
    }
    await models.MarriageReport.create({
      user: userId,
      biodata: b._id,
      viaGhotok: reason === 'married_via_ghotok',
      marriedOn: marriage.marriedOn,
      place: marriage.place,
      partnerBiodata: partnerBiodata?._id,
      partner: marriage.partner,
      story: marriage.story,
      shareStory: !!marriage.shareStory,
    });
  }

  /** Soft-deletes the owner's biodata. It can be restored through the recovery queue. */
  async function softDeleteOwn(userId, { reason, note, marriage }, ctx) {
    const b = await requireOwn(userId);
    if (b.deletedAt) return b;
    b.deletedAt = new Date();
    b.deleteReason = reason;
    b.deleteNote = note;
    await b.save();
    if (marriage && MARRIED.includes(reason)) await recordMarriage(userId, b, reason, marriage);
    await models.Proposal.updateMany({ from: userId, status: 'pending' }, { status: 'withdrawn' });
    await auditService.recordAudit(ctx, 'biodata.soft_delete', {
      targetType: 'biodata',
      targetId: b._id,
      summary: `${b.biodataNo} deleted by owner (${reason})`,
    });
    return b;
  }

  async function latestRestoreRequest(userId) {
    const b = await findOwn(userId);
    return b ? models.RestoreRequest.findOne({ biodata: b._id }).sort({ createdAt: -1 }).lean() : null;
  }

  /**
   * Restores a deleted biodata straight away when it was never published. A
   * biodata that has been live needs staff approval (see requestRestore).
   */
  async function restoreOwn(userId) {
    const b = await requireOwn(userId);
    if (!b.deletedAt) throw apiErrorUtils.conflict('NOT_DELETED', 'Your biodata is not deleted.');
    if (b.firstApprovedAt) {
      throw apiErrorUtils.conflict(
        'RESTORE_NEEDS_APPROVAL',
        'This biodata was published before, so our team needs to approve the restore.',
      );
    }
    Object.assign(b, { deletedAt: null, deleteReason: undefined, deleteNote: undefined });
    await b.save();
    return b;
  }

  async function requestRestore(userId, reason) {
    const b = await findOwn(userId);
    if (!b?.deletedAt) throw apiErrorUtils.conflict('NOT_DELETED', 'Your biodata is not deleted.');
    if (await models.RestoreRequest.exists({ biodata: b._id, status: 'declined', permanent: true })) {
      throw apiErrorUtils.conflict(
        'RESTORE_BLOCKED',
        'Restoring this biodata has been permanently declined.',
      );
    }
    if (await models.RestoreRequest.exists({ biodata: b._id, status: 'pending' })) {
      throw apiErrorUtils.conflict(
        'ALREADY_REQUESTED',
        'You have already asked for a restore. Please wait for our team.',
      );
    }
    return models.RestoreRequest.create({ biodata: b._id, user: userId, reason });
  }

  async function ownStats(userId) {
    const b = await findOwn(userId);
    if (!b) return { visits: { today: 0, week: 0, month: 0 }, favoritedBy: 0, unlocks: 0, views: 0 };
    const [visits, favoritedBy] = await Promise.all([
      visitService.visitStats(b._id),
      models.Favorite.countDocuments({ biodata: b._id }),
    ]);
    return { visits, favoritedBy, unlocks: b.stats?.unlocks ?? 0, views: b.stats?.views ?? 0 };
  }

  // ----- Public ------------------------------------------------------------------

  /** Finds a public biodata by its number (e.g. "GH-1024") or throws 404. */
  /**
   * Basic facts about a biodata by number, for the "we got married" form: enough to
   * recognise the partner, nothing private. Works for hidden or deleted biodatas too.
   */
  async function lookupPartner(biodataNo, userId) {
    const b = await models.Biodata.findOne({ biodataNo: String(biodataNo).toUpperCase() }).select(
      'biodataNo user type district profession educationLevel',
    );
    if (!b || b.user.equals(userId)) throw apiErrorUtils.notFound('Biodata');
    return {
      biodataNo: b.biodataNo,
      type: b.type ?? null,
      district: b.district ?? null,
      profession: b.profession ?? null,
      education: b.educationLevel ?? null,
    };
  }

  async function findPublic(biodataNo) {
    const b = await models.Biodata.findOne({
      biodataNo: String(biodataNo).toUpperCase(),
      ...models.PUBLIC_FILTER,
    });
    if (!b) throw apiErrorUtils.notFound('Biodata');
    return b;
  }

  /** Finds any biodata by number, public or not (for removing list entries, reports). */
  async function findByNumber(biodataNo) {
    const b = await models.Biodata.findOne({ biodataNo: String(biodataNo).toUpperCase() });
    if (!b) throw apiErrorUtils.notFound('Biodata');
    return b;
  }

  function assertNotOwn(b, user, message = 'This is your own biodata.') {
    if (b.user.equals(user._id)) throw apiErrorUtils.badRequest('OWN_BIODATA', message);
  }

  /** What a signed-in member sees about a biodata: lists, unlock, contact and proposal. */
  async function viewerState(user, biodataNo) {
    const b = await findPublic(biodataNo);
    const isOwner = b.user.equals(user._id);
    const [favorite, dislike, unlock, proposal, report] = await Promise.all([
      models.Favorite.exists({ user: user._id, biodata: b._id }),
      models.Dislike.exists({ user: user._id, biodata: b._id }),
      models.ContactUnlock.findOne({ user: user._id, biodata: b._id }).select('refundedAt').lean(),
      models.Proposal.findOne({
        $or: [
          { from: user._id, toBiodata: b._id },
          { from: b.user, to: user._id },
        ],
        status: { $in: ['pending', 'accepted'] },
      }).sort({ createdAt: -1 }),
      models.Report.findOne({ reporter: user._id, biodata: b._id })
        .sort({ createdAt: -1 })
        .select('status ticket')
        .lean(),
    ]);
    const unlocked = isOwner || !!unlock;
    return {
      isOwner,
      isFavorite: !!favorite,
      isDisliked: !!dislike,
      unlocked,
      contact: unlocked ? biodataSerializer.toContact(b) : null,
      // The connection was given back after the member's report was upheld.
      refunded: !!unlock?.refundedAt,
      report: report ? { status: report.status, ticketId: report.ticket?.toString() ?? null } : null,
      proposal: proposal
        ? {
            id: proposal._id,
            status: proposal.status,
            direction: proposal.from.equals(user._id) ? 'sent' : 'received',
          }
        : null,
      balance: user.connectionBalance,
    };
  }

  return {
    correctionsState,
    ownerView,
    findOwn,
    createOwn,
    saveSection,
    submitForReview,
    setHidden,
    softDeleteOwn,
    latestRestoreRequest,
    restoreOwn,
    requestRestore,
    ownStats,
    lookupPartner,
    findPublic,
    findByNumber,
    assertNotOwn,
    viewerState,
  };
})();

// --- services/connection.service.js ------------------------------------------------------------
const connectionService = (() => {
  // The connection ledger. `User.connectionBalance` is changed only through
  // changeBalance(), which uses atomic conditional updates (no transactions needed)
  // and writes one ConnectionTransaction per change.

  /**
   * Atomically changes a balance and records it.
   * Negative changes never take a balance below zero: they fail with 402, or with
   * `clamp` remove only what is left.
   * @returns {Promise<{ user: object, applied: number, transaction: object | null }>}
   */
  async function changeBalance(
    userId,
    delta,
    { type, reason, payment, biodata, refund, actor, clamp = false } = {},
  ) {
    if (!Number.isInteger(delta) || delta === 0)
      throw new apiErrorUtils.ApiError(400, 'BAD_QUANTITY', 'Quantity must be a whole number.');
    let applied = delta;
    const inc = { connectionBalance: delta };
    if (type === 'unlock') inc.connectionsUsed = 1;
    if (type === 'purchase') inc.connectionsPurchased = delta;

    let user;
    if (delta > 0) {
      user = await models.User.findByIdAndUpdate(userId, { $inc: inc }, { new: true });
    } else {
      user = await models.User.findOneAndUpdate(
        { _id: userId, connectionBalance: { $gte: -delta } },
        { $inc: inc },
        { new: true },
      );
      if (!user && clamp) {
        const current = await models.User.findById(userId);
        if (!current) throw apiErrorUtils.notFound('User');
        if (current.connectionBalance === 0) return { user: current, applied: 0, transaction: null };
        applied = -current.connectionBalance;
        user = await models.User.findOneAndUpdate(
          { _id: userId, connectionBalance: current.connectionBalance },
          { $inc: { connectionBalance: applied } },
          { new: true },
        );
      }
    }
    if (!user) {
      if (!(await models.User.exists({ _id: userId }))) throw apiErrorUtils.notFound('User');
      throw new apiErrorUtils.ApiError(
        402,
        'INSUFFICIENT_CONNECTIONS',
        'You do not have enough connections. Please buy a package.',
      );
    }
    const transaction = await models.ConnectionTransaction.create({
      user: userId,
      type,
      delta: applied,
      balanceAfter: user.connectionBalance,
      reason,
      payment,
      biodata,
      refund,
      actor,
    });
    return { user, applied, transaction };
  }

  /**
   * Marks a payment verified and credits its connections exactly once — safe when
   * two admins, or an admin and a gateway callback, act at the same moment.
   * @returns {Promise<object | null>} the payment, or null if it was already processed
   */
  async function creditPayment(paymentId, { actor, trxId, gatewayResponse } = {}) {
    const set = { status: 'verified', creditedAt: new Date(), reviewedAt: new Date() };
    if (actor) set.reviewedBy = actor;
    if (trxId) set.trxId = trxId;
    if (gatewayResponse) set['gateway.response'] = gatewayResponse;
    const payment = await models.Payment.findOneAndUpdate(
      { _id: paymentId, status: { $in: ['initiated', 'pending'] }, creditedAt: null },
      { $set: set },
      { new: true },
    );
    if (!payment) return null;
    try {
      await changeBalance(payment.user, payment.connections, {
        type: 'purchase',
        payment: payment._id,
        actor,
        reason: payment.invoiceNo,
      });
    } catch (err) {
      // Put the payment back so it can be verified again.
      await models.Payment.updateOne(
        { _id: payment._id },
        { $set: { status: 'pending' }, $unset: { creditedAt: 1 } },
      );
      loggerConfig.logger.error({ err, payment: payment.invoiceNo }, 'Crediting a payment failed');
      throw err;
    }
    await notificationService.notify(
      payment.user,
      'payment_verified',
      { invoiceNo: payment.invoiceNo, connections: payment.connections },
      '/dashboard/connections',
    );
    return payment;
  }

  /**
   * Unlocks a biodata's guardian contact, charging one connection the first time
   * only. The unique (user, biodata) index makes double clicks and parallel
   * requests safe: the unlock row is created first, then the balance is charged.
   */
  async function unlockContact(user, biodataNo) {
    const b = await biodataService.findPublic(biodataNo);
    biodataService.assertNotOwn(b, user);
    const result = await unlockOnce(user, b);
    if (result.charged)
      await notificationService.notify(b.user, 'contact_unlocked', { biodataNo: b.biodataNo });
    return {
      unlocked: true,
      charged: result.charged,
      balance: result.balance,
      contact: biodataSerializer.toContact(b),
    };
  }

  async function unlockOnce(user, biodata) {
    const existing = await models.ContactUnlock.findOne({ user: user._id, biodata: biodata._id });
    if (existing) return { charged: false, balance: user.connectionBalance };
    let unlock;
    try {
      unlock = await models.ContactUnlock.create({ user: user._id, biodata: biodata._id });
    } catch (err) {
      if (err?.code === 11000) return { charged: false, balance: user.connectionBalance };
      throw err;
    }
    try {
      const { user: updated, transaction } = await changeBalance(user._id, -1, {
        type: 'unlock',
        biodata: biodata._id,
        reason: biodata.biodataNo,
      });
      unlock.transaction = transaction._id;
      await unlock.save();
      await models.Biodata.updateOne({ _id: biodata._id }, { $inc: { 'stats.unlocks': 1 } });
      return { charged: true, balance: updated.connectionBalance };
    } catch (err) {
      await models.ContactUnlock.deleteOne({ _id: unlock._id });
      throw err;
    }
  }

  /** A member's balance and connection history. */
  async function myConnections(user, query) {
    const params = paginationUtils.pageParams(query, { defaultLimit: 20 });
    const filter = { user: user._id };
    const [ledger, total] = await Promise.all([
      models.ConnectionTransaction.find(filter)
        .sort({ createdAt: -1 })
        .skip(params.skip)
        .limit(params.limit)
        .populate('biodata', 'biodataNo')
        .populate('payment', 'invoiceNo method')
        .lean(),
      models.ConnectionTransaction.countDocuments(filter),
    ]);
    return {
      balance: user.connectionBalance,
      purchased: user.connectionsPurchased,
      used: user.connectionsUsed,
      ledger: paginationUtils.paged(ledger.map(paymentSerializer.toLedgerEntryDTO), total, params),
    };
  }

  const ADJUSTMENT_TYPES = { grant: 'admin_grant', revoke: 'admin_revoke', refund_credit: 'refund_credit' };

  /** Staff: grant, revoke or refund connections by hand. The reason is kept in the audit log. */
  async function adjustConnections({ user: ref, action, quantity, reason }, ctx) {
    const user = await userService.findUserByAny(ref);
    const delta = action === 'revoke' ? -quantity : quantity;
    const { user: updated, transaction } = await changeBalance(user._id, delta, {
      type: ADJUSTMENT_TYPES[action],
      actor: ctx.actor._id,
      reason,
    });
    await notificationService.notify(
      user._id,
      'connections_adjusted',
      { delta, balance: updated.connectionBalance, reason },
      '/dashboard/connections',
    );
    await auditService.recordAudit(ctx, `connections.${action}`, {
      targetType: 'user',
      targetId: user._id,
      summary: `${delta > 0 ? '+' : ''}${delta} connections for ${user.name}`,
      meta: { reason },
    });
    return {
      user: userSerializer.toUserSummary(updated),
      balance: updated.connectionBalance,
      transactionId: transaction._id,
    };
  }

  /** Staff: the ledger across all users, optionally for one user or one type. */
  async function listLedger({ user, type }, query) {
    const filter = {};
    if (user) filter.user = (await userService.findUserByAny(user))._id;
    if (type) filter.type = type;
    return paginationUtils.paginate(
      models.ConnectionTransaction.find(filter)
        .sort({ createdAt: -1 })
        .populate('user', 'name email phoneNumber role status')
        .populate('actor', 'name')
        .populate('biodata', 'biodataNo')
        .populate('payment', 'invoiceNo')
        .lean(),
      models.ConnectionTransaction.countDocuments(filter),
      paginationUtils.pageParams(query, { defaultLimit: 25 }),
      (t) => ({
        ...paymentSerializer.toLedgerEntryDTO(t),
        user: userSerializer.toUserSummary(t.user),
        actor: t.actor?.name ?? null,
      }),
    );
  }

  return { changeBalance, creditPayment, unlockContact, myConnections, adjustConnections, listLedger };
})();

// --- services/content.service.js ---------------------------------------------------------------
const contentService = (() => {
  // Public site content (stats, settings, CMS pages, FAQs) and its administration.

  const STATS_TTL_MS = 60_000;
  let statsCache = { at: 0, data: null };

  /** Home page counters, cached for a minute. */
  async function publicStats() {
    if (statsCache.data && Date.now() - statsCache.at < STATS_TTL_MS) return statsCache.data;
    const [byType, marriages, settings] = await Promise.all([
      models.Biodata.aggregate([
        { $match: models.PUBLIC_FILTER },
        { $group: { _id: '$type', n: { $sum: 1 } } },
      ]),
      models.Biodata.countDocuments({ deleteReason: 'married_via_ghotok' }),
      settingsService.getSetting('stats'),
    ]);
    const count = (type) => byType.find((x) => x._id === type)?.n ?? 0;
    const data = {
      show: settings.show !== false,
      biodatas: count('bride') + count('groom'),
      brides: count('bride'),
      grooms: count('groom'),
      marriages: marriages + Number(settings.marriagesOffset ?? 0),
    };
    statsCache = { at: Date.now(), data };
    return data;
  }

  function clearStatsCache() {
    statsCache = { at: 0, data: null };
  }

  /** Settings that are safe to show to anyone. */
  async function publicSettings() {
    const [site, payments] = await Promise.all([
      settingsService.getSetting('site'),
      settingsService.getSetting('payments'),
    ]);
    return {
      site,
      payments: {
        verificationHours: payments.verificationHours,
        approvalGift: payments.approvalGift,
        approvedDiscountPercent: payments.approvedDiscountPercent,
        gateways: Object.keys(paymentGateways.gateways).filter((m) => paymentGateways.gateways[m].enabled),
      },
      // Sign-in options the client should offer (Better Auth handles Google itself).
      auth: { google: !!(envConfig.env.GOOGLE_CLIENT_ID && envConfig.env.GOOGLE_CLIENT_SECRET) },
    };
  }

  async function publishedPage(slug) {
    const page = await models.Page.findOne({ slug: slug.toLowerCase(), isPublished: true }).lean();
    if (!page) throw apiErrorUtils.notFound('Page');
    return { slug: page.slug, title: page.title, body: page.body, updatedAt: page.updatedAt };
  }

  async function activeFaqs() {
    const faqs = await models.Faq.find({ isActive: true }).sort({ sortOrder: 1, createdAt: 1 }).lean();
    return faqs.map((f) => ({ id: f._id, question: f.question, answer: f.answer, category: f.category }));
  }

  // ----- Staff -------------------------------------------------------------------

  const allSettings = () => settingsService.getAllSettings();

  async function updateSettings(key, value, ctx) {
    const saved = await settingsService.setSetting(key, value, ctx.actor._id);
    if (key === 'stats') clearStatsCache();
    await auditService.recordAudit(ctx, 'settings.update', {
      targetType: 'setting',
      targetId: key,
      summary: `Updated ${key} settings`,
    });
    return saved;
  }

  const listPages = () => models.Page.find().sort({ slug: 1 }).lean();

  async function getPage(slug) {
    const page = await models.Page.findOne({ slug }).lean();
    if (!page) throw apiErrorUtils.notFound('Page');
    return page;
  }

  async function upsertPage(slug, data, ctx) {
    const page = await models.Page.findOneAndUpdate(
      { slug },
      { ...data, slug, updatedBy: ctx.actor._id },
      { upsert: true, new: true },
    );
    await auditService.recordAudit(ctx, 'page.update', {
      targetType: 'page',
      targetId: slug,
      summary: `Updated page ${slug}`,
    });
    return page;
  }

  async function deletePage(slug, ctx) {
    const page = await models.Page.findOneAndDelete({ slug });
    if (!page) throw apiErrorUtils.notFound('Page');
    await auditService.recordAudit(ctx, 'page.delete', {
      targetType: 'page',
      targetId: slug,
      summary: `Deleted page ${slug}`,
    });
  }

  const listFaqs = () => models.Faq.find().sort({ sortOrder: 1, createdAt: 1 }).lean();

  async function createFaq(data, ctx) {
    const faq = await models.Faq.create({ category: 'general', sortOrder: 0, isActive: true, ...data });
    await auditService.recordAudit(ctx, 'faq.create', {
      targetType: 'faq',
      targetId: faq._id,
      summary: 'Created FAQ',
    });
    return faq;
  }

  async function updateFaq(id, data) {
    const faq = await models.Faq.findByIdAndUpdate(id, data, { new: true });
    if (!faq) throw apiErrorUtils.notFound('FAQ');
    return faq;
  }

  async function deleteFaq(id, ctx) {
    const faq = await models.Faq.findByIdAndDelete(id);
    if (!faq) throw apiErrorUtils.notFound('FAQ');
    await auditService.recordAudit(ctx, 'faq.delete', {
      targetType: 'faq',
      targetId: faq._id,
      summary: 'Deleted FAQ',
    });
  }

  return {
    publicStats,
    clearStatsCache,
    publicSettings,
    publishedPage,
    activeFaqs,
    allSettings,
    updateSettings,
    listPages,
    getPage,
    upsertPage,
    deletePage,
    listFaqs,
    createFaq,
    updateFaq,
    deleteFaq,
  };
})();

// --- services/credentials.service.js -----------------------------------------------------------
const credentialsService = (() => {
  // Server-side account work that has no Better Auth HTTP endpoint: accounts created by
  // the seed or by an admin, password checks for sensitive actions, staff password
  // resets and signing a user out everywhere. Everything goes through Better Auth's
  // own adapter and password hashing, so these accounts sign in like any other.

  const context = () => authConfig.getAuth().$context;
  const id = (userId) => String(userId);

  /**
   * Creates an email + password account. Better Auth gives every new account the role
   * "user"; `role` is applied afterwards so only server code can create admins.
   * @returns {Promise<import('mongoose').Document>} the Mongoose User
   */
  async function createPasswordAccount({ name, email, phoneNumber, password, role = 'user', verified }) {
    const ctx = await context();
    const created = await ctx.internalAdapter.createUser(
      {
        name,
        email: email.toLowerCase(),
        emailVerified: !!verified,
        ...(phoneNumber ? { phoneNumber, phoneNumberVerified: !!verified } : {}),
      },
      { method: 'admin' },
    );
    await ctx.internalAdapter.createAccount({
      userId: created.id,
      providerId: 'credential',
      accountId: created.id,
      password: await ctx.password.hash(password),
    });
    if (role !== 'user') await models.User.updateOne({ _id: created.id }, { role });
    return models.User.findById(created.id);
  }

  /** True when the account has a password and `password` matches it. */
  async function checkPassword(userId, password) {
    const ctx = await context();
    const account = await ctx.internalAdapter.findCredentialAccount(id(userId));
    if (!account?.password) return false;
    return ctx.password.verify({ hash: account.password, password });
  }

  /** True when the account can sign in with a password (members who only use codes or Google cannot). */
  async function hasPassword(userId) {
    const ctx = await context();
    return !!(await ctx.internalAdapter.findCredentialAccount(id(userId)))?.password;
  }

  /** Sets a new password (adding one to code-only accounts) and signs the user out everywhere. */
  async function setPassword(userId, password) {
    const ctx = await context();
    const hash = await ctx.password.hash(password);
    const account = await ctx.internalAdapter.findCredentialAccount(id(userId));
    if (account) await ctx.internalAdapter.updatePassword(id(userId), hash);
    else
      await ctx.internalAdapter.createAccount({
        userId: id(userId),
        providerId: 'credential',
        accountId: id(userId),
        password: hash,
      });
    await revokeAllSessions(userId);
  }

  async function revokeAllSessions(userId) {
    const ctx = await context();
    await ctx.internalAdapter.deleteUserSessions(id(userId));
  }

  return { createPasswordAccount, checkPassword, hasPassword, setPassword, revokeAllSessions };
})();

// --- services/dashboard.service.js -------------------------------------------------------------
const dashboardService = (() => {
  /** Everything the member dashboard's overview page shows, in one call. */
  async function memberDashboard(user) {
    const uid = user._id;
    const b = await models.Biodata.findOne({ user: uid });
    const [
      visits,
      favoritedBy,
      favorites,
      dislikes,
      unlocks,
      sent,
      received,
      unread,
      openTickets,
      lastPurchase,
      recent,
    ] = await Promise.all([
      b ? visitService.visitStats(b._id) : { today: 0, week: 0, month: 0 },
      b ? models.Favorite.countDocuments({ biodata: b._id }) : 0,
      models.Favorite.countDocuments({ user: uid }),
      models.Dislike.countDocuments({ user: uid }),
      models.ContactUnlock.countDocuments({ user: uid }),
      models.Proposal.countDocuments({ from: uid }),
      models.Proposal.countDocuments({ to: uid }),
      notificationService.countUnread(uid),
      models.SupportTicket.countDocuments({ user: uid, status: { $ne: 'closed' } }),
      models.Payment.findOne({ user: uid, status: 'verified' })
        .sort({ creditedAt: -1 })
        .select('creditedAt')
        .lean(),
      proposalService.recentProposals(uid),
    ]);
    return {
      user: userSerializer.toUserDTO(user),
      biodata: b && {
        biodataNo: b.biodataNo,
        status: b.status,
        isHidden: b.isHidden,
        deletedAt: b.deletedAt,
        completion: b.completion,
        type: b.type,
        district: b.district,
        rejectionReason: b.rejectionReason ?? null,
      },
      connections: {
        balance: user.connectionBalance,
        used: user.connectionsUsed,
        purchased: user.connectionsPurchased,
        lastPurchaseAt: lastPurchase?.creditedAt ?? null,
      },
      stats: { visits, favoritedBy },
      counts: {
        favorites,
        dislikes,
        favoritedMe: favoritedBy,
        unlocks,
        sentProposals: sent,
        receivedProposals: received,
        unreadNotifications: unread,
        openTickets,
      },
      recentProposals: recent,
    };
  }

  return { memberDashboard };
})();

// --- services/list.service.js ------------------------------------------------------------------
const listService = (() => {
  // Personal lists: favorites, dislikes ("not interested"), who favorited me, unlocked contacts.

  const LISTS = {
    favorite: { Model: models.Favorite, other: models.Dislike },
    dislike: { Model: models.Dislike, other: models.Favorite },
  };

  const adjustFavoriteCount = (biodataId, by) =>
    models.Biodata.updateOne({ _id: biodataId }, { $inc: { 'stats.favorites': by } });

  /**
   * Adds a biodata to a list (idempotent). A biodata cannot be in both lists, so
   * adding it to one removes it from the other.
   * @param {'favorite' | 'dislike'} list
   */
  async function addToList(list, user, biodataNo) {
    const { Model, other } = LISTS[list];
    const b = await biodataService.findPublic(biodataNo);
    biodataService.assertNotOwn(b, user);
    const result = await Model.updateOne(
      { user: user._id, biodata: b._id },
      { $setOnInsert: { user: user._id, biodata: b._id } },
      { upsert: true },
    );
    if (!result.upsertedCount) return;
    const removed = await other.deleteOne({ user: user._id, biodata: b._id });
    if (list === 'favorite') {
      await adjustFavoriteCount(b._id, 1);
      await notificationService.notify(
        b.user,
        'favorited',
        { biodataNo: b.biodataNo },
        '/dashboard/favorited-me',
      );
    } else if (removed.deletedCount) {
      await adjustFavoriteCount(b._id, -1);
    }
  }

  /** @param {'favorite' | 'dislike'} list */
  async function removeFromList(list, user, biodataNo) {
    const { Model } = LISTS[list];
    const b = await biodataService.findByNumber(biodataNo);
    const result = await Model.deleteOne({ user: user._id, biodata: b._id });
    if (result.deletedCount && list === 'favorite') await adjustFavoriteCount(b._id, -1);
  }

  /** @param {'favorite' | 'dislike'} list */
  function listEntries(list, user, query) {
    const { Model } = LISTS[list];
    const filter = { user: user._id };
    return paginationUtils.paginate(
      Model.find(filter).sort({ createdAt: -1 }).populate('biodata'),
      Model.countDocuments(filter),
      paginationUtils.pageParams(query, { defaultLimit: 24 }),
      (row) => biodataSerializer.toListEntry(row.biodata, { addedAt: row.createdAt }),
    );
  }

  /** People who favorited my biodata: their biodata when public, otherwise anonymous. */
  async function favoritedMe(user, query) {
    const params = paginationUtils.pageParams(query, { defaultLimit: 24 });
    const mine = await models.Biodata.findOne({ user: user._id }).select('_id');
    if (!mine) return paginationUtils.paged([], 0, params);
    const filter = { biodata: mine._id };
    const [rows, total] = await Promise.all([
      models.Favorite.find(filter).sort({ createdAt: -1 }).skip(params.skip).limit(params.limit).lean(),
      models.Favorite.countDocuments(filter),
    ]);
    const theirs = await models.Biodata.find({ user: { $in: rows.map((r) => r.user) } });
    const byUser = new Map(theirs.map((x) => [x.user.toString(), x]));
    const items = rows.map((r) => {
      const b = byUser.get(r.user.toString());
      return b && biodataSerializer.isPublic(b)
        ? { ...biodataSerializer.toCard(b), addedAt: r.createdAt }
        : { anonymous: true, addedAt: r.createdAt };
    });
    return paginationUtils.paged(items, total, params);
  }

  /** Contacts the member paid for. They stay visible even if the biodata is later hidden. */
  async function unlockedContacts(user, query) {
    const params = paginationUtils.pageParams(query, { defaultLimit: 24 });
    const filter = { user: user._id };
    const [rows, total] = await Promise.all([
      models.ContactUnlock.find(filter)
        .sort({ createdAt: -1 })
        .skip(params.skip)
        .limit(params.limit)
        .populate('biodata'),
      models.ContactUnlock.countDocuments(filter),
    ]);
    const items = rows
      .filter((r) => r.biodata)
      .map((r) => ({
        ...biodataSerializer.toCard(r.biodata),
        unavailable: !biodataSerializer.isPublic(r.biodata),
        unlockedAt: r.createdAt,
        contact: biodataSerializer.toContact(r.biodata),
      }));
    return paginationUtils.paged(items, total, params);
  }

  return { addToList, removeFromList, listEntries, favoritedMe, unlockedContacts };
})();

// --- services/notification.service.js ----------------------------------------------------------
const notificationService = (() => {
  /**
   * Notification types sent by the API. The clients render each type's text in the
   * reader's language from `data` (see web/src/lib/i18n, key notifications.types).
   */
  const NOTIFICATION_TYPES = Object.freeze([
    'proposal_received',
    'proposal_accepted',
    'proposal_declined',
    'biodata_approved',
    'biodata_rejected',
    'payment_verified',
    'payment_rejected',
    'refund_approved',
    'refund_rejected',
    'ticket_replied',
    'restore_approved',
    'restore_declined',
    'connections_adjusted',
    'favorited',
    'contact_unlocked',
    'report_closed',
    'password_reset_by_staff',
    'connections_gift',
    'edit_suspended',
  ]);

  /** Creates an in-app notification. Never throws. */
  async function notify(userId, type, data = {}, link) {
    if (!userId) return;
    try {
      await models.Notification.create({ user: userId, type, data, link });
    } catch (err) {
      loggerConfig.logger.error({ err, type }, 'Notification write failed');
    }
  }

  async function listNotifications(userId, query) {
    const params = paginationUtils.pageParams(query, { defaultLimit: 20 });
    const filter = { user: userId };
    const [items, total, unread] = await Promise.all([
      models.Notification.find(filter).sort({ createdAt: -1 }).skip(params.skip).limit(params.limit).lean(),
      models.Notification.countDocuments(filter),
      models.Notification.countDocuments({ ...filter, readAt: null }),
    ]);
    return { ...paginationUtils.paged(items, total, params), unread };
  }

  function countUnread(userId) {
    return models.Notification.countDocuments({ user: userId, readAt: null });
  }

  async function markAllRead(userId) {
    await models.Notification.updateMany({ user: userId, readAt: null }, { readAt: new Date() });
  }

  async function markRead(userId, id) {
    await models.Notification.updateOne({ _id: id, user: userId }, { readAt: new Date() });
  }

  async function removeNotification(userId, id) {
    await models.Notification.deleteOne({ _id: id, user: userId });
  }

  return {
    NOTIFICATION_TYPES,
    notify,
    listNotifications,
    countUnread,
    markAllRead,
    markRead,
    removeNotification,
  };
})();

// --- services/package.service.js ---------------------------------------------------------------
const packageService = (() => {
  /** Every package (active or not) with its sales figures. */
  async function listPackages() {
    const [items, sold] = await Promise.all([
      models.Package.find().sort({ sortOrder: 1, price: 1 }),
      models.Payment.aggregate([
        { $match: { status: 'verified' } },
        { $group: { _id: '$package', n: { $sum: 1 }, revenue: { $sum: '$amount' } } },
      ]),
    ]);
    const byId = new Map(sold.map((s) => [String(s._id), s]));
    return items.map((p) => ({
      ...paymentSerializer.toPackageDTO(p),
      sold: byId.get(p._id.toString())?.n ?? 0,
      revenue: byId.get(p._id.toString())?.revenue ?? 0,
    }));
  }

  async function createPackage(data, ctx) {
    const pkg = await models.Package.create(data);
    await auditService.recordAudit(ctx, 'package.create', {
      targetType: 'package',
      targetId: pkg._id,
      summary: `Created package ${pkg.name.en}`,
    });
    return paymentSerializer.toPackageDTO(pkg);
  }

  async function updatePackage(id, data, ctx) {
    const pkg = await models.Package.findByIdAndUpdate(id, data, { new: true, runValidators: true });
    if (!pkg) throw apiErrorUtils.notFound('Package');
    await auditService.recordAudit(ctx, 'package.update', {
      targetType: 'package',
      targetId: pkg._id,
      summary: `Updated package ${pkg.name.en}`,
      meta: data,
    });
    return paymentSerializer.toPackageDTO(pkg);
  }

  /** Deletes an unused package; a package with payments is retired instead, so history stays readable. */
  async function removePackage(id, ctx) {
    const pkg = await models.Package.findById(id);
    if (!pkg) throw apiErrorUtils.notFound('Package');
    if (await models.Payment.exists({ package: pkg._id })) {
      pkg.isActive = false;
      await pkg.save();
    } else {
      await pkg.deleteOne();
    }
    await auditService.recordAudit(ctx, 'package.delete', {
      targetType: 'package',
      targetId: pkg._id,
      summary: `Removed package ${pkg.name.en}`,
    });
  }

  return { listPackages, createPackage, updatePackage, removePackage };
})();

// --- services/payment.service.js ---------------------------------------------------------------
const paymentService = (() => {
  // Buying connection packages with bKash, Nagad or Rocket.
  // Manual mode: the customer sends money and submits the transaction ID; staff verify it.
  // Gateway mode: online checkout (bKash Tokenized Checkout / Nagad), credited on the callback.

  const MAX_PENDING_MANUAL = 3;

  /** Payment methods with their manual "Send Money" numbers and whether online checkout is available. */
  async function paymentMethods() {
    const settings = await settingsService.getSetting('payments');
    return {
      verificationHours: settings.verificationHours,
      methods: shared.PAYMENT_METHODS.map((m) => {
        const gateway = !!paymentGateways.gateways[m.value]?.enabled;
        return {
          value: m.value,
          en: m.en,
          bn: m.bn,
          // A gateway-only method (SSLCommerz) is offered only when its gateway is configured.
          enabled: settings[m.value]?.enabled !== false && (!m.gatewayOnly || gateway),
          gatewayOnly: !!m.gatewayOnly,
          manualNumber: m.gatewayOnly ? null : settings[m.value]?.manualNumber || null,
          accountType: settings[m.value]?.accountType ?? 'personal',
          gateway,
        };
      }),
    };
  }

  /** The member's package discount in percent: members whose biodata is live may get one (site setting). */
  async function discountFor(user) {
    if (!user) return 0;
    const { approvedDiscountPercent = 0 } = await settingsService.getSetting('payments');
    if (approvedDiscountPercent <= 0) return 0;
    const approved = await models.Biodata.exists({ user: user._id, status: 'approved', deletedAt: null });
    return approved ? Math.min(90, approvedDiscountPercent) : 0;
  }

  const discounted = (price, percent) => Math.round(price * (1 - percent / 100));

  /** Active packages and payment methods; for a member with a discount, the price they pay. */
  async function catalogue(user) {
    const [packages, discount] = await Promise.all([
      models.Package.find({ isActive: true }).sort({ sortOrder: 1, price: 1 }),
      discountFor(user),
    ]);
    return {
      packages: packages.map((p) => ({
        ...paymentSerializer.toPackageDTO(p),
        ...(discount ? { discountPercent: discount, finalPrice: discounted(p.price, discount) } : {}),
      })),
      ...(await paymentMethods()),
    };
  }

  async function nextInvoiceNo() {
    const d = new Date();
    const ymd = d.toISOString().slice(2, 10).replace(/-/g, '');
    return `INV-${ymd}-${await models.nextSequence('invoice', 10000)}`;
  }

  /**
   * Starts a purchase.
   * @returns {Promise<{ payment: object, redirectURL?: string }>} redirectURL for gateway checkout
   */
  async function createPayment(user, { packageId, method, mode, senderNumber, trxId }, { ip } = {}) {
    const pkg = await models.Package.findOne({ _id: packageId, isActive: true });
    if (!pkg) throw apiErrorUtils.notFound('Package');
    const { methods } = await paymentMethods();
    const chosen = methods.find((m) => m.value === method);
    if (!chosen?.enabled || (chosen.gatewayOnly && mode !== 'gateway')) {
      throw apiErrorUtils.badRequest('METHOD_DISABLED', 'This payment method is not available right now.');
    }
    const discount = await discountFor(user);
    const base = {
      user: user._id,
      package: pkg._id,
      packageName: pkg.name,
      connections: pkg.connections,
      amount: discounted(pkg.price, discount),
      method,
      invoiceNo: await nextInvoiceNo(),
    };
    return mode === 'gateway'
      ? startGatewayCheckout(base, { ip, user })
      : submitManualPayment(user, base, { senderNumber, trxId });
  }

  async function startGatewayCheckout(base, { ip, user }) {
    const gateway = paymentGateways.gatewayFor(base.method);
    if (!gateway) {
      throw apiErrorUtils.badRequest(
        'GATEWAY_UNAVAILABLE',
        'Online checkout is not available for this method. Please use Send Money.',
      );
    }
    const payment = await models.Payment.create({ ...base, mode: 'gateway', status: 'initiated' });
    try {
      const started = await gateway.startCheckout(payment, {
        callbackURL: `${envConfig.env.API_PUBLIC_URL}/api/payments/${base.method}/callback`,
        // Gateways that post the result back (SSLCommerz) use these instead.
        returnURL: `${envConfig.env.API_PUBLIC_URL}/api/gateway/${base.method}/return`,
        ipnURL: `${envConfig.env.API_PUBLIC_URL}/api/gateway/${base.method}/ipn`,
        customer: { name: user.name, email: userSerializer.contactEmail(user), phone: user.phoneNumber },
        ip,
      });
      payment.gateway = { paymentId: started.paymentId, response: started.raw };
      await payment.save();
      return { payment: paymentSerializer.toPaymentDTO(payment), redirectURL: started.redirectURL };
    } catch (err) {
      loggerConfig.logger.error({ err, invoice: payment.invoiceNo }, 'Gateway checkout failed to start');
      payment.status = 'failed';
      await payment.save();
      throw new apiErrorUtils.ApiError(
        502,
        'GATEWAY_ERROR',
        'The payment gateway is not responding. Please try again or use Send Money.',
      );
    }
  }

  async function submitManualPayment(user, base, { senderNumber, trxId }) {
    if (
      await models.Payment.exists({
        method: base.method,
        trxId,
        status: { $in: ['pending', 'verified', 'refunded'] },
      })
    ) {
      throw apiErrorUtils.conflict('DUPLICATE_TRX', 'This transaction ID has already been submitted.');
    }
    const pending = await models.Payment.countDocuments({
      user: user._id,
      mode: 'manual',
      status: 'pending',
    });
    if (pending >= MAX_PENDING_MANUAL) {
      throw new apiErrorUtils.ApiError(
        429,
        'TOO_MANY_PENDING',
        `You already have ${MAX_PENDING_MANUAL} payments waiting for verification.`,
      );
    }
    const payment = await models.Payment.create({
      ...base,
      mode: 'manual',
      status: 'pending',
      senderNumber,
      trxId,
    });
    return { payment: paymentSerializer.toPaymentDTO(payment) };
  }

  /**
   * Handles the customer's return from bKash/Nagad. The gateway's own status API is
   * authoritative; the amount must match before connections are credited.
   * @returns {Promise<{ status: 'success' | 'failed' | 'cancelled', invoiceNo?: string }>}
   */
  async function completeGatewayCheckout(method, query) {
    const gateway = paymentGateways.gatewayFor(method);
    if (!gateway) return { status: 'failed' };
    let result;
    try {
      result = await gateway.completeCheckout(query);
    } catch (err) {
      loggerConfig.logger.error({ err, method }, 'Gateway callback failed');
      return { status: 'failed' };
    }
    const payment = result.paymentId
      ? await models.Payment.findOne({ 'gateway.paymentId': result.paymentId, method })
      : null;
    if (!payment) return { status: 'failed' };
    if (payment.status === 'verified') return { status: 'success', invoiceNo: payment.invoiceNo };

    const amountMatches = result.amount === undefined || Math.abs(result.amount - payment.amount) < 0.01;
    if (result.success && amountMatches) {
      await connectionService.creditPayment(payment._id, {
        trxId: result.trxId,
        gatewayResponse: result.raw,
      });
      return { status: 'success', invoiceNo: payment.invoiceNo };
    }
    const status = result.cancelled ? 'cancelled' : 'failed';
    await models.Payment.updateOne(
      { _id: payment._id, status: 'initiated' },
      { status, 'gateway.response': result.raw },
    );
    return { status, invoiceNo: payment.invoiceNo };
  }

  /** One of the member's payments by invoice number, for the receipt page. */
  async function paymentStatus(user, invoiceNo) {
    const payment = await models.Payment.findOne({ user: user._id, invoiceNo });
    if (!payment) throw apiErrorUtils.notFound('Payment');
    return paymentSerializer.toPaymentDTO(payment);
  }

  /** A member's payments, each with its latest refund request. */
  async function myPayments(user, query) {
    const params = paginationUtils.pageParams(query, { defaultLimit: 20 });
    const filter = { user: user._id, status: { $ne: 'initiated' } };
    const [items, total] = await Promise.all([
      models.Payment.find(filter).sort({ createdAt: -1 }).skip(params.skip).limit(params.limit),
      models.Payment.countDocuments(filter),
    ]);
    const refunds = await models.RefundRequest.find({ payment: { $in: items.map((i) => i._id) } })
      .sort({ createdAt: -1 })
      .lean();
    const refundOf = new Map();
    for (const r of refunds) {
      const key = r.payment.toString();
      if (!refundOf.has(key))
        refundOf.set(key, { id: r._id, status: r.status, resolution: r.resolution ?? null });
    }
    return paginationUtils.paged(
      items.map((p) => ({
        ...paymentSerializer.toPaymentDTO(p),
        refund: refundOf.get(p._id.toString()) ?? null,
      })),
      total,
      params,
    );
  }

  // ----- Staff -------------------------------------------------------------------

  function listPayments({ status, method, mode, q }, query) {
    const filter = { status: status ?? { $ne: 'initiated' } };
    if (method) filter.method = method;
    if (mode) filter.mode = mode;
    if (q) {
      const re = new RegExp(stringsUtils.escapeRegex(q), 'i');
      filter.$or = [{ invoiceNo: re }, { trxId: re }, { senderNumber: re }];
    }
    return paginationUtils.paginate(
      models.Payment.find(filter)
        .sort({ createdAt: status === 'pending' ? 1 : -1 })
        .populate('user', 'name email phoneNumber role status')
        .populate('reviewedBy', 'name'),
      models.Payment.countDocuments(filter),
      paginationUtils.pageParams(query, { defaultLimit: 20 }),
      (p) => ({
        ...paymentSerializer.toPaymentDTO(p),
        user: userSerializer.toUserSummary(p.user),
        reviewedBy: p.reviewedBy?.name ?? null,
        reviewedAt: p.reviewedAt ?? null,
      }),
    );
  }

  async function verifyPayment(id, ctx) {
    const payment = await connectionService.creditPayment(id, { actor: ctx.actor._id });
    if (!payment) throw apiErrorUtils.conflict('NOT_PENDING', 'This payment has already been processed.');
    await auditService.recordAudit(ctx, 'payment.verify', {
      targetType: 'payment',
      targetId: payment._id,
      summary: `Verified ${payment.invoiceNo} (${payment.method} ${payment.trxId ?? ''}) +${payment.connections}`,
    });
    return paymentSerializer.toPaymentDTO(payment);
  }

  async function rejectPayment(id, reason, ctx) {
    const payment = await models.Payment.findOneAndUpdate(
      { _id: id, status: 'pending' },
      { status: 'rejected', rejectReason: reason, reviewedBy: ctx.actor._id, reviewedAt: new Date() },
      { new: true },
    );
    if (!payment) throw apiErrorUtils.conflict('NOT_PENDING', 'This payment has already been processed.');
    await notificationService.notify(
      payment.user,
      'payment_rejected',
      { invoiceNo: payment.invoiceNo, reason },
      '/dashboard/connections',
    );
    await auditService.recordAudit(ctx, 'payment.reject', {
      targetType: 'payment',
      targetId: payment._id,
      summary: `Rejected ${payment.invoiceNo}`,
      meta: { reason },
    });
    return paymentSerializer.toPaymentDTO(payment);
  }

  return {
    paymentMethods,
    discountFor,
    catalogue,
    createPayment,
    completeGatewayCheckout,
    paymentStatus,
    myPayments,
    listPayments,
    verifyPayment,
    rejectPayment,
  };
})();

// --- services/proposal.service.js --------------------------------------------------------------
const proposalService = (() => {
  const DAILY_LIMIT = 20;

  /** Sends a proposal to the owner of a public biodata. */
  async function sendProposal(user, biodataNo, message) {
    const b = await biodataService.findPublic(biodataNo);
    biodataService.assertNotOwn(b, user, 'You cannot send a proposal to your own biodata.');
    if (
      await models.Proposal.exists({
        from: user._id,
        toBiodata: b._id,
        status: { $in: ['pending', 'accepted'] },
      })
    ) {
      throw apiErrorUtils.conflict('PROPOSAL_EXISTS', 'You have already sent a proposal to this biodata.');
    }
    const sentToday = await models.Proposal.countDocuments({
      from: user._id,
      createdAt: { $gte: new Date(Date.now() - 864e5) },
    });
    if (sentToday >= DAILY_LIMIT) {
      throw new apiErrorUtils.ApiError(
        429,
        'PROPOSAL_LIMIT',
        `You can send up to ${DAILY_LIMIT} proposals a day.`,
      );
    }
    const mine = await models.Biodata.findOne({ user: user._id, deletedAt: null }).select('_id biodataNo');
    const proposal = await models.Proposal.create({
      from: user._id,
      fromBiodata: mine?._id,
      to: b.user,
      toBiodata: b._id,
      message,
    });
    await notificationService.notify(
      b.user,
      'proposal_received',
      { fromBiodataNo: mine?.biodataNo ?? null },
      '/dashboard/proposals?box=received',
    );
    return { id: proposal._id, status: proposal.status, direction: 'sent' };
  }

  /** @param {'sent' | 'received'} box */
  function listProposals(user, { box, status }, query) {
    const filter = box === 'sent' ? { from: user._id } : { to: user._id };
    if (status) filter.status = status;
    return paginationUtils.paginate(
      models.Proposal.find(filter).sort({ createdAt: -1 }).populate('fromBiodata toBiodata'),
      models.Proposal.countDocuments(filter),
      paginationUtils.pageParams(query, { defaultLimit: 20 }),
      (p) => ({
        id: p._id,
        status: p.status,
        message: p.message ?? null,
        responseNote: p.responseNote ?? null,
        createdAt: p.createdAt,
        respondedAt: p.respondedAt ?? null,
        biodata:
          box === 'sent'
            ? biodataSerializer.toListEntry(p.toBiodata)
            : p.fromBiodata
              ? biodataSerializer.toListEntry(p.fromBiodata)
              : null,
      }),
    );
  }

  /** The receiver accepts or declines a pending proposal. */
  async function respondToProposal(user, id, { action, note }) {
    const status = action === 'accept' ? 'accepted' : 'declined';
    const p = await models.Proposal.findOneAndUpdate(
      { _id: id, to: user._id, status: 'pending' },
      { status, respondedAt: new Date(), responseNote: note },
      { new: true },
    ).populate('toBiodata', 'biodataNo');
    if (!p) throw apiErrorUtils.notFound('Proposal');
    await notificationService.notify(
      p.from,
      `proposal_${status}`,
      { biodataNo: p.toBiodata?.biodataNo },
      '/dashboard/proposals?box=sent',
    );
    return { id: p._id, status: p.status };
  }

  async function withdrawProposal(user, id) {
    const p = await models.Proposal.findOneAndUpdate(
      { _id: id, from: user._id, status: 'pending' },
      { status: 'withdrawn' },
      { new: true },
    );
    if (!p) throw apiErrorUtils.conflict('NOT_PENDING', 'Only pending proposals can be withdrawn.');
    return { id: p._id, status: p.status };
  }

  /** The 5 latest proposals in either direction, for the dashboard. */
  async function recentProposals(userId) {
    const rows = await models.Proposal.find({ $or: [{ from: userId }, { to: userId }] })
      .sort({ createdAt: -1 })
      .limit(5)
      .populate('fromBiodata toBiodata', 'biodataNo')
      .lean();
    return rows.map((p) => {
      const outgoing = p.from.equals(userId);
      return {
        id: p._id,
        direction: outgoing ? 'sent' : 'received',
        status: p.status,
        createdAt: p.createdAt,
        biodataNo: outgoing ? p.toBiodata?.biodataNo : (p.fromBiodata?.biodataNo ?? null),
      };
    });
  }

  return { sendProposal, listProposals, respondToProposal, withdrawProposal, recentProposals };
})();

// --- services/refund.service.js ----------------------------------------------------------------
const refundService = (() => {
  // Refunds have two resolutions:
  // - connection_credit: connections are added (e.g. a payment that could not be verified)
  // - money_back: money is returned outside the system and the purchased, still unused
  //   connections are taken back; the payment becomes "refunded".

  const REFUNDABLE = ['verified', 'rejected', 'pending'];

  async function requestRefund(user, { paymentId, reason }) {
    const payment = await models.Payment.findOne({ _id: paymentId, user: user._id });
    if (!payment) throw apiErrorUtils.notFound('Payment');
    if (!REFUNDABLE.includes(payment.status))
      throw apiErrorUtils.conflict('NOT_REFUNDABLE', 'This payment cannot be refunded.');
    if (await models.RefundRequest.exists({ payment: payment._id, status: 'pending' })) {
      throw apiErrorUtils.conflict(
        'ALREADY_REQUESTED',
        'A refund request for this payment is already pending.',
      );
    }
    const refund = await models.RefundRequest.create({ user: user._id, payment: payment._id, reason });
    return { id: refund._id, status: refund.status };
  }

  function myRefunds(user) {
    return models.RefundRequest.find({ user: user._id })
      .sort({ createdAt: -1 })
      .limit(50)
      .populate('payment', 'invoiceNo amount method')
      .lean();
  }

  function listRefunds({ status }, query) {
    const filter = status ? { status } : {};
    return paginationUtils.paginate(
      models.RefundRequest.find(filter)
        .sort({ createdAt: status === 'pending' ? 1 : -1 })
        .populate('user', 'name email phoneNumber role status connectionBalance')
        .populate('payment')
        .populate('decidedBy', 'name'),
      models.RefundRequest.countDocuments(filter),
      paginationUtils.pageParams(query, { defaultLimit: 20 }),
      (r) => ({
        id: r._id,
        status: r.status,
        reason: r.reason,
        resolution: r.resolution ?? null,
        connections: r.connections ?? null,
        amount: r.amount ?? null,
        refundTrxId: r.refundTrxId ?? null,
        note: r.note ?? null,
        createdAt: r.createdAt,
        decidedAt: r.decidedAt ?? null,
        decidedBy: r.decidedBy?.name ?? null,
        user: r.user
          ? { ...userSerializer.toUserSummary(r.user), connectionBalance: r.user.connectionBalance }
          : null,
        payment: r.payment ? paymentSerializer.toPaymentDTO(r.payment) : null,
      }),
    );
  }

  async function approveRefund(id, { resolution, connections, amount, refundTrxId, note }, ctx) {
    // Claim the request first so two admins cannot approve it twice.
    const refund = await models.RefundRequest.findOneAndUpdate(
      { _id: id, status: 'pending' },
      { status: 'approved', decidedBy: ctx.actor._id, decidedAt: new Date() },
      { new: true },
    );
    if (!refund) throw apiErrorUtils.conflict('NOT_PENDING', 'This refund request has already been decided.');
    const payment = await models.Payment.findById(refund.payment);
    const ledger = { payment: payment._id, refund: refund._id, actor: ctx.actor._id };
    try {
      if (resolution === 'connection_credit') {
        const qty = connections ?? payment.connections;
        if (qty > 0)
          await connectionService.changeBalance(refund.user, qty, {
            ...ledger,
            type: 'refund_credit',
            reason: note ?? `Refund credit for ${payment.invoiceNo}`,
          });
        Object.assign(refund, { resolution, connections: qty, note });
      } else {
        const qty = connections ?? (payment.status === 'verified' ? payment.connections : 0);
        let revoked = 0;
        if (qty > 0) {
          const r = await connectionService.changeBalance(refund.user, -qty, {
            ...ledger,
            type: 'refund_revoke',
            reason: note ?? `Refund of ${payment.invoiceNo}`,
            clamp: true,
          });
          revoked = -r.applied;
        }
        payment.status = 'refunded';
        payment.refundedAt = new Date();
        await payment.save();
        Object.assign(refund, {
          resolution,
          connections: revoked,
          amount: amount ?? payment.amount,
          refundTrxId,
          note,
        });
      }
      await refund.save();
    } catch (err) {
      await models.RefundRequest.updateOne(
        { _id: refund._id },
        { status: 'pending', $unset: { decidedBy: 1, decidedAt: 1 } },
      );
      throw err;
    }
    await notificationService.notify(
      refund.user,
      'refund_approved',
      { invoiceNo: payment.invoiceNo, resolution, connections: refund.connections, amount: refund.amount },
      '/dashboard/connections',
    );
    await auditService.recordAudit(ctx, 'refund.approve', {
      targetType: 'refund',
      targetId: refund._id,
      summary: `Refund for ${payment.invoiceNo}: ${resolution}`,
      meta: { resolution, connections, amount, refundTrxId, note },
    });
  }

  async function rejectRefund(id, note, ctx) {
    const refund = await models.RefundRequest.findOneAndUpdate(
      { _id: id, status: 'pending' },
      { status: 'rejected', note, decidedBy: ctx.actor._id, decidedAt: new Date() },
      { new: true },
    ).populate('payment', 'invoiceNo');
    if (!refund) throw apiErrorUtils.conflict('NOT_PENDING', 'This refund request has already been decided.');
    await notificationService.notify(
      refund.user,
      'refund_rejected',
      { invoiceNo: refund.payment?.invoiceNo, note },
      '/dashboard/connections',
    );
    await auditService.recordAudit(ctx, 'refund.reject', {
      targetType: 'refund',
      targetId: refund._id,
      summary: `Rejected refund for ${refund.payment?.invoiceNo}`,
    });
  }

  return { requestRefund, myRefunds, listRefunds, approveRefund, rejectRefund };
})();

// --- services/report.service.js ----------------------------------------------------------------
const reportService = (() => {
  const ACTIVE = ['open', 'in_review'];

  /**
   * A member reports a biodata (and its owner). One active report per member per
   * biodata. Each report opens a support conversation, so staff can ask for details
   * and the member sees the outcome in the same thread.
   */
  async function reportBiodata(user, biodataNo, { reason, details, attachments }) {
    const b = await biodataService.findByNumber(biodataNo);
    const existing = await models.Report.findOne({
      reporter: user._id,
      biodata: b._id,
      status: { $in: ACTIVE },
    });
    if (existing) {
      throw apiErrorUtils.conflict(
        'ALREADY_REPORTED',
        'You have already reported this biodata. Our team is looking into it.',
        {
          ticketId: existing.ticket?.toString() ?? null,
        },
      );
    }
    const report = await models.Report.create({
      reporter: user._id,
      biodata: b._id,
      targetUser: b.user,
      reason,
      details,
    });
    const reasonText = shared.optionLabel(shared.REPORT_REASONS, reason, 'en');
    const ticket = await ticketService.openTicket(
      user,
      {
        subject: `Report about ${b.biodataNo}: ${reasonText}`.slice(0, 160),
        category: 'report',
        message: details || reasonText,
        attachments,
      },
      { report: report._id, biodata: b._id },
    );
    report.ticket = ticket.id;
    await report.save();
    return { id: report._id, status: report.status, ticketId: ticket.id };
  }

  /** Staff: reports, newest first, with how often each target has been reported. */
  async function listReports({ status }, query) {
    const filter = {};
    if (status === 'active') filter.status = { $in: ACTIVE };
    else if (status) filter.status = status;
    const params = paginationUtils.pageParams(query, { defaultLimit: 20 });
    const [items, total] = await Promise.all([
      models.Report.find(filter)
        .sort({ createdAt: -1 })
        .skip(params.skip)
        .limit(params.limit)
        .populate('reporter', 'name email phoneNumber role status')
        .populate('targetUser', 'name email phoneNumber role status')
        .populate('biodata')
        .populate('handledBy', 'name'),
      models.Report.countDocuments(filter),
    ]);
    const counts = await models.Report.aggregate([
      { $match: { targetUser: { $in: items.map((r) => r.targetUser?._id).filter(Boolean) } } },
      { $group: { _id: '$targetUser', n: { $sum: 1 } } },
    ]);
    const countOf = new Map(counts.map((c) => [c._id.toString(), c.n]));
    // Whether each reporter paid to unlock the biodata they reported (a refund is then possible).
    const pairs = items
      .filter((r) => r.biodata && r.reporter)
      .map((r) => ({ user: r.reporter._id, biodata: r.biodata._id }));
    const unlocks = pairs.length
      ? await models.ContactUnlock.find({ $or: pairs }).select('user biodata').lean()
      : [];
    const unlocked = new Set(unlocks.map((u) => `${u.user}:${u.biodata}`));
    return paginationUtils.paged(
      items.map((r) => ({
        id: r._id,
        reason: r.reason,
        details: r.details ?? null,
        status: r.status,
        actionTaken: r.actionTaken ?? null,
        ticketId: r.ticket?.toString() ?? null,
        connectionRefunded: !!r.connectionRefunded,
        reporterUnlocked: unlocked.has(`${r.reporter?._id}:${r.biodata?._id}`),
        createdAt: r.createdAt,
        handledAt: r.handledAt ?? null,
        handledBy: r.handledBy?.name ?? null,
        reporter: userSerializer.toUserSummary(r.reporter),
        targetUser: userSerializer.toUserSummary(r.targetUser),
        timesReported: r.targetUser ? (countOf.get(r.targetUser._id.toString()) ?? 1) : 1,
        biodata: r.biodata ? biodataSerializer.toAdminRow(r.biodata) : null,
      })),
      total,
      params,
    );
  }

  /** Staff: move a report through open → in_review → resolved | dismissed. */
  /**
   * Moves a report through review. Closing it (resolved or dismissed) notifies the
   * reporter and posts the outcome in the report's conversation. When an upheld
   * report is about a contact the reporter paid to unlock, `refundConnection`
   * returns that connection (once).
   */
  async function updateReport(id, { status, actionTaken, refundConnection }, ctx) {
    const closing = status === 'resolved' || status === 'dismissed';
    const r = await models.Report.findById(id).populate('biodata', 'biodataNo');
    if (!r) throw apiErrorUtils.notFound('Report');
    Object.assign(r, {
      status,
      actionTaken,
      ...(closing ? { handledBy: ctx.actor._id, handledAt: new Date() } : {}),
    });

    if (refundConnection && status === 'resolved' && !r.connectionRefunded) {
      const unlock = await models.ContactUnlock.findOneAndUpdate(
        { user: r.reporter, biodata: r.biodata?._id, refundedAt: null },
        { refundedAt: new Date() },
      );
      if (!unlock)
        throw apiErrorUtils.conflict(
          'NOTHING_TO_REFUND',
          'The reporter did not spend a connection on this biodata.',
        );
      await connectionService.changeBalance(r.reporter, 1, {
        type: 'report_refund',
        biodata: r.biodata?._id,
        actor: ctx.actor._id,
        reason: `Report about ${r.biodata?.biodataNo} upheld`,
      });
      r.connectionRefunded = true;
    }
    await r.save();

    if (closing) {
      await notificationService.notify(r.reporter, 'report_closed', {
        biodataNo: r.biodata?.biodataNo,
        status,
        refunded: r.connectionRefunded,
      });
      if (r.ticket) {
        const outcome = [
          status === 'resolved' ? 'Your report was upheld.' : 'Your report was reviewed and closed.',
          actionTaken,
        ]
          .concat(r.connectionRefunded ? ['The connection you used has been returned to your balance.'] : [])
          .filter(Boolean)
          .join('\n\n');
        const now = new Date();
        await models.SupportTicket.updateOne(
          { _id: r.ticket },
          {
            $push: { messages: { author: ctx.actor._id, staff: true, body: outcome } },
            status: 'closed',
            closedAt: now,
            lastMessageAt: now,
            lastStaffMessageAt: now,
          },
        );
      }
    }
    await auditService.recordAudit(ctx, 'report.update', {
      targetType: 'report',
      targetId: r._id,
      summary: `Report on ${r.biodata?.biodataNo ?? 'user'} → ${status}${r.connectionRefunded ? ' (connection refunded)' : ''}`,
      meta: { status, actionTaken },
    });
  }

  return { reportBiodata, listReports, updateReport };
})();

// --- services/search.service.js ----------------------------------------------------------------
const searchService = (() => {
  // Public biodata search. Every filter maps to an indexed, denormalised field on
  // the Biodata model (see biodata.model.js, "Denormalised search fields").

  const LIST_FILTERS = {
    religion: 'religion',
    marital: 'maritalStatus',
    complexion: 'complexion',
    profession: 'profession',
    economic: 'economicStatus',
    division: 'division',
    district: 'district',
    upazila: 'upazila',
    presentDistrict: 'presentDistrict',
    presentUpazila: 'presentUpazila',
    medium: 'educationMedium',
    category: 'specialCategories',
  };

  const SORTS = {
    newest: { approvedAt: -1, _id: -1 },
    oldest: { approvedAt: 1, _id: 1 },
    age_asc: { birthDate: -1, _id: -1 },
    age_desc: { birthDate: 1, _id: -1 },
  };

  const yearsAgo = (years) => {
    const d = new Date();
    d.setUTCFullYear(d.getUTCFullYear() - years);
    return d;
  };

  const int = (v) => Number.parseInt(v, 10) || 0;

  /** Builds the MongoDB filter for a search query. Exported for tests. */
  function buildSearchFilter(q) {
    const filter = { ...models.PUBLIC_FILTER };
    if (q.type === 'bride' || q.type === 'groom') filter.type = q.type;
    for (const [param, field] of Object.entries(LIST_FILTERS)) {
      const values = stringsUtils.csv(q[param]).slice(0, 100);
      if (values.length) filter[field] = { $in: values };
    }
    // Age is stored as a birth date, so an age range becomes a birth-date range.
    const ageMin = int(q.ageMin);
    const ageMax = int(q.ageMax);
    if (ageMin || ageMax) {
      filter.birthDate = {};
      if (ageMin) filter.birthDate.$lte = yearsAgo(ageMin);
      if (ageMax) filter.birthDate.$gt = yearsAgo(ageMax + 1);
    }
    const heightMin = int(q.heightMin);
    const heightMax = int(q.heightMax);
    if (heightMin || heightMax) {
      filter.heightIn = {};
      if (heightMin) filter.heightIn.$gte = heightMin;
      if (heightMax) filter.heightIn.$lte = heightMax;
    }
    if (q.education) {
      const rank = shared.EDUCATION_LEVELS.findIndex((e) => e.value === q.education);
      if (rank >= 0) filter.educationRank = { $gte: rank };
    }
    if (q.q) {
      const digits = String(q.q).replace(/\D/g, '').slice(0, 10);
      if (digits) filter.biodataNo = new RegExp(`^GH-${stringsUtils.escapeRegex(digits)}`, 'i');
    }
    return filter;
  }

  /** The viewer's own exclusions: their biodata and the ones they marked "not interested". */
  async function viewerExclusions(filter, viewer) {
    if (!viewer) return;
    filter._id = { $nin: await models.Dislike.find({ user: viewer._id }).distinct('biodata') };
    filter.user = { $ne: viewer._id };
  }

  /**
   * Searches public biodatas. Signed-in members never see their own biodata or
   * biodatas they marked "not interested". `viewerKey` (member or anonymous visitor,
   * see visit.service.js) marks the results this viewer has already opened.
   */
  async function searchBiodatas(query, viewer, viewerKey) {
    const filter = buildSearchFilter(query);
    await viewerExclusions(filter, viewer);
    const params = paginationUtils.pageParams(query, { defaultLimit: 12, maxLimit: 48 });
    const sort = SORTS[query.sort] ?? SORTS.newest;
    const result = await paginationUtils.paginate(
      models.Biodata.find(filter).sort(sort),
      models.Biodata.countDocuments(filter),
      params,
      (b) => biodataSerializer.toCard(b),
    );
    if (viewerKey && result.items.length) {
      const seen = new Set(
        (
          await models.ProfileVisit.find({
            viewerKey,
            biodata: { $in: result.items.map((b) => b.id) },
          }).distinct('biodata')
        ).map(String),
      );
      for (const item of result.items) item.seen = seen.has(item.id);
    }
    if (viewer && result.items.length) {
      const shortlisted = new Set(
        (
          await models.Favorite.find({
            user: viewer._id,
            biodata: { $in: result.items.map((b) => b.id) },
          }).distinct('biodata')
        ).map(String),
      );
      for (const item of result.items) item.favorited = shortlisted.has(item.id);
    }
    return result;
  }

  /**
   * How many public biodatas match the other filters in each place, for the location
   * picker: `{ divisions: {dhaka: 12}, districts: {...}, upazilas: {...} }`.
   * `scope` is "permanent" (default) or "present".
   */
  async function locationCounts(query, viewer) {
    const present = query.scope === 'present';
    const fields = present
      ? { district: 'presentDistrict', upazila: 'presentUpazila' }
      : { district: 'district', upazila: 'upazila' };
    // Count with every filter except the location being picked.
    const {
      division: _d,
      district: _di,
      upazila: _u,
      presentDistrict: _pd,
      presentUpazila: _pu,
      ...rest
    } = query;
    const filter = buildSearchFilter(rest);
    await viewerExclusions(filter, viewer);
    const group = (field) =>
      models.Biodata.aggregate([
        { $match: { ...filter, [field]: { $ne: null } } },
        { $group: { _id: `$${field}`, n: { $sum: 1 } } },
      ]);
    const [divisions, districts, upazilas] = await Promise.all([
      present ? Promise.resolve([]) : group('division'),
      group(fields.district),
      group(fields.upazila),
    ]);
    const asMap = (rows) => Object.fromEntries(rows.map((r) => [r._id, r.n]));
    return {
      scope: present ? 'present' : 'permanent',
      divisions: asMap(divisions),
      districts: asMap(districts),
      upazilas: asMap(upazilas),
    };
  }

  /** The most recently approved biodatas, for the home page. */
  async function featuredBiodatas(limit = 4) {
    const items = await models.Biodata.find(models.PUBLIC_FILTER)
      .sort({ approvedAt: -1 })
      .limit(Math.min(12, limit));
    return items.map((b) => biodataSerializer.toCard(b));
  }

  return { buildSearchFilter, searchBiodatas, locationCounts, featuredBiodatas };
})();

// --- services/settings.service.js --------------------------------------------------------------
const settingsService = (() => {
  const DEFAULT_SETTINGS = {
    site: {
      name: 'Ghotok',
      tagline: {
        en: 'A modern, secure matchmaking platform for every faith in Bangladesh.',
        bn: 'বাংলাদেশের সব ধর্মের মানুষের জন্য আধুনিক ও নিরাপদ ঘটক প্ল্যাটফর্ম।',
      },
      supportEmail: 'support@ghotok.com.bd',
      supportPhone: '',
      address: '',
      facebook: '',
      youtube: '',
      instagram: '',
      whatsapp: '',
      // Link to the Android app, shown in the footer and the dashboard when set.
      appUrl: '',
      // YouTube links of short how-to videos, shown next to the matching steps.
      tutorials: { createBiodata: '', buyConnections: '', viewContact: '' },
    },
    payments: {
      verificationHours: 6,
      // Connections given once, when a member's biodata is approved for the first time.
      approvalGift: 1,
      // Discount (%) on packages for members whose biodata is approved. 0 turns it off.
      approvedDiscountPercent: 0,
      bkash: { enabled: true, manualNumber: '', accountType: 'personal' },
      nagad: { enabled: true, manualNumber: '', accountType: 'personal' },
      rocket: { enabled: true, manualNumber: '', accountType: 'personal' },
    },
    stats: { marriagesOffset: 0, show: true },
  };

  const isObject = (v) => v && typeof v === 'object' && !Array.isArray(v);

  function deepMerge(base, extra) {
    if (!isObject(base) || !isObject(extra)) return extra === undefined ? base : extra;
    const out = { ...base };
    for (const [k, v] of Object.entries(extra)) out[k] = isObject(base[k]) ? deepMerge(base[k], v) : v;
    return out;
  }

  async function getSetting(key) {
    const doc = await models.Setting.findOne({ key }).lean();
    return deepMerge(DEFAULT_SETTINGS[key] ?? {}, doc?.value ?? {});
  }

  async function getAllSettings() {
    const docs = await models.Setting.find({ key: { $in: Object.keys(DEFAULT_SETTINGS) } }).lean();
    const stored = Object.fromEntries(docs.map((d) => [d.key, d.value]));
    return Object.fromEntries(
      Object.keys(DEFAULT_SETTINGS).map((k) => [k, deepMerge(DEFAULT_SETTINGS[k], stored[k] ?? {})]),
    );
  }

  async function setSetting(key, value, userId) {
    const merged = deepMerge(DEFAULT_SETTINGS[key] ?? {}, value);
    await models.Setting.findOneAndUpdate({ key }, { value: merged, updatedBy: userId }, { upsert: true });
    return merged;
  }

  return { DEFAULT_SETTINGS, getSetting, getAllSettings, setSetting };
})();

// --- services/story.service.js -----------------------------------------------------------------
const storyService = (() => {
  // "We got married" reports and the success stories published from them.

  const monthOf = (d) => (d ? new Date(d).toISOString().slice(0, 7) : null);

  /** Published stories for the home page. No names: the couple's districts and the month only. */
  async function publishedStories(limit = 8) {
    const items = await models.MarriageReport.find({ storyStatus: 'published' })
      .sort({ publishedAt: -1 })
      .limit(Math.min(20, limit))
      .populate('biodata', 'type district')
      .populate('partnerBiodata', 'type district')
      .lean();
    return items.map((r) => ({
      id: r._id,
      story: r.publishedStory || r.story,
      marriedOn: monthOf(r.marriedOn),
      viaGhotok: r.viaGhotok,
      districts: [r.biodata?.district, r.partnerBiodata?.district ?? r.partner?.district]
        .filter((d) => shared.DISTRICTS.some((x) => x.value === d))
        .filter((d, i, all) => all.indexOf(d) === i),
    }));
  }

  /** Staff: every report, newest first, optionally by story status. */
  function listMarriageReports({ status }, query) {
    const filter = status ? { storyStatus: status } : {};
    return paginationUtils.paginate(
      models.MarriageReport.find(filter)
        .sort({ createdAt: -1 })
        .populate('user', 'name email phoneNumber role status')
        .populate('biodata', 'biodataNo district')
        .populate('partnerBiodata', 'biodataNo')
        .lean(),
      models.MarriageReport.countDocuments(filter),
      paginationUtils.pageParams(query, { defaultLimit: 20 }),
      (r) => ({
        id: r._id,
        user: userSerializer.toUserSummary(r.user),
        biodataNo: r.biodata?.biodataNo ?? null,
        partnerBiodataNo: r.partnerBiodata?.biodataNo ?? null,
        partner: r.partner ?? null,
        viaGhotok: r.viaGhotok,
        marriedOn: r.marriedOn ?? null,
        place: r.place ?? null,
        story: r.story ?? null,
        shareStory: r.shareStory,
        storyStatus: r.storyStatus,
        publishedStory: r.publishedStory ?? null,
        createdAt: r.createdAt,
      }),
    );
  }

  /** Publishes (with optional edited text) or hides a story. Publishing needs the member's consent. */
  async function updateStory(id, { storyStatus, publishedStory }, ctx) {
    const r = await models.MarriageReport.findById(id);
    if (!r) throw apiErrorUtils.notFound('Report');
    if (storyStatus === 'published' && !r.shareStory) {
      throw apiErrorUtils.conflict('NO_CONSENT', 'The member did not agree to share this story.');
    }
    if (storyStatus === 'published' && !(publishedStory ?? r.publishedStory ?? r.story)) {
      throw apiErrorUtils.conflict('NO_STORY', 'There is no story text to publish.');
    }
    if (publishedStory !== undefined) r.publishedStory = publishedStory || undefined;
    if (storyStatus) {
      r.storyStatus = storyStatus;
      r.publishedAt = storyStatus === 'published' ? new Date() : r.publishedAt;
    }
    await r.save();
    contentService.clearStatsCache();
    await auditService.recordAudit(ctx, 'story.update', {
      targetType: 'marriage_report',
      targetId: r._id,
      summary: `Success story ${r.storyStatus}`,
    });
    return { id: r._id, storyStatus: r.storyStatus, publishedStory: r.publishedStory ?? null };
  }

  return { publishedStories, listMarriageReports, updateStory };
})();

// --- services/ticket.service.js ----------------------------------------------------------------
const ticketService = (() => {
  const MAX_OPEN_TICKETS = 5;

  // ----- Members -----------------------------------------------------------------

  function listMyTickets(user, query) {
    const filter = { user: user._id };
    return paginationUtils.paginate(
      models.SupportTicket.find(filter).sort({ lastMessageAt: -1 }).populate('biodata', 'biodataNo'),
      models.SupportTicket.countDocuments(filter),
      paginationUtils.pageParams(query, { defaultLimit: 20 }),
      (t) => ticketSerializer.toTicketDTO(t),
    );
  }

  /**
   * Opens a ticket. Reports about a biodata open one too (see report.service.js),
   * passing `extra` ({ report, biodata }) and skipping the open-ticket limit.
   */
  async function openTicket(user, { subject, category, message, attachments }, extra) {
    const open = extra
      ? 0
      : await models.SupportTicket.countDocuments({ user: user._id, status: { $ne: 'closed' } });
    if (open >= MAX_OPEN_TICKETS) {
      throw apiErrorUtils.conflict(
        'TOO_MANY_OPEN',
        `You have ${MAX_OPEN_TICKETS} open tickets. Please wait for a reply or close one first.`,
      );
    }
    const ticket = await models.SupportTicket.create({
      ticketNo: `T-${await models.nextSequence('ticket', 1000)}`,
      user: user._id,
      subject,
      category,
      messages: [
        {
          author: user._id,
          staff: false,
          body: message,
          attachments: attachmentService.toAttachments(attachments),
        },
      ],
      ...extra,
    });
    return ticketSerializer.toTicketDTO(ticket);
  }

  async function findMyTicket(user, id) {
    const t = await models.SupportTicket.findOne({ _id: id, user: user._id })
      .populate('messages.author', 'name')
      .populate('biodata', 'biodataNo');
    if (!t) throw apiErrorUtils.notFound('Ticket');
    return t;
  }

  /** The member's ticket with its messages; opening it marks staff replies as read. */
  async function getMyTicket(user, id) {
    const t = await findMyTicket(user, id);
    t.userReadAt = new Date();
    await t.save();
    return ticketSerializer.toTicketDTO(t, { withMessages: true });
  }

  /** The member replies. Replying to a closed ticket reopens it and sends it back to support. */
  async function replyToMyTicket(user, id, { message = '', attachments }) {
    const t = await findMyTicket(user, id);
    t.messages.push({
      author: user._id,
      staff: false,
      body: message,
      attachments: attachmentService.toAttachments(attachments),
    });
    t.status = 'waiting';
    t.closedAt = undefined;
    t.lastMessageAt = new Date();
    t.userReadAt = t.lastMessageAt;
    await t.save();
    await t.populate('messages.author', 'name');
    return ticketSerializer.toTicketDTO(t, { withMessages: true });
  }

  async function closeMyTicket(user, id) {
    const t = await models.SupportTicket.findOneAndUpdate(
      { _id: id, user: user._id },
      { status: 'closed', closedAt: new Date() },
      { new: true },
    );
    if (!t) throw apiErrorUtils.notFound('Ticket');
    return ticketSerializer.toTicketDTO(t);
  }

  async function submitContactMessage(data, { user, ip }) {
    await models.ContactMessage.create({ ...data, user: user?._id, ip });
  }

  // ----- Staff -------------------------------------------------------------------

  async function listTickets({ status, category, q }, query) {
    const filter = {};
    if (status === 'active') filter.status = { $ne: 'closed' };
    else if (status) filter.status = status;
    if (category) filter.category = category;
    if (q) {
      const re = new RegExp(stringsUtils.escapeRegex(q), 'i');
      const users = await models.User.find({ $or: [{ name: re }, { email: re }, { phoneNumber: re }] })
        .select('_id')
        .limit(50);
      filter.$or = [{ ticketNo: re }, { subject: re }, { user: { $in: users.map((u) => u._id) } }];
    }
    return paginationUtils.paginate(
      models.SupportTicket.find(filter)
        .sort({ lastMessageAt: -1 })
        .populate('user', 'name email phoneNumber role status')
        .populate('assignedTo', 'name'),
      models.SupportTicket.countDocuments(filter),
      paginationUtils.pageParams(query, { defaultLimit: 20 }),
      (t) => ticketSerializer.toStaffTicketDTO(t),
    );
  }

  async function findTicket(id) {
    const t = await models.SupportTicket.findById(id)
      .populate('biodata', 'biodataNo')
      .populate('user', 'name email phoneNumber role status')
      .populate('messages.author', 'name')
      .populate('assignedTo', 'name');
    if (!t) throw apiErrorUtils.notFound('Ticket');
    return t;
  }

  async function getTicket(id) {
    return ticketSerializer.toStaffTicketDTO(await findTicket(id), { withMessages: true });
  }

  /** Staff reply; optionally closes the ticket. The member is notified. */
  async function staffReply(id, { message = '', close, attachments }, ctx) {
    const t = await findTicket(id);
    if (t.status === 'closed') throw apiErrorUtils.conflict('TICKET_CLOSED', 'This ticket is closed.');
    t.messages.push({
      author: ctx.actor._id,
      staff: true,
      body: message,
      attachments: attachmentService.toAttachments(attachments),
    });
    t.status = close ? 'closed' : 'answered';
    if (close) t.closedAt = new Date();
    t.lastMessageAt = new Date();
    t.lastStaffMessageAt = t.lastMessageAt;
    t.assignedTo ??= ctx.actor._id;
    await t.save();
    await t.populate([
      { path: 'messages.author', select: 'name' },
      { path: 'assignedTo', select: 'name' },
    ]);
    await notificationService.notify(
      t.user._id,
      'ticket_replied',
      { ticketNo: t.ticketNo },
      `/dashboard/support/${t._id}`,
    );
    return ticketSerializer.toStaffTicketDTO(t, { withMessages: true });
  }

  async function updateTicket(id, { status, priority, assignToMe }, ctx) {
    const t = await findTicket(id);
    if (status) {
      t.status = status;
      t.closedAt = status === 'closed' ? new Date() : undefined;
    }
    if (priority) t.priority = priority;
    if (assignToMe) t.assignedTo = ctx.actor._id;
    await t.save();
    await t.populate('assignedTo', 'name');
    return ticketSerializer.toStaffTicketDTO(t, { withMessages: true });
  }

  function listContactMessages({ status }, query) {
    const filter = status ? { status } : {};
    return paginationUtils.paginate(
      models.ContactMessage.find(filter).sort({ createdAt: -1 }).lean(),
      models.ContactMessage.countDocuments(filter),
      paginationUtils.pageParams(query, { defaultLimit: 20 }),
      // The sender's IP address is kept for abuse handling but not shown in the panel.
      ({ ip: _ip, ...m }) => ({ ...m, id: m._id }),
    );
  }

  async function setContactMessageStatus(id, status) {
    const m = await models.ContactMessage.findByIdAndUpdate(id, { status }, { new: true });
    if (!m) throw apiErrorUtils.notFound('Message');
  }

  return {
    listMyTickets,
    openTicket,
    getMyTicket,
    replyToMyTicket,
    closeMyTicket,
    submitContactMessage,
    listTickets,
    getTicket,
    staffReply,
    updateTicket,
    listContactMessages,
    setContactMessageStatus,
  };
})();

// --- services/user.service.js ------------------------------------------------------------------
const userService = (() => {
  // Admin management of accounts: search, roles, suspension, account creation.

  const INACTIVE = ['suspended', 'banned'];

  /** Finds a user by id, email or phone number, or throws 404. */
  async function findUserByAny(ref) {
    const s = String(ref ?? '').trim();
    let user = null;
    if (mongoose.isValidObjectId(s)) user = await models.User.findById(s);
    else if (shared.isValidEmail(s)) user = await models.User.findOne({ email: s.toLowerCase() });
    else if (shared.isValidPhone(s))
      user = await models.User.findOne({ phoneNumber: shared.normalizePhone(s) });
    if (!user) throw apiErrorUtils.notFound('User');
    return user;
  }

  async function listUsers({ q, role, status, verified }, query) {
    const filter = {};
    if (role === 'staff') filter.role = 'admin';
    else if (role) filter.role = role;
    if (status) filter.status = status;
    if (verified === 'false') {
      filter.emailVerified = { $ne: true };
      filter.phoneNumberVerified = { $ne: true };
    }
    if (q) {
      const re = new RegExp(stringsUtils.escapeRegex(q), 'i');
      filter.$or = [{ name: re }, { email: re }, { phoneNumber: re }];
      const byNumber = await models.Biodata.findOne({ biodataNo: q.toUpperCase() }).select('user');
      if (byNumber) filter.$or.push({ _id: byNumber.user });
    }
    const params = paginationUtils.pageParams(query, { defaultLimit: 20 });
    const [users, total] = await Promise.all([
      models.User.find(filter).sort({ createdAt: -1 }).skip(params.skip).limit(params.limit),
      models.User.countDocuments(filter),
    ]);
    const biodatas = await models.Biodata.find({ user: { $in: users.map((u) => u._id) } })
      .select('user biodataNo status')
      .lean();
    const byUser = new Map(
      biodatas.map((b) => [b.user.toString(), { biodataNo: b.biodataNo, status: b.status }]),
    );
    return paginationUtils.paged(
      users.map((u) => ({ ...userSerializer.toUserDTO(u), biodata: byUser.get(u._id.toString()) ?? null })),
      total,
      params,
    );
  }

  async function getUserDetail(id) {
    const user = await models.User.findById(id);
    if (!user) throw apiErrorUtils.notFound('User');
    const [biodata, payments, ledger, unlocks, tickets, reportsAgainst] = await Promise.all([
      models.Biodata.findOne({ user: user._id }),
      models.Payment.find({ user: user._id }).sort({ createdAt: -1 }).limit(10).lean(),
      models.ConnectionTransaction.find({ user: user._id })
        .sort({ createdAt: -1 })
        .limit(20)
        .populate('biodata', 'biodataNo')
        .populate('actor', 'name')
        .lean(),
      models.ContactUnlock.countDocuments({ user: user._id }),
      models.SupportTicket.countDocuments({ user: user._id }),
      models.Report.countDocuments({ targetUser: user._id }),
    ]);
    return {
      user: { ...userSerializer.toUserDTO(user), statusReason: user.statusReason ?? null },
      biodata: biodata ? biodataSerializer.toAdminRow(biodata) : null,
      payments: payments.map((p) => ({
        id: p._id,
        invoiceNo: p.invoiceNo,
        amount: p.amount,
        connections: p.connections,
        method: p.method,
        status: p.status,
        trxId: p.trxId ?? null,
        createdAt: p.createdAt,
      })),
      ledger: ledger.map((t) => ({
        id: t._id,
        type: t.type,
        delta: t.delta,
        balanceAfter: t.balanceAfter,
        reason: t.reason ?? null,
        biodataNo: t.biodata?.biodataNo ?? null,
        actor: t.actor?.name ?? null,
        createdAt: t.createdAt,
      })),
      counts: { unlocks, tickets, reportsAgainst },
    };
  }

  async function assertUnique(field, value, exceptId) {
    if (value && (await models.User.exists({ [field]: value, _id: { $ne: exceptId } }))) {
      throw apiErrorUtils.conflict(
        'DUPLICATE',
        `Another account uses this ${field === 'email' ? 'email' : 'mobile number'}.`,
      );
    }
  }

  /**
   * Updates an account. Changing a role needs `roles.assign`; staff cannot demote or
   * suspend themselves. Suspending or banning hides the biodata and signs the user out.
   */
  async function updateUser(id, data, ctx) {
    const user = await models.User.findById(id);
    if (!user) throw apiErrorUtils.notFound('User');
    const self = user._id.equals(ctx.actor._id);
    if (self && data.role && data.role !== user.role)
      throw apiErrorUtils.forbidden('SELF_ROLE', 'You cannot change your own role.');
    if (self && data.status && data.status !== 'active')
      throw apiErrorUtils.forbidden('SELF_STATUS', 'You cannot suspend your own account.');
    if (data.role && data.role !== user.role && !shared.can(ctx.actor.role, 'roles.assign'))
      throw apiErrorUtils.forbidden();

    if (data.email) {
      await assertUnique('email', data.email, user._id);
      user.email = data.email;
    }
    if (data.phoneNumber !== undefined) {
      await assertUnique('phoneNumber', data.phoneNumber, user._id);
      user.phoneNumber = data.phoneNumber ?? undefined;
      if (!data.phoneNumber) user.phoneNumberVerified = false;
    }
    const before = { role: user.role, status: user.status };
    for (const key of ['name', 'role', 'status', 'statusReason', 'emailVerified', 'phoneNumberVerified']) {
      if (data[key] !== undefined) user[key] = data[key];
    }
    await user.save();

    if (data.status && data.status !== before.status) {
      const inactive = INACTIVE.includes(data.status);
      await models.Biodata.updateOne({ user: user._id }, { blocked: inactive });
      if (inactive) await credentialsService.revokeAllSessions(user._id);
      await auditService.recordAudit(ctx, 'user.status', {
        targetType: 'user',
        targetId: user._id,
        summary: `${user.name}: ${before.status} → ${data.status}`,
        meta: { reason: data.statusReason },
      });
    }
    if (data.role && data.role !== before.role) {
      await credentialsService.revokeAllSessions(user._id);
      await auditService.recordAudit(ctx, 'user.role', {
        targetType: 'user',
        targetId: user._id,
        summary: `${user.name}: ${before.role} → ${data.role}`,
      });
    }
    await auditService.recordAudit(ctx, 'user.update', {
      targetType: 'user',
      targetId: user._id,
      summary: `Updated ${user.name}`,
      meta: Object.keys(data),
    });
    return userSerializer.toUserDTO(user);
  }

  /** Creates an email + password account from the admin panel. It is treated as verified. */
  async function createUser({ name, email, phoneNumber, password, role }, ctx) {
    if (role !== 'user' && !shared.can(ctx.actor.role, 'roles.assign')) throw apiErrorUtils.forbidden();
    const or = [{ email }, phoneNumber && { phoneNumber }].filter(Boolean);
    if (await models.User.exists({ $or: or }))
      throw apiErrorUtils.conflict(
        'ACCOUNT_EXISTS',
        'An account with this email or mobile number already exists.',
      );
    const user = await credentialsService.createPasswordAccount({
      name,
      email,
      phoneNumber,
      password,
      role,
      verified: true,
    });
    await auditService.recordAudit(ctx, 'user.create', {
      targetType: 'user',
      targetId: user._id,
      summary: `Created ${role} ${user.name}`,
    });
    return userSerializer.toUserDTO(user);
  }

  async function resetUserPassword(id, password, ctx) {
    const user = await models.User.findById(id);
    if (!user) throw apiErrorUtils.notFound('User');
    await credentialsService.setPassword(user._id, password);
    await notificationService.notify(user._id, 'password_reset_by_staff', {});
    await auditService.recordAudit(ctx, 'user.reset_password', {
      targetType: 'user',
      targetId: user._id,
      summary: `Reset password of ${user.name}`,
    });
  }

  return { findUserByAny, listUsers, getUserDetail, updateUser, createUser, resetUserPassword };
})();

// --- services/visit.service.js -----------------------------------------------------------------
const visitService = (() => {
  /** A stable anonymous visitor id for the `gh_vid` cookie. */
  const newVisitorId = () => crypto.randomUUID();
  const isValidVisitorId = (id) => typeof id === 'string' && /^[\w-]{20,64}$/.test(id);

  /**
   * Records one visit per viewer per biodata per day.
   * @returns {Promise<boolean>} true when this visit was counted
   */
  async function recordVisit(biodata, viewerKey) {
    if (!viewerKey) return false;
    try {
      await models.ProfileVisit.create({ biodata: biodata._id, viewerKey, day: stringsUtils.dayKey() });
    } catch (err) {
      if (err?.code === 11000) return false; // already counted today
      throw err;
    }
    await models.Biodata.updateOne({ _id: biodata._id }, { $inc: { 'stats.views': 1 } });
    return true;
  }

  /** Visit counts for today, the last 7 days and the last 30 days. */
  async function visitStats(biodataId) {
    const now = Date.now();
    const since = (days) => stringsUtils.dayKey(new Date(now - (days - 1) * 864e5));
    const [today, week, month] = await Promise.all([
      models.ProfileVisit.countDocuments({ biodata: biodataId, day: stringsUtils.dayKey() }),
      models.ProfileVisit.countDocuments({ biodata: biodataId, day: { $gte: since(7) } }),
      models.ProfileVisit.countDocuments({ biodata: biodataId, day: { $gte: since(30) } }),
    ]);
    return { today, week, month };
  }

  return { newVisitorId, isValidVisitorId, recordVisit, visitStats };
})();

// ==============================================================================================
// REQUEST VALIDATION SCHEMAS (ZOD)
// ==============================================================================================

// --- validations/account.validation.js ---------------------------------------------------------
const accountValidation = (() => {
  const updateProfile = z.object({
    name: z.string().trim().min(2).max(80).optional(),
    language: z.enum(['en', 'bn']).optional(),
  });

  const deactivate = z.object({
    // Required when the account has a password (members who only use codes or Google have none).
    password: z.string().max(128).optional(),
    reason: z.string().trim().max(500).optional(),
  });

  const proposalsQuery = z.object({
    box: z.enum(['sent', 'received']).catch('received'),
    status: z.enum(shared.optionValues(shared.PROPOSAL_STATUS)).optional().catch(undefined),
    page: z.string().optional(),
    limit: z.string().optional(),
  });

  const respondToProposal = z.object({
    action: z.enum(['accept', 'decline']),
    note: z.string().trim().max(500).optional(),
  });

  return { updateProfile, deactivate, proposalsQuery, respondToProposal };
})();

// --- validations/common.validation.js ----------------------------------------------------------
const commonValidation = (() => {
  const objectId = z.string().regex(/^[a-f\d]{24}$/i, 'Invalid id');
  const idParams = z.object({ id: objectId });

  /** Optional pagination params; the values are read with utils/pagination.js. */
  const paginationQuery = z.object({
    page: z.coerce.number().int().min(1).optional(),
    limit: z.coerce.number().int().min(1).max(100).optional(),
  });

  const i18nText = (max) =>
    z.object({ en: z.string().max(max).default(''), bn: z.string().max(max).default('') });

  const password = z.string().min(8, 'Use at least 8 characters.').max(128);

  const optionalEmail = z
    .string()
    .trim()
    .max(120)
    .optional()
    .transform((v) => (v ? v.toLowerCase() : undefined))
    .refine((v) => !v || shared.isValidEmail(v), 'Enter a valid email address.');

  const optionalPhone = z
    .string()
    .trim()
    .max(20)
    .optional()
    .transform((v) => (v ? shared.normalizePhone(v) : undefined))
    .refine((v) => !v || shared.isValidPhone(v), 'Enter a valid mobile number (01XXXXXXXXX).');

  // Images are uploaded by the browser straight to ImgBB; the API only stores the links.
  // Accepting only ImgBB hosts keeps arbitrary third-party URLs out of tickets and banners.
  const IMGBB_HOSTS = new Set(['i.ibb.co', 'ibb.co']);

  function isImgbbUrl(value) {
    try {
      const url = new URL(value);
      return url.protocol === 'https:' && IMGBB_HOSTS.has(url.hostname);
    } catch {
      return false;
    }
  }

  const imgbbUrl = z
    .string()
    .trim()
    .max(500)
    .refine(isImgbbUrl, 'Upload the image through ImgBB (https://i.ibb.co/…).');

  /** Up to five ImgBB image links attached to a support message or report. */
  const imageAttachments = z.array(imgbbUrl).max(5, 'Attach at most 5 images.').optional();

  return {
    objectId,
    idParams,
    paginationQuery,
    i18nText,
    password,
    optionalEmail,
    optionalPhone,
    isImgbbUrl,
    imgbbUrl,
    imageAttachments,
  };
})();

// --- validations/admin.validation.js -----------------------------------------------------------
const adminValidation = (() => {
  const list = { page: z.string().optional(), limit: z.string().optional() };
  const loose = (schema) => schema.optional().catch(undefined);

  // ----- Biodatas ------------------------------------------------------------------

  const biodatasQuery = z.object({
    status: loose(z.enum(shared.optionValues(shared.BIODATA_STATUS))),
    type: loose(z.enum(['bride', 'groom'])),
    religion: loose(z.enum(shared.optionValues(shared.RELIGIONS))),
    hidden: z.string().optional(),
    blocked: z.string().optional(),
    deleted: loose(z.enum(['true', 'false', 'all'])),
    q: z.string().trim().max(80).optional(),
    ...list,
  });

  const correction = z
    .object({
      section: z.string(),
      field: z.string(),
      note: z.string().trim().max(300).optional(),
    })
    .refine(
      (c) =>
        shared.BIODATA_SECTIONS.some((s) => s.key === c.section && s.fields.some((f) => f.key === c.field)),
      'Unknown biodata field.',
    );

  const rejectBiodata = z.object({
    reason: z.string().trim().min(5, 'Tell the user what to change.').max(1000),
    corrections: z.array(correction).max(60).optional(),
  });

  const suspendEdit = z.object({
    until: z.coerce
      .date()
      .refine((d) => d.getTime() > Date.now(), 'Choose a date in the future.')
      .nullable(),
    reason: z.string().trim().max(500).optional(),
  });

  const blockBiodata = z.object({ blocked: z.boolean(), reason: z.string().trim().max(500).optional() });

  const deleteBiodata = z.object({ reason: z.string().trim().min(3).max(500) });

  const note = z.object({ note: z.string().trim().max(500).optional() });

  const declineRestore = z.object({
    note: z.string().trim().max(500).optional(),
    permanent: z.boolean().optional(),
  });

  const restoreRequestsQuery = z.object({
    status: loose(z.enum(shared.optionValues(shared.RESTORE_STATUS))),
    ...list,
  });

  // ----- Users -------------------------------------------------------------------

  const usersQuery = z.object({
    q: z.string().trim().max(80).optional(),
    role: loose(z.enum([...shared.optionValues(shared.ROLE_OPTIONS), 'staff'])),
    status: loose(z.enum(shared.optionValues(shared.USER_STATUS_OPTIONS))),
    verified: z.string().optional(),
    ...list,
  });

  /** `null` clears the phone number; `undefined` leaves it unchanged. */
  const clearable = (schema) => z.union([z.null(), z.literal('').transform(() => null), schema]);

  const updateUser = z.object({
    name: z.string().trim().min(2).max(80).optional(),
    // Every account has an email (Better Auth needs one), so it can be changed but not cleared.
    email: commonValidation.optionalEmail,
    phoneNumber: clearable(commonValidation.optionalPhone).optional(),
    role: z.enum(shared.optionValues(shared.ROLE_OPTIONS)).optional(),
    status: z.enum(shared.optionValues(shared.USER_STATUS_OPTIONS)).optional(),
    statusReason: z.string().trim().max(500).optional(),
    emailVerified: z.boolean().optional(),
    phoneNumberVerified: z.boolean().optional(),
  });

  const createUser = z.object({
    name: z.string().trim().min(2).max(80),
    email: commonValidation.optionalEmail.refine(Boolean, 'Enter an email address.'),
    phoneNumber: commonValidation.optionalPhone,
    password: commonValidation.password,
    role: z.enum(shared.optionValues(shared.ROLE_OPTIONS)).default('user'),
  });

  const resetUserPassword = z.object({ password: commonValidation.password });

  // ----- Content and settings -----------------------------------------------------------

  const settingsParams = z.object({ key: z.enum(['site', 'payments', 'stats']) });

  const updateSettings = z.object({
    value: z
      .record(z.string(), z.unknown())
      .refine((v) => JSON.stringify(v).length <= 20000, 'Setting value is too large.'),
  });

  const pageParams = z.object({
    slug: z
      .string()
      .trim()
      .toLowerCase()
      .regex(/^[a-z0-9-]{2,60}$/, 'Use lowercase letters, numbers and dashes.'),
  });

  const upsertPage = z.object({
    title: commonValidation.i18nText(160),
    body: commonValidation.i18nText(60000),
    isPublished: z.boolean().default(true),
  });

  // No defaults here: zod applies defaults inside .partial(), which would reset fields on update.
  const faqFields = z.object({
    question: commonValidation.i18nText(300),
    answer: commonValidation.i18nText(5000),
    category: z.string().trim().max(40),
    sortOrder: z.number().int(),
    isActive: z.boolean(),
  });
  const createFaq = faqFields.partial({ category: true, sortOrder: true, isActive: true });
  const updateFaq = faqFields.partial();

  const analyticsQuery = z.object({ days: z.coerce.number().int().min(7).max(365).catch(30) });

  const auditQuery = z.object({
    action: z.string().trim().max(60).optional(),
    targetId: z.string().trim().max(60).optional(),
    ...list,
  });

  // ----- Success stories and banners ------------------------------------------------

  const storiesQuery = z.object({ status: loose(z.enum(['pending', 'published', 'hidden'])), ...list });

  const updateStory = z.object({
    storyStatus: z.enum(['pending', 'published', 'hidden']).optional(),
    publishedStory: z.string().trim().max(2000).optional(),
  });

  const bannerFields = {
    title: z.object({ en: z.string().trim().min(1).max(120), bn: z.string().trim().max(120).optional() }),
    // Both images are uploaded to ImgBB from the admin panel.
    imageUrl: commonValidation.imgbbUrl,
    downloadUrl: commonValidation.imgbbUrl,
    sortOrder: z.number().int(),
    isActive: z.boolean(),
  };
  // The download defaults to the preview image when only one is given.
  const createBanner = z.object(bannerFields).partial({ downloadUrl: true, sortOrder: true, isActive: true });
  const updateBanner = z.object(bannerFields).partial();

  return {
    biodatasQuery,
    rejectBiodata,
    suspendEdit,
    blockBiodata,
    deleteBiodata,
    note,
    declineRestore,
    restoreRequestsQuery,
    usersQuery,
    updateUser,
    createUser,
    resetUserPassword,
    settingsParams,
    updateSettings,
    pageParams,
    upsertPage,
    createFaq,
    updateFaq,
    analyticsQuery,
    auditQuery,
    storiesQuery,
    updateStory,
    createBanner,
    updateBanner,
  };
})();

// --- validations/biodata.validation.js ---------------------------------------------------------
const biodataValidation = (() => {
  // Section contents are validated by the shared form schema (validateSection), not here.

  const sectionParams = z.object({ section: z.enum(shared.SECTION_KEYS, { message: 'Unknown section' }) });

  const saveSection = z.object({ data: z.record(z.string(), z.unknown()).default({}) });

  const biodataNoParams = z.object({
    no: z
      .string()
      .trim()
      .regex(/^GH-\d{1,10}$/i, 'Invalid biodata number'),
  });

  const createBiodata = z.object({
    pledge: z.literal(true, { message: 'Please accept the pledge to continue.' }),
  });

  const visibility = z
    .object({
      hidden: z.boolean(),
      reason: z.enum(shared.optionValues(shared.HIDE_REASONS)).optional(),
      note: z.string().trim().max(500).optional(),
    })
    .refine((v) => !v.hidden || v.reason, {
      message: 'Tell us why you are hiding your biodata.',
      path: ['reason'],
    })
    .refine((v) => !v.hidden || v.reason !== 'other' || v.note, {
      message: 'Please write your reason.',
      path: ['note'],
    });

  const marriage = z.object({
    marriedOn: z.coerce
      .date()
      .refine((d) => d.getTime() <= Date.now() + 864e5, 'The date cannot be in the future.')
      .optional(),
    place: z.string().trim().max(120).optional(),
    partnerBiodataNo: z
      .string()
      .trim()
      .regex(/^GH-\d{1,10}$/i, 'Enter a biodata number like GH-1024.')
      .optional(),
    partner: z
      .object({
        name: z.string().trim().max(80).optional(),
        district: z.string().trim().max(40).optional(),
        profession: z.string().trim().max(60).optional(),
        education: z.string().trim().max(60).optional(),
      })
      .optional(),
    story: z.string().trim().max(2000).optional(),
    shareStory: z.boolean().optional(),
  });

  const partnerLookup = z.object({
    no: z
      .string()
      .trim()
      .regex(/^GH-\d{1,10}$/i),
  });

  const deleteBiodata = z.object({
    reason: z.enum(shared.optionValues(shared.DELETE_REASONS)),
    note: z.string().trim().max(500).optional(),
    marriage: marriage.optional(),
  });

  const restoreRequest = z.object({ reason: z.string().trim().max(1000).optional() });

  const proposal = z.object({ message: z.string().trim().max(1000).optional() });

  const report = z.object({
    reason: z.enum(shared.optionValues(shared.REPORT_REASONS)),
    details: z.string().trim().max(2000).optional(),
    attachments: commonValidation.imageAttachments,
  });

  const text = z.string().trim().max(200).optional();

  /** Search filters. Unknown parameters are dropped; values are interpreted by search.service.js. */
  const searchQuery = z.object({
    type: text,
    religion: text,
    marital: text,
    complexion: text,
    profession: text,
    economic: text,
    division: text,
    district: z.string().trim().max(1000).optional(),
    upazila: z.string().trim().max(3000).optional(),
    presentDistrict: z.string().trim().max(1000).optional(),
    presentUpazila: z.string().trim().max(3000).optional(),
    medium: text,
    category: text,
    scope: text,
    ageMin: text,
    ageMax: text,
    heightMin: text,
    heightMax: text,
    education: text,
    q: text,
    sort: text,
    page: text,
    limit: text,
  });

  const featuredQuery = z.object({ limit: z.coerce.number().int().min(1).max(12).catch(4) });

  return {
    sectionParams,
    saveSection,
    biodataNoParams,
    createBiodata,
    visibility,
    partnerLookup,
    deleteBiodata,
    restoreRequest,
    proposal,
    report,
    searchQuery,
    featuredQuery,
  };
})();

// --- validations/payment.validation.js ---------------------------------------------------------
const paymentValidation = (() => {
  const method = z.enum(shared.optionValues(shared.PAYMENT_METHODS));

  /** Manual payments need the sender number and transaction ID; gateway checkouts do not. */
  const createPayment = z
    .object({
      packageId: commonValidation.objectId,
      method,
      mode: z.enum(['manual', 'gateway']).default('manual'),
      senderNumber: z.string().trim().max(20).optional(),
      trxId: z.string().trim().max(40).optional(),
    })
    .transform((v, ctx) => {
      if (v.mode === 'gateway') return { packageId: v.packageId, method: v.method, mode: v.mode };
      const senderNumber = shared.normalizePhone(v.senderNumber);
      const trxId = String(v.trxId ?? '').toUpperCase();
      if (!shared.isValidPhone(senderNumber)) {
        ctx.addIssue({
          code: 'custom',
          path: ['senderNumber'],
          message: 'Enter the mobile number you paid from.',
        });
      }
      if (!/^[A-Z0-9]{6,20}$/.test(trxId)) {
        ctx.addIssue({
          code: 'custom',
          path: ['trxId'],
          message: 'Enter the transaction ID from the confirmation SMS.',
        });
      }
      return { ...v, senderNumber, trxId };
    });

  const requestRefund = z.object({
    paymentId: commonValidation.objectId,
    reason: z.string().trim().min(10, 'Please explain the reason.').max(1000),
  });

  // ----- Staff -------------------------------------------------------------------

  const paymentsQuery = z.object({
    status: z.enum(shared.optionValues(shared.PAYMENT_STATUS)).optional().catch(undefined),
    method: method.optional().catch(undefined),
    mode: z.enum(['manual', 'gateway']).optional().catch(undefined),
    q: z.string().trim().max(60).optional(),
    page: z.string().optional(),
    limit: z.string().optional(),
  });

  const rejectPayment = z.object({
    reason: z.string().trim().min(3, 'Add a reason for the user.').max(500),
  });

  const refundsQuery = z.object({
    status: z.enum(shared.optionValues(shared.REFUND_STATUS)).optional().catch(undefined),
    page: z.string().optional(),
    limit: z.string().optional(),
  });

  const approveRefund = z.object({
    resolution: z.enum(shared.optionValues(shared.REFUND_RESOLUTIONS)),
    connections: z.number().int().min(0).max(1000).optional(),
    amount: z.number().min(0).max(1_000_000).optional(),
    refundTrxId: z.string().trim().max(40).optional(),
    note: z.string().trim().max(1000).optional(),
  });

  const rejectRefund = z.object({
    note: z.string().trim().min(3, 'Add a note for the user.').max(1000),
  });

  const adjustConnections = z.object({
    user: z.string().trim().min(3, 'Enter a user id, email or mobile number.'),
    action: z.enum(shared.optionValues(shared.ADJUSTMENT_ACTIONS)),
    quantity: z.number().int().min(1).max(1000),
    reason: z.string().trim().min(3, 'The reason is saved in the audit log.').max(500),
  });

  const ledgerQuery = z.object({
    user: z.string().trim().max(120).optional(),
    type: z.enum(shared.optionValues(shared.LEDGER_TYPES)).optional().catch(undefined),
    page: z.string().optional(),
    limit: z.string().optional(),
  });

  const packageFields = {
    name: z.object({ en: z.string().trim().min(1).max(60), bn: z.string().trim().max(60).optional() }),
    description: z
      .object({ en: z.string().trim().max(200).optional(), bn: z.string().trim().max(200).optional() })
      .optional(),
    connections: z.number().int().min(1).max(1000),
    price: z.number().int().min(1).max(1_000_000),
    isActive: z.boolean().optional(),
    highlight: z.boolean().optional(),
    sortOrder: z.number().int().optional(),
  };

  const createPackage = z.object(packageFields);
  const updatePackage = z.object(packageFields).partial();

  const invoiceParams = z.object({
    invoiceNo: z
      .string()
      .trim()
      .regex(/^INV-[A-Z0-9-]{4,40}$/i),
  });

  /** Gateways that post their result back to us (form posts from the customer's browser and IPN). */
  const postbackParams = z.object({ method: z.enum(['sslcommerz']) });

  return {
    createPayment,
    requestRefund,
    paymentsQuery,
    rejectPayment,
    refundsQuery,
    approveRefund,
    rejectRefund,
    adjustConnections,
    ledgerQuery,
    createPackage,
    updatePackage,
    invoiceParams,
    postbackParams,
  };
})();

// --- validations/support.validation.js ---------------------------------------------------------
const supportValidation = (() => {
  const createTicket = z.object({
    subject: z.string().trim().min(4, 'Please add a short subject.').max(160),
    category: z.enum(shared.optionValues(shared.TICKET_CATEGORIES)).default('other'),
    message: z.string().trim().min(10, 'Please describe the problem.').max(20000),
    attachments: commonValidation.imageAttachments,
  });

  /** A reply needs text or at least one attachment. */
  const reply = (extra = {}) =>
    z
      .object({
        message: z.string().trim().max(20000).default(''),
        attachments: commonValidation.imageAttachments,
        ...extra,
      })
      .refine((v) => v.message || v.attachments?.length, {
        message: 'Write a message or attach an image.',
        path: ['message'],
      });

  const replyToTicket = reply();

  const contactMessage = z.object({
    name: z.string().trim().min(2, 'Please enter your name.').max(80),
    email: commonValidation.optionalEmail,
    phone: z.string().trim().max(20).optional(),
    subject: z.string().trim().max(160).optional(),
    message: z.string().trim().min(10, 'Please write a little more.').max(3000),
  });

  // ----- Staff -------------------------------------------------------------------

  const list = { page: z.string().optional(), limit: z.string().optional() };

  const ticketsQuery = z.object({
    status: z
      .union([z.enum(shared.optionValues(shared.TICKET_STATUS)), z.literal('active')])
      .optional()
      .catch(undefined),
    category: z.enum(shared.optionValues(shared.TICKET_CATEGORIES)).optional().catch(undefined),
    q: z.string().trim().max(80).optional(),
    ...list,
  });

  const staffReply = reply({ close: z.boolean().optional() });

  const updateTicket = z.object({
    status: z.enum(shared.optionValues(shared.TICKET_STATUS)).optional(),
    priority: z.enum(shared.optionValues(shared.TICKET_PRIORITY)).optional(),
    assignToMe: z.boolean().optional(),
  });

  const contactMessagesQuery = z.object({
    status: z.enum(models.CONTACT_MESSAGE_STATUS).optional().catch(undefined),
    ...list,
  });

  const updateContactMessage = z.object({ status: z.enum(models.CONTACT_MESSAGE_STATUS) });

  const reportsQuery = z.object({
    status: z
      .union([z.enum(shared.optionValues(shared.REPORT_STATUS)), z.literal('active')])
      .optional()
      .catch(undefined),
    ...list,
  });

  const updateReport = z.object({
    status: z.enum(shared.optionValues(shared.REPORT_STATUS)),
    actionTaken: z.string().trim().max(500).optional(),
    // Return the reporter's connection (only when they had unlocked the contact).
    refundConnection: z.boolean().optional(),
  });

  return {
    createTicket,
    replyToTicket,
    contactMessage,
    ticketsQuery,
    staffReply,
    updateTicket,
    contactMessagesQuery,
    updateContactMessage,
    reportsQuery,
    updateReport,
  };
})();

// ==============================================================================================
// SERIALIZERS (API RESPONSE SHAPES)
// ==============================================================================================

// --- serializers/biodata.serializer.js ---------------------------------------------------------
const biodataSerializer = (() => {
  // Output shapes for biodatas. Private data (names and the contact section) only
  // appears in toFullView, which is for the owner and staff.

  const isPublic = (b) => b.status === 'approved' && !b.isHidden && !b.blocked && !b.deletedAt;

  /** Summary used in search results, lists and the home page. No private data. */
  function toCard(b) {
    return {
      id: b._id.toString(),
      biodataNo: b.biodataNo,
      type: b.type ?? null,
      age: shared.ageFromDob(b.birthDate),
      maritalStatus: b.maritalStatus ?? null,
      religion: b.religion ?? null,
      heightIn: b.heightIn ?? null,
      complexion: b.complexion ?? null,
      district: b.district ?? null,
      division: b.division ?? null,
      educationLevel: b.educationLevel ?? null,
      institution: b.education?.institution ?? null,
      profession: b.profession ?? null,
      jobTitle: b.occupation?.jobTitle ?? null,
      approvedAt: b.approvedAt ?? null,
    };
  }

  /**
   * Public profile: every non-private field.
   * @param {object} [owner] the owner's account, for the verified email/phone badges
   */
  function toPublicDetail(b, owner) {
    return {
      ...toCard(b),
      verified: {
        email: !!owner?.emailVerified && !!userSerializer.contactEmail(owner),
        phone: !!owner?.phoneNumberVerified,
      },
      sections: shared.publicSections(b.sectionsObject()),
      views: b.stats?.views ?? 0,
      updatedAt: b.updatedAt,
    };
  }

  /** Everything the owner or staff may see, including private sections. */
  function toFullView(b) {
    return {
      ...toCard(b),
      status: b.status,
      rejectionReason: b.rejectionReason ?? null,
      submittedAt: b.submittedAt ?? null,
      isHidden: b.isHidden,
      hideReason: b.hideReason ?? null,
      hideNote: b.hideNote ?? null,
      blocked: !!b.blocked,
      deletedAt: b.deletedAt ?? null,
      deleteReason: b.deleteReason ?? null,
      // Whether the biodata has ever been live (a deleted one then needs staff approval to restore).
      wasPublished: !!b.firstApprovedAt,
      editSuspendedUntil:
        b.editSuspendedUntil && b.editSuspendedUntil > new Date() ? b.editSuspendedUntil : null,
      pledgeAcceptedAt: b.pledgeAcceptedAt ?? null,
      completion: b.completion,
      stats: b.stats,
      sections: b.sectionsObject(),
      createdAt: b.createdAt,
      updatedAt: b.updatedAt,
    };
  }

  /** A biodata in a personal list: the card while it is public, otherwise only its number. */
  function toListEntry(b, extra = {}) {
    if (!b) return { unavailable: true, ...extra };
    return isPublic(b) ? { ...toCard(b), ...extra } : { biodataNo: b.biodataNo, unavailable: true, ...extra };
  }

  /** The guardian contact details revealed by an unlock. */
  function toContact(b) {
    const c = typeof b.contact?.toObject === 'function' ? b.contact.toObject() : (b.contact ?? {});
    return { ...c };
  }

  /** Row for staff tables. */
  function toAdminRow(b) {
    return {
      id: b._id.toString(),
      biodataNo: b.biodataNo,
      status: b.status,
      type: b.type ?? null,
      religion: b.religion ?? null,
      maritalStatus: b.maritalStatus ?? null,
      district: b.district ?? null,
      age: shared.ageFromDob(b.birthDate),
      completion: b.completion,
      isHidden: b.isHidden,
      blocked: !!b.blocked,
      deletedAt: b.deletedAt ?? null,
      deleteReason: b.deleteReason ?? null,
      submittedAt: b.submittedAt ?? null,
      approvedAt: b.approvedAt ?? null,
      updatedAt: b.updatedAt,
      views: b.stats?.views ?? 0,
      user: b.user?.name ? userSerializer.toUserSummary(b.user) : null,
    };
  }

  return { toCard, toPublicDetail, toFullView, toListEntry, toContact, toAdminRow, isPublic };
})();

// --- serializers/payment.serializer.js ---------------------------------------------------------
const paymentSerializer = (() => {
  function toPackageDTO(p) {
    return {
      id: p._id.toString(),
      name: p.name,
      description: p.description ?? null,
      connections: p.connections,
      price: p.price,
      perConnection: Math.round(p.price / p.connections),
      highlight: !!p.highlight,
      isActive: p.isActive,
      sortOrder: p.sortOrder,
    };
  }

  function toPaymentDTO(p) {
    return {
      id: p._id.toString(),
      invoiceNo: p.invoiceNo,
      packageName: p.packageName,
      connections: p.connections,
      amount: p.amount,
      method: p.method,
      mode: p.mode,
      senderNumber: p.senderNumber ?? null,
      trxId: p.trxId ?? null,
      status: p.status,
      rejectReason: p.rejectReason ?? null,
      createdAt: p.createdAt,
      creditedAt: p.creditedAt ?? null,
      refundedAt: p.refundedAt ?? null,
    };
  }

  function toLedgerEntryDTO(t) {
    return {
      id: t._id,
      type: t.type,
      delta: t.delta,
      balanceAfter: t.balanceAfter,
      reason: t.reason ?? null,
      createdAt: t.createdAt,
      biodataNo: t.biodata?.biodataNo ?? null,
      invoiceNo: t.payment?.invoiceNo ?? null,
    };
  }

  return { toPackageDTO, toPaymentDTO, toLedgerEntryDTO };
})();

// --- serializers/ticket.serializer.js ----------------------------------------------------------
const ticketSerializer = (() => {
  const toAttachmentDTO = (a) => ({ url: a.url, type: 'image' });

  const SUPPORT_NAME = 'Ghotok support';

  /** A ticket as its owner sees it. Staff names are hidden behind "Ghotok support". */
  function toTicketDTO(t, { withMessages = false } = {}) {
    return {
      id: t._id.toString(),
      ticketNo: t.ticketNo,
      subject: t.subject,
      category: t.category,
      status: t.status,
      priority: t.priority,
      createdAt: t.createdAt,
      lastMessageAt: t.lastMessageAt,
      closedAt: t.closedAt ?? null,
      messageCount: t.messages?.length ?? 0,
      // A staff reply the member has not opened yet.
      hasNewReply: !!t.lastStaffMessageAt && (!t.userReadAt || t.lastStaffMessageAt > t.userReadAt),
      biodataNo: t.biodata?.biodataNo ?? null,
      reportId: t.report?._id?.toString() ?? t.report?.toString() ?? null,
      ...(withMessages
        ? {
            messages: (t.messages ?? []).map((m) => ({
              id: m._id.toString(),
              staff: m.staff,
              author: { name: m.staff ? SUPPORT_NAME : (m.author?.name ?? '') },
              body: m.body,
              attachments: (m.attachments ?? []).map(toAttachmentDTO),
              createdAt: m.createdAt,
            })),
          }
        : {}),
    };
  }

  /** A ticket as staff see it, including which team member replied. */
  function toStaffTicketDTO(t, { withMessages = false } = {}) {
    const dto = toTicketDTO(t, { withMessages });
    if (withMessages) {
      dto.messages = t.messages.map((m) => ({
        id: m._id.toString(),
        staff: m.staff,
        author: { name: m.author?.name ?? 'Unknown' },
        body: m.body,
        attachments: (m.attachments ?? []).map(toAttachmentDTO),
        createdAt: m.createdAt,
      }));
    }
    return { ...dto, user: userSerializer.toUserSummary(t.user), assignedTo: t.assignedTo?.name ?? null };
  }

  return { toTicketDTO, toStaffTicketDTO };
})();

// --- serializers/user.serializer.js ------------------------------------------------------------
const userSerializer = (() => {
  /** The email to show, or null for SMS-only accounts (works for documents and lean objects). */
  const contactEmail = (user) =>
    user.email && !user.email.endsWith(`@${userModel.PHONE_EMAIL_DOMAIN}`) ? user.email : null;

  /** Everything the account owner (or an admin) may see about an account. */
  function toUserDTO(user) {
    if (!user) return null;
    return {
      id: user._id.toString(),
      name: user.name,
      email: contactEmail(user),
      phoneNumber: user.phoneNumber ?? null,
      role: user.role,
      status: user.status,
      emailVerified: !!user.emailVerified && !!contactEmail(user),
      phoneNumberVerified: !!user.phoneNumberVerified,
      isVerified: !!(user.emailVerified || user.phoneNumberVerified),
      connectionBalance: user.connectionBalance ?? 0,
      connectionsPurchased: user.connectionsPurchased ?? 0,
      connectionsUsed: user.connectionsUsed ?? 0,
      language: user.language ?? 'en',
      lastLoginAt: user.lastLoginAt ?? null,
      createdAt: user.createdAt,
    };
  }

  /** A compact reference to a user, for admin lists. */
  function toUserSummary(user) {
    if (!user || !user._id) return null;
    return {
      id: user._id.toString(),
      name: user.name,
      email: contactEmail(user),
      phoneNumber: user.phoneNumber ?? null,
      role: user.role,
      status: user.status,
    };
  }

  return { contactEmail, toUserDTO, toUserSummary };
})();

// ==============================================================================================
// MIDDLEWARE
// ==============================================================================================

// --- middlewares/auth.js -----------------------------------------------------------------------
const authMiddleware = (() => {
  /**
   * Loads `req.user` (the Mongoose User) and `req.session` (Better Auth's session) when
   * the request carries a valid session cookie. It never rejects a request itself.
   */
  async function loadUser(req, _res, next) {
    try {
      const result = await authConfig.getAuth().api.getSession({ headers: fromNodeHeaders(req.headers) });
      if (result) {
        req.session = result.session;
        req.user = (await models.User.findById(result.user.id)) ?? undefined;
      }
      next();
    } catch (err) {
      next(err);
    }
  }

  /** Requires an active, signed-in account. */
  function requireAuth(req, _res, next) {
    if (!req.user) return next(apiErrorUtils.unauthorized());
    if (req.user.status !== 'active') {
      return next(
        new apiErrorUtils.ApiError(
          403,
          'ACCOUNT_INACTIVE',
          `Your account is ${req.user.status}. Please contact support.`,
        ),
      );
    }
    next();
  }

  /** Requires a verified email or phone number (when REQUIRE_VERIFICATION is on). Admins are always allowed. */
  function requireVerified(req, _res, next) {
    const verified = req.user?.emailVerified || req.user?.phoneNumberVerified;
    if (envConfig.env.REQUIRE_VERIFICATION && !verified && !shared.isStaff(req.user?.role)) {
      return next(
        new apiErrorUtils.ApiError(403, 'NOT_VERIFIED', 'Please verify your email or phone number first.'),
      );
    }
    next();
  }

  /** Requires an admin account. */
  function requireAdmin(req, res, next) {
    requireAuth(req, res, (err) => {
      if (err) return next(err);
      if (!shared.isStaff(req.user.role)) return next(apiErrorUtils.forbidden());
      next();
    });
  }

  /** Requires a signed-in user whose role has `permission` (see shared/permissions.js). */
  function requirePermission(permission) {
    return (req, res, next) => {
      if (!req.user) return requireAuth(req, res, next);
      if (!shared.can(req.user.role, permission)) return next(apiErrorUtils.forbidden());
      next();
    };
  }

  return { loadUser, requireAuth, requireVerified, requireAdmin, requirePermission };
})();

// --- middlewares/error.js ----------------------------------------------------------------------
const errorMiddleware = (() => {
  function notFoundHandler(req, _res, next) {
    next(new apiErrorUtils.ApiError(404, 'NOT_FOUND', `No route for ${req.method} ${req.path}`));
  }

  /** Turns any thrown error into the standard JSON error response. Must be the last middleware. */
  // Express recognises error handlers by their four parameters.
  function errorHandler(err, req, res, _next) {
    let error = err;
    if (err instanceof mongoose.Error.ValidationError) {
      const fields = Object.fromEntries(Object.entries(err.errors).map(([k, v]) => [k, v.message]));
      error = new apiErrorUtils.ApiError(400, 'VALIDATION_ERROR', 'Please check the highlighted fields.', {
        fields,
      });
    } else if (err instanceof mongoose.Error.CastError) {
      error = new apiErrorUtils.ApiError(400, 'BAD_REQUEST', `Invalid value for ${err.path}.`);
    } else if (err?.code === 11000) {
      error = new apiErrorUtils.ApiError(409, 'DUPLICATE', 'This already exists.', {
        keys: Object.keys(err.keyValue ?? {}),
      });
    } else if (err?.type === 'entity.too.large') {
      error = new apiErrorUtils.ApiError(413, 'TOO_LARGE', 'The request is too large.');
    } else if (err?.type === 'entity.parse.failed') {
      error = new apiErrorUtils.ApiError(400, 'BAD_JSON', 'The request body is not valid JSON.');
    }
    if (!(error instanceof apiErrorUtils.ApiError)) {
      loggerConfig.logger.error({ err, path: req.path }, 'Unhandled error');
      error = new apiErrorUtils.ApiError(500, 'SERVER_ERROR', 'Something went wrong. Please try again.');
    }
    res.status(error.status).json({
      error: {
        code: error.code,
        message: error.message,
        ...(error.details ? { details: error.details } : {}),
      },
    });
  }

  return { notFoundHandler, errorHandler };
})();

// --- middlewares/security.js -------------------------------------------------------------------
const securityMiddleware = (() => {
  const SAFE = new Set(['GET', 'HEAD', 'OPTIONS']);

  /**
   * CSRF defence in depth: state-changing requests that carry an Origin header must
   * come from one of our own front-ends. (Auth cookies are also SameSite=Lax.)
   */
  function originCheck(req, _res, next) {
    if (SAFE.has(req.method)) return next();
    const origin = req.get('origin');
    if (!origin) return next();
    const own = new URL(envConfig.env.API_PUBLIC_URL).origin;
    if (origin === own || envConfig.env.CORS_ORIGINS.includes(origin)) return next();
    next(apiErrorUtils.forbidden('BAD_ORIGIN', 'Request origin is not allowed.'));
  }

  /** Strips keys that could be read as MongoDB operators from JSON bodies. */
  function sanitizeBody(req, _res, next) {
    const clean = (v, depth = 0) => {
      if (depth > 12 || v === null || typeof v !== 'object') return v;
      if (Array.isArray(v)) return v.map((x) => clean(x, depth + 1));
      const out = {};
      for (const [k, val] of Object.entries(v)) {
        if (
          k.startsWith('$') ||
          k.includes('.') ||
          k === '__proto__' ||
          k === 'constructor' ||
          k === 'prototype'
        )
          continue;
        out[k] = clean(val, depth + 1);
      }
      return out;
    };
    if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) req.body = clean(req.body);
    next();
  }

  const limiter = (windowMs, limit) =>
    rateLimit({
      windowMs,
      limit,
      standardHeaders: 'draft-8',
      legacyHeaders: false,
      skip: () => envConfig.isTest,
      message: {
        error: { code: 'RATE_LIMITED', message: 'Too many requests. Please try again a little later.' },
      },
    });

  const authLimiter = limiter(15 * 60e3, 30);
  const otpLimiter = limiter(60 * 60e3, 10);
  const writeLimiter = limiter(60e3, 60);
  const apiLimiter = limiter(60e3, 300);

  return { originCheck, sanitizeBody, authLimiter, otpLimiter, writeLimiter, apiLimiter };
})();

// --- middlewares/validate.js -------------------------------------------------------------------
const validateMiddleware = (() => {
  /** Converts zod issues to `{ "field.path": "message" }`, keeping the first message per field. */
  function zodFields(error) {
    const fields = {};
    for (const issue of error.issues) {
      const key = issue.path.join('.') || '_';
      if (!fields[key]) fields[key] = issue.message;
    }
    return fields;
  }

  /** Parses `data` with a zod schema or throws a 400 VALIDATION_ERROR. */
  function parseOrThrow(schema, data) {
    const result = schema.safeParse(data ?? {});
    if (!result.success) throw apiErrorUtils.validationError(zodFields(result.error));
    return result.data;
  }

  /**
   * Route middleware that validates and normalises request input with zod schemas.
   * Parsed values replace `req.body`, `req.query` and `req.params`, so controllers
   * only ever see clean data.
   *
   * @example router.post('/login', validate({ body: loginSchema }), controller.login)
   */
  function validate({ body, query, params } = {}) {
    return (req, _res, next) => {
      if (params) req.params = parseOrThrow(params, req.params);
      // Express 5 exposes req.query as a getter, so it is redefined rather than assigned.
      if (query)
        Object.defineProperty(req, 'query', { value: parseOrThrow(query, req.query), writable: true });
      if (body) req.body = parseOrThrow(body, req.body);
      next();
    };
  }

  return { zodFields, parseOrThrow, validate };
})();

// ==============================================================================================
// CONTROLLERS
// ==============================================================================================

// --- controllers/account.controller.js ---------------------------------------------------------
const accountController = (() => {
  // The signed-in member's own account (/api/me).

  /** The signed-in account (role decides where the client sends the user: /admin or /dashboard). */
  function me(req, res) {
    res.json({ user: userSerializer.toUserDTO(req.user) });
  }

  async function dashboard(req, res) {
    res.json(await dashboardService.memberDashboard(req.user));
  }

  async function updateProfile(req, res) {
    res.json({ user: userSerializer.toUserDTO(await accountService.updateProfile(req.user, req.body)) });
  }

  async function deactivate(req, res) {
    await accountService.deactivate(req.user, req.body);
    res.json({ ok: true });
  }

  async function favorites(req, res) {
    res.json(await listService.listEntries('favorite', req.user, req.query));
  }

  async function dislikes(req, res) {
    res.json(await listService.listEntries('dislike', req.user, req.query));
  }

  async function favoritedMe(req, res) {
    res.json(await listService.favoritedMe(req.user, req.query));
  }

  async function unlocks(req, res) {
    res.json(await listService.unlockedContacts(req.user, req.query));
  }

  async function proposals(req, res) {
    res.json(await proposalService.listProposals(req.user, req.query, req.query));
  }

  async function respondToProposal(req, res) {
    res.json(await proposalService.respondToProposal(req.user, req.params.id, req.body));
  }

  async function withdrawProposal(req, res) {
    res.json(await proposalService.withdrawProposal(req.user, req.params.id));
  }

  async function notifications(req, res) {
    res.json(await notificationService.listNotifications(req.user._id, req.query));
  }

  async function markAllNotificationsRead(req, res) {
    await notificationService.markAllRead(req.user._id);
    res.json({ ok: true });
  }

  async function markNotificationRead(req, res) {
    await notificationService.markRead(req.user._id, req.params.id);
    res.json({ ok: true });
  }

  async function connections(req, res) {
    res.json(await connectionService.myConnections(req.user, req.query));
  }

  async function deleteNotification(req, res) {
    await notificationService.removeNotification(req.user._id, req.params.id);
    res.json({ ok: true });
  }

  return {
    me,
    dashboard,
    updateProfile,
    deactivate,
    favorites,
    dislikes,
    favoritedMe,
    unlocks,
    proposals,
    respondToProposal,
    withdrawProposal,
    notifications,
    markAllNotificationsRead,
    markNotificationRead,
    connections,
    deleteNotification,
  };
})();

// --- controllers/admin/billing.controller.js ---------------------------------------------------
const adminBillingController = (() => {
  async function payments(req, res) {
    res.json(await paymentService.listPayments(req.query, req.query));
  }

  async function verifyPayment(req, res) {
    res.json({
      payment: await paymentService.verifyPayment(req.params.id, requestUtils.requestContext(req)),
    });
  }

  async function rejectPayment(req, res) {
    res.json({
      payment: await paymentService.rejectPayment(
        req.params.id,
        req.body.reason,
        requestUtils.requestContext(req),
      ),
    });
  }

  async function refunds(req, res) {
    res.json(await refundService.listRefunds(req.query, req.query));
  }

  async function approveRefund(req, res) {
    await refundService.approveRefund(req.params.id, req.body, requestUtils.requestContext(req));
    res.json({ ok: true });
  }

  async function rejectRefund(req, res) {
    await refundService.rejectRefund(req.params.id, req.body.note, requestUtils.requestContext(req));
    res.json({ ok: true });
  }

  async function adjustConnections(req, res) {
    res.json(await connectionService.adjustConnections(req.body, requestUtils.requestContext(req)));
  }

  async function ledger(req, res) {
    res.json(await connectionService.listLedger(req.query, req.query));
  }

  async function packages(_req, res) {
    res.json({ items: await packageService.listPackages() });
  }

  async function createPackage(req, res) {
    res
      .status(201)
      .json({ package: await packageService.createPackage(req.body, requestUtils.requestContext(req)) });
  }

  async function updatePackage(req, res) {
    res.json({
      package: await packageService.updatePackage(req.params.id, req.body, requestUtils.requestContext(req)),
    });
  }

  async function removePackage(req, res) {
    await packageService.removePackage(req.params.id, requestUtils.requestContext(req));
    res.json({ ok: true });
  }

  return {
    payments,
    verifyPayment,
    rejectPayment,
    refunds,
    approveRefund,
    rejectRefund,
    adjustConnections,
    ledger,
    packages,
    createPackage,
    updatePackage,
    removePackage,
  };
})();

// --- controllers/admin/biodata.controller.js ---------------------------------------------------
const adminBiodataController = (() => {
  async function list(req, res) {
    res.json(await biodataReviewService.listBiodatas(req.query, req.query));
  }

  async function get(req, res) {
    res.json(await biodataReviewService.getBiodataForReview(req.params.id));
  }

  async function approve(req, res) {
    res.json({
      biodata: await biodataReviewService.approveBiodata(req.params.id, requestUtils.requestContext(req)),
    });
  }

  async function reject(req, res) {
    res.json({
      biodata: await biodataReviewService.rejectBiodata(
        req.params.id,
        req.body,
        requestUtils.requestContext(req),
      ),
    });
  }

  async function suspendEdit(req, res) {
    res.json({
      biodata: await biodataReviewService.setEditSuspension(
        req.params.id,
        req.body,
        requestUtils.requestContext(req),
      ),
    });
  }

  async function editSection(req, res) {
    res.json(
      await biodataReviewService.editSection(
        req.params.id,
        req.params.section,
        req.body.data,
        requestUtils.requestContext(req),
      ),
    );
  }

  async function block(req, res) {
    res.json({
      biodata: await biodataReviewService.setBlocked(
        req.params.id,
        req.body,
        requestUtils.requestContext(req),
      ),
    });
  }

  async function softDelete(req, res) {
    res.json({
      biodata: await biodataReviewService.softDelete(
        req.params.id,
        req.body.reason,
        requestUtils.requestContext(req),
      ),
    });
  }

  async function restore(req, res) {
    res.json({
      biodata: await biodataReviewService.restoreBiodata(
        req.params.id,
        req.body?.note,
        requestUtils.requestContext(req),
      ),
    });
  }

  async function restoreRequests(req, res) {
    res.json(await biodataReviewService.listRestoreRequests(req.query, req.query));
  }

  async function approveRestoreRequest(req, res) {
    await biodataReviewService.approveRestoreRequest(
      req.params.id,
      req.body?.note,
      requestUtils.requestContext(req),
    );
    res.json({ ok: true });
  }

  async function declineRestoreRequest(req, res) {
    await biodataReviewService.declineRestoreRequest(
      req.params.id,
      req.body ?? {},
      requestUtils.requestContext(req),
    );
    res.json({ ok: true });
  }

  return {
    list,
    get,
    approve,
    reject,
    suspendEdit,
    editSection,
    block,
    softDelete,
    restore,
    restoreRequests,
    approveRestoreRequest,
    declineRestoreRequest,
  };
})();

// --- controllers/admin/content.controller.js ---------------------------------------------------
const adminContentController = (() => {
  async function settings(_req, res) {
    res.json({ settings: await contentService.allSettings() });
  }

  async function updateSettings(req, res) {
    const { key } = req.params;
    res.json({
      key,
      value: await contentService.updateSettings(key, req.body.value, requestUtils.requestContext(req)),
    });
  }

  async function pages(_req, res) {
    res.json({ items: await contentService.listPages() });
  }

  async function page(req, res) {
    res.json({ page: await contentService.getPage(req.params.slug) });
  }

  async function upsertPage(req, res) {
    res.json({
      page: await contentService.upsertPage(req.params.slug, req.body, requestUtils.requestContext(req)),
    });
  }

  async function deletePage(req, res) {
    await contentService.deletePage(req.params.slug, requestUtils.requestContext(req));
    res.json({ ok: true });
  }

  async function faqs(_req, res) {
    res.json({ items: await contentService.listFaqs() });
  }

  async function createFaq(req, res) {
    res.status(201).json({ faq: await contentService.createFaq(req.body, requestUtils.requestContext(req)) });
  }

  async function updateFaq(req, res) {
    res.json({ faq: await contentService.updateFaq(req.params.id, req.body) });
  }

  async function deleteFaq(req, res) {
    await contentService.deleteFaq(req.params.id, requestUtils.requestContext(req));
    res.json({ ok: true });
  }

  async function marriageReports(req, res) {
    res.json(await storyService.listMarriageReports(req.query, req.query));
  }

  async function updateStory(req, res) {
    res.json({
      story: await storyService.updateStory(req.params.id, req.body, requestUtils.requestContext(req)),
    });
  }

  async function banners(_req, res) {
    res.json({ items: await bannerService.listBanners() });
  }

  async function createBanner(req, res) {
    res
      .status(201)
      .json({ banner: await bannerService.createBanner(req.body, requestUtils.requestContext(req)) });
  }

  async function updateBanner(req, res) {
    res.json({
      banner: await bannerService.updateBanner(req.params.id, req.body, requestUtils.requestContext(req)),
    });
  }

  async function deleteBanner(req, res) {
    await bannerService.deleteBanner(req.params.id, requestUtils.requestContext(req));
    res.json({ ok: true });
  }

  return {
    settings,
    updateSettings,
    pages,
    page,
    upsertPage,
    deletePage,
    faqs,
    createFaq,
    updateFaq,
    deleteFaq,
    marriageReports,
    updateStory,
    banners,
    createBanner,
    updateBanner,
    deleteBanner,
  };
})();

// --- controllers/admin/insights.controller.js --------------------------------------------------
const adminInsightsController = (() => {
  async function overview(req, res) {
    res.json(await analyticsService.adminOverview(req.user));
  }

  async function analytics(req, res) {
    res.json(await analyticsService.analytics(req.query.days));
  }

  async function auditLogs(req, res) {
    res.json(
      await auditService.listAuditLogs(
        req.query,
        paginationUtils.pageParams(req.query, { defaultLimit: 30 }),
      ),
    );
  }

  return { overview, analytics, auditLogs };
})();

// --- controllers/admin/moderation.controller.js ------------------------------------------------
const adminModerationController = (() => {
  async function reports(req, res) {
    res.json(await reportService.listReports(req.query, req.query));
  }

  async function updateReport(req, res) {
    await reportService.updateReport(req.params.id, req.body, requestUtils.requestContext(req));
    res.json({ ok: true });
  }

  async function tickets(req, res) {
    res.json(await ticketService.listTickets(req.query, req.query));
  }

  async function ticket(req, res) {
    res.json({ ticket: await ticketService.getTicket(req.params.id) });
  }

  async function replyToTicket(req, res) {
    res.json({
      ticket: await ticketService.staffReply(req.params.id, req.body, requestUtils.requestContext(req)),
    });
  }

  async function updateTicket(req, res) {
    res.json({
      ticket: await ticketService.updateTicket(req.params.id, req.body, requestUtils.requestContext(req)),
    });
  }

  async function contactMessages(req, res) {
    res.json(await ticketService.listContactMessages(req.query, req.query));
  }

  async function updateContactMessage(req, res) {
    await ticketService.setContactMessageStatus(req.params.id, req.body.status);
    res.json({ ok: true });
  }

  return {
    reports,
    updateReport,
    tickets,
    ticket,
    replyToTicket,
    updateTicket,
    contactMessages,
    updateContactMessage,
  };
})();

// --- controllers/admin/user.controller.js ------------------------------------------------------
const adminUserController = (() => {
  async function list(req, res) {
    res.json(await userService.listUsers(req.query, req.query));
  }

  async function get(req, res) {
    res.json(await userService.getUserDetail(req.params.id));
  }

  async function update(req, res) {
    res.json({
      user: await userService.updateUser(req.params.id, req.body, requestUtils.requestContext(req)),
    });
  }

  async function create(req, res) {
    res.status(201).json({ user: await userService.createUser(req.body, requestUtils.requestContext(req)) });
  }

  async function resetPassword(req, res) {
    await userService.resetUserPassword(req.params.id, req.body.password, requestUtils.requestContext(req));
    res.json({ ok: true });
  }

  return { list, get, update, create, resetPassword };
})();

// --- controllers/biodata.controller.js ---------------------------------------------------------
const biodataController = (() => {
  const VISITOR_COOKIE = 'gh_vid';
  const { ownerView } = biodataService;

  // ----- The member's own biodata (/api/biodatas/me) ------------------------------------

  async function getOwn(req, res) {
    const b = await biodataService.findOwn(req.user._id);
    res.json(b ? ownerView(b) : { biodata: null, completion: shared.biodataCompletion({}) });
  }

  async function createOwn(req, res) {
    res.status(201).json(ownerView(await biodataService.createOwn(req.user._id)));
  }

  async function saveSection(req, res) {
    const { biodata, statusChanged } = await biodataService.saveSection(
      req.user._id,
      req.params.section,
      req.body.data,
    );
    res.json({ ...ownerView(biodata), statusChanged });
  }

  async function submit(req, res) {
    res.json(ownerView(await biodataService.submitForReview(req.user._id)));
  }

  async function setVisibility(req, res) {
    res.json(ownerView(await biodataService.setHidden(req.user._id, req.body)));
  }

  async function softDelete(req, res) {
    res.json(
      ownerView(await biodataService.softDeleteOwn(req.user._id, req.body, requestUtils.requestContext(req))),
    );
  }

  async function getRestoreRequest(req, res) {
    res.json({ request: await biodataService.latestRestoreRequest(req.user._id) });
  }

  async function restoreOwn(req, res) {
    res.json(ownerView(await biodataService.restoreOwn(req.user._id)));
  }

  async function lookupPartner(req, res) {
    res.json({ partner: await biodataService.lookupPartner(req.query.no, req.user._id) });
  }

  async function requestRestore(req, res) {
    res.status(201).json({ request: await biodataService.requestRestore(req.user._id, req.body.reason) });
  }

  async function stats(req, res) {
    res.json(await biodataService.ownStats(req.user._id));
  }

  // ----- Public biodatas -----------------------------------------------------------------

  /**
   * Who is looking: `u:<userId>` for members, `v:<cookie id>` for anonymous visitors.
   * With `create`, an anonymous visitor without a cookie gets one.
   */
  function viewerKeyFor(req, res, { create = false } = {}) {
    if (req.user) return `u:${req.user._id}`;
    let vid = req.cookies?.[VISITOR_COOKIE];
    if (!visitService.isValidVisitorId(vid)) {
      if (!create) return null;
      vid = visitService.newVisitorId();
      res.cookie(VISITOR_COOKIE, vid, { httpOnly: true, sameSite: 'lax', maxAge: 400 * 864e5, path: '/' });
    }
    return `v:${vid}`;
  }

  async function search(req, res) {
    res.json(await searchService.searchBiodatas(req.query, req.user, viewerKeyFor(req, res)));
  }

  async function locationCounts(req, res) {
    res.json(await searchService.locationCounts(req.query, req.user));
  }

  async function featured(req, res) {
    res.json({ items: await searchService.featuredBiodatas(req.query.limit) });
  }

  async function getPublic(req, res) {
    const biodata = await biodataService.findPublic(req.params.no);
    const owner = await models.User.findById(biodata.user)
      .select('email emailVerified phoneNumberVerified')
      .lean();
    res.json({ biodata: biodataSerializer.toPublicDetail(biodata, owner) });
  }

  /** Counts a profile view: members by account, anonymous visitors by a long-lived cookie. */
  async function visit(req, res) {
    const b = await biodataService.findPublic(req.params.no);
    if (req.user && b.user.equals(req.user._id)) return res.json({ counted: false });
    res.json({ counted: await visitService.recordVisit(b, viewerKeyFor(req, res, { create: true })) });
  }

  async function viewerState(req, res) {
    res.json(await biodataService.viewerState(req.user, req.params.no));
  }

  async function unlock(req, res) {
    res.json(await connectionService.unlockContact(req.user, req.params.no));
  }

  const addFavorite = listAction('add', 'favorite');
  const removeFavorite = listAction('remove', 'favorite');
  const addDislike = listAction('add', 'dislike');
  const removeDislike = listAction('remove', 'dislike');

  function listAction(op, list) {
    return async (req, res) => {
      await (op === 'add' ? listService.addToList : listService.removeFromList)(
        list,
        req.user,
        req.params.no,
      );
      res.json({ ok: true });
    };
  }

  async function propose(req, res) {
    res
      .status(201)
      .json({ proposal: await proposalService.sendProposal(req.user, req.params.no, req.body.message) });
  }

  async function report(req, res) {
    res.status(201).json({ report: await reportService.reportBiodata(req.user, req.params.no, req.body) });
  }

  return {
    getOwn,
    createOwn,
    saveSection,
    submit,
    setVisibility,
    softDelete,
    getRestoreRequest,
    restoreOwn,
    lookupPartner,
    requestRestore,
    stats,
    search,
    locationCounts,
    featured,
    getPublic,
    visit,
    viewerState,
    unlock,
    addFavorite,
    removeFavorite,
    addDislike,
    removeDislike,
    propose,
    report,
  };
})();

// --- controllers/content.controller.js ---------------------------------------------------------
const contentController = (() => {
  async function stats(_req, res) {
    res.json(await contentService.publicStats());
  }

  async function settings(_req, res) {
    res.json(await contentService.publicSettings());
  }

  async function page(req, res) {
    res.json({ page: await contentService.publishedPage(req.params.slug) });
  }

  async function faqs(_req, res) {
    res.json({ items: await contentService.activeFaqs() });
  }

  async function successStories(_req, res) {
    res.json({ items: await storyService.publishedStories() });
  }

  async function banners(_req, res) {
    res.json({ items: await bannerService.activeBanners() });
  }

  async function downloadBanner(req, res) {
    res.json(await bannerService.downloadBanner(req.params.id));
  }

  return { stats, settings, page, faqs, successStories, banners, downloadBanner };
})();

// --- controllers/payment.controller.js ---------------------------------------------------------
const paymentController = (() => {
  async function catalogue(req, res) {
    res.json(await paymentService.catalogue(req.user));
  }

  async function create(req, res) {
    res
      .status(201)
      .json(await paymentService.createPayment(req.user, req.body, requestUtils.requestContext(req)));
  }

  /** Sends the member to their receipt page for the payment (or the connections page without one). */
  function redirectToReceipt(res, { status, invoiceNo }) {
    const target = invoiceNo
      ? `/dashboard/payment/${encodeURIComponent(invoiceNo)}?result=${status}`
      : `/dashboard/connections?payment=${status}`;
    res.redirect(303, `${envConfig.env.CLIENT_URL}${target}`);
  }

  /** bKash / Nagad send the customer back here (GET); we finish the payment and redirect. */
  async function gatewayCallback(req, res) {
    redirectToReceipt(res, await paymentService.completeGatewayCheckout(req.params.method, req.query));
  }

  /** SSLCommerz posts the result from the customer's browser; same handling as above. */
  async function gatewayReturn(req, res) {
    redirectToReceipt(res, await paymentService.completeGatewayCheckout(req.params.method, req.body ?? {}));
  }

  /** SSLCommerz's server-to-server notification; idempotent with the return above. */
  async function gatewayIpn(req, res) {
    const { status } = await paymentService.completeGatewayCheckout(req.params.method, req.body ?? {});
    res.json({ ok: true, status });
  }

  async function status(req, res) {
    res.json({ payment: await paymentService.paymentStatus(req.user, req.params.invoiceNo) });
  }

  async function mine(req, res) {
    res.json(await paymentService.myPayments(req.user, req.query));
  }

  async function requestRefund(req, res) {
    res.status(201).json({ refund: await refundService.requestRefund(req.user, req.body) });
  }

  async function myRefunds(req, res) {
    res.json({ items: await refundService.myRefunds(req.user) });
  }

  return {
    catalogue,
    create,
    gatewayCallback,
    gatewayReturn,
    gatewayIpn,
    status,
    mine,
    requestRefund,
    myRefunds,
  };
})();

// --- controllers/support.controller.js ---------------------------------------------------------
const supportController = (() => {
  async function list(req, res) {
    res.json(await ticketService.listMyTickets(req.user, req.query));
  }

  async function create(req, res) {
    res.status(201).json({ ticket: await ticketService.openTicket(req.user, req.body) });
  }

  async function get(req, res) {
    res.json({ ticket: await ticketService.getMyTicket(req.user, req.params.id) });
  }

  async function reply(req, res) {
    res.json({ ticket: await ticketService.replyToMyTicket(req.user, req.params.id, req.body) });
  }

  async function close(req, res) {
    res.json({ ticket: await ticketService.closeMyTicket(req.user, req.params.id) });
  }

  async function contact(req, res) {
    await ticketService.submitContactMessage(req.body, { user: req.user, ip: req.ip });
    res.status(201).json({ ok: true });
  }

  return { list, create, get, reply, close, contact };
})();

// ==============================================================================================
// ROUTES
// ==============================================================================================

// --- routes/account.routes.js ------------------------------------------------------------------
const accountRoutes = (() => {
  // The signed-in member's own account: /api/me
  const router = Router();
  router.use(authMiddleware.requireAuth);

  router.get('/', accountController.me);
  router.get('/dashboard', accountController.dashboard);
  router.patch(
    '/',
    validateMiddleware.validate({ body: accountValidation.updateProfile }),
    accountController.updateProfile,
  );
  router.delete(
    '/',
    validateMiddleware.validate({ body: accountValidation.deactivate }),
    accountController.deactivate,
  );

  router.get('/favorites', accountController.favorites);
  router.get('/dislikes', accountController.dislikes);
  router.get('/favorited-me', accountController.favoritedMe);
  router.get('/unlocks', accountController.unlocks);
  router.get('/connections', accountController.connections);

  router.get(
    '/proposals',
    validateMiddleware.validate({ query: accountValidation.proposalsQuery }),
    accountController.proposals,
  );
  router.post(
    '/proposals/:id/respond',
    validateMiddleware.validate({
      params: commonValidation.idParams,
      body: accountValidation.respondToProposal,
    }),
    accountController.respondToProposal,
  );
  router.post(
    '/proposals/:id/withdraw',
    validateMiddleware.validate({ params: commonValidation.idParams }),
    accountController.withdrawProposal,
  );

  router.get('/notifications', accountController.notifications);
  router.post('/notifications/read-all', accountController.markAllNotificationsRead);
  router.post(
    '/notifications/:id/read',
    validateMiddleware.validate({ params: commonValidation.idParams }),
    accountController.markNotificationRead,
  );
  router.delete(
    '/notifications/:id',
    validateMiddleware.validate({ params: commonValidation.idParams }),
    accountController.deleteNotification,
  );

  const __default = router;

  return __default;
})();

// --- routes/biodata.routes.js ------------------------------------------------------------------
const biodataRoutes = (() => {
  const router = Router();
  const member = [authMiddleware.requireAuth, authMiddleware.requireVerified];
  const byNumber = validateMiddleware.validate({ params: biodataValidation.biodataNoParams });

  // ----- The member's own biodata (registered before /:no so "me" is never read as a number) -----
  router.get('/me', authMiddleware.requireAuth, biodataController.getOwn);
  router.post(
    '/me',
    ...member,
    validateMiddleware.validate({ body: biodataValidation.createBiodata }),
    biodataController.createOwn,
  );
  router.put(
    '/me/sections/:section',
    ...member,
    securityMiddleware.writeLimiter,
    validateMiddleware.validate({
      params: biodataValidation.sectionParams,
      body: biodataValidation.saveSection,
    }),
    biodataController.saveSection,
  );
  router.post('/me/submit', ...member, biodataController.submit);
  router.patch(
    '/me/visibility',
    authMiddleware.requireAuth,
    validateMiddleware.validate({ body: biodataValidation.visibility }),
    biodataController.setVisibility,
  );
  router.delete(
    '/me',
    authMiddleware.requireAuth,
    validateMiddleware.validate({ body: biodataValidation.deleteBiodata }),
    biodataController.softDelete,
  );
  router.post('/me/restore', authMiddleware.requireAuth, biodataController.restoreOwn);
  router.get('/me/restore-request', authMiddleware.requireAuth, biodataController.getRestoreRequest);
  router.get(
    '/partner-lookup',
    authMiddleware.requireAuth,
    validateMiddleware.validate({ query: biodataValidation.partnerLookup }),
    biodataController.lookupPartner,
  );
  router.post(
    '/me/restore-request',
    authMiddleware.requireAuth,
    validateMiddleware.validate({ body: biodataValidation.restoreRequest }),
    biodataController.requestRestore,
  );
  router.get('/me/stats', authMiddleware.requireAuth, biodataController.stats);

  // ----- Public -----
  router.get(
    '/',
    validateMiddleware.validate({ query: biodataValidation.searchQuery }),
    biodataController.search,
  );
  router.get(
    '/featured',
    validateMiddleware.validate({ query: biodataValidation.featuredQuery }),
    biodataController.featured,
  );
  router.get(
    '/location-counts',
    validateMiddleware.validate({ query: biodataValidation.searchQuery }),
    biodataController.locationCounts,
  );
  router.get('/:no', byNumber, biodataController.getPublic);
  router.post('/:no/visit', byNumber, biodataController.visit);

  // ----- A member acting on someone else's biodata -----
  router.get('/:no/viewer', authMiddleware.requireAuth, byNumber, biodataController.viewerState);
  router.post('/:no/unlock', ...member, securityMiddleware.writeLimiter, byNumber, biodataController.unlock);
  router.post(
    '/:no/favorite',
    authMiddleware.requireAuth,
    securityMiddleware.writeLimiter,
    byNumber,
    biodataController.addFavorite,
  );
  router.delete('/:no/favorite', authMiddleware.requireAuth, byNumber, biodataController.removeFavorite);
  router.post(
    '/:no/dislike',
    authMiddleware.requireAuth,
    securityMiddleware.writeLimiter,
    byNumber,
    biodataController.addDislike,
  );
  router.delete('/:no/dislike', authMiddleware.requireAuth, byNumber, biodataController.removeDislike);
  router.post(
    '/:no/proposals',
    ...member,
    securityMiddleware.writeLimiter,
    byNumber,
    validateMiddleware.validate({ body: biodataValidation.proposal }),
    biodataController.propose,
  );
  router.post(
    '/:no/report',
    authMiddleware.requireAuth,
    securityMiddleware.writeLimiter,
    byNumber,
    validateMiddleware.validate({ body: biodataValidation.report }),
    biodataController.report,
  );

  const __default = router;

  return __default;
})();

// --- routes/content.routes.js ------------------------------------------------------------------
const contentRoutes = (() => {
  // Public site content: /api/public
  const router = Router();

  router.get('/stats', contentController.stats);
  router.get('/settings', contentController.settings);
  router.get(
    '/pages/:slug',
    validateMiddleware.validate({ params: adminValidation.pageParams }),
    contentController.page,
  );
  router.get('/faqs', contentController.faqs);
  router.get('/success-stories', contentController.successStories);
  router.get('/banners', contentController.banners);
  router.post(
    '/banners/:id/download',
    securityMiddleware.writeLimiter,
    validateMiddleware.validate({ params: commonValidation.idParams }),
    contentController.downloadBanner,
  );

  const __default = router;

  return __default;
})();

// --- routes/gateway.routes.js ------------------------------------------------------------------
const gatewayRoutes = (() => {
  // Payment gateway postbacks: /api/gateway. Mounted before the origin check (the
  // gateway's own page submits the form), so nothing here trusts the request: every
  // result is confirmed with the gateway's validation API before crediting.
  const router = Router();
  router.use(express.urlencoded({ extended: false, limit: '50kb' }));

  router.post(
    '/:method/return',
    validateMiddleware.validate({ params: paymentValidation.postbackParams }),
    paymentController.gatewayReturn,
  );
  router.post(
    '/:method/ipn',
    validateMiddleware.validate({ params: paymentValidation.postbackParams }),
    paymentController.gatewayIpn,
  );

  const __default = router;

  return __default;
})();

// --- routes/payment.routes.js ------------------------------------------------------------------
const paymentRoutes = (() => {
  const router = Router();

  router.get('/packages', paymentController.catalogue);
  router.post(
    '/payments',
    authMiddleware.requireAuth,
    authMiddleware.requireVerified,
    securityMiddleware.writeLimiter,
    validateMiddleware.validate({ body: paymentValidation.createPayment }),
    paymentController.create,
  );
  router.get('/payments/mine', authMiddleware.requireAuth, paymentController.mine);
  router.get(
    '/payments/status/:invoiceNo',
    authMiddleware.requireAuth,
    validateMiddleware.validate({ params: paymentValidation.invoiceParams }),
    paymentController.status,
  );
  router.get('/payments/:method/callback', paymentController.gatewayCallback);
  router.post(
    '/refunds',
    authMiddleware.requireAuth,
    securityMiddleware.writeLimiter,
    validateMiddleware.validate({ body: paymentValidation.requestRefund }),
    paymentController.requestRefund,
  );
  router.get('/refunds/mine', authMiddleware.requireAuth, paymentController.myRefunds);

  const __default = router;

  return __default;
})();

// --- routes/support.routes.js ------------------------------------------------------------------
const supportRoutes = (() => {
  const router = Router();

  router.get('/tickets', authMiddleware.requireAuth, supportController.list);
  router.post(
    '/tickets',
    authMiddleware.requireAuth,
    securityMiddleware.writeLimiter,
    validateMiddleware.validate({ body: supportValidation.createTicket }),
    supportController.create,
  );
  router.get(
    '/tickets/:id',
    authMiddleware.requireAuth,
    validateMiddleware.validate({ params: commonValidation.idParams }),
    supportController.get,
  );
  router.post(
    '/tickets/:id/messages',
    authMiddleware.requireAuth,
    securityMiddleware.writeLimiter,
    validateMiddleware.validate({ params: commonValidation.idParams, body: supportValidation.replyToTicket }),
    supportController.reply,
  );
  router.post(
    '/tickets/:id/close',
    authMiddleware.requireAuth,
    validateMiddleware.validate({ params: commonValidation.idParams }),
    supportController.close,
  );
  router.post(
    '/contact',
    securityMiddleware.writeLimiter,
    validateMiddleware.validate({ body: supportValidation.contactMessage }),
    supportController.contact,
  );

  const __default = router;

  return __default;
})();

// --- routes/admin/index.js ---------------------------------------------------------------------
const adminRoutes = (() => {
  // The admin panel API: /api/admin. Every route needs an admin account (role "admin");
  // each one also names the permission it requires (see shared/permissions.js).
  const router = Router();
  router.use(authMiddleware.requireAdmin);

  const id = validateMiddleware.validate({ params: commonValidation.idParams });

  // Overview, analytics, audit log
  router.get(
    '/overview',
    authMiddleware.requirePermission('overview.view'),
    adminInsightsController.overview,
  );
  router.get(
    '/analytics',
    authMiddleware.requirePermission('analytics.view'),
    validateMiddleware.validate({ query: adminValidation.analyticsQuery }),
    adminInsightsController.analytics,
  );
  router.get(
    '/audit-logs',
    authMiddleware.requirePermission('audit.view'),
    validateMiddleware.validate({ query: adminValidation.auditQuery }),
    adminInsightsController.auditLogs,
  );

  // Biodatas: review queue, edits, visibility, recovery queue
  router.get(
    '/biodatas',
    authMiddleware.requirePermission('biodata.review'),
    validateMiddleware.validate({ query: adminValidation.biodatasQuery }),
    adminBiodataController.list,
  );
  router.get(
    '/biodatas/:id',
    authMiddleware.requirePermission('biodata.review'),
    id,
    adminBiodataController.get,
  );
  router.post(
    '/biodatas/:id/approve',
    authMiddleware.requirePermission('biodata.review'),
    id,
    adminBiodataController.approve,
  );
  router.post(
    '/biodatas/:id/reject',
    authMiddleware.requirePermission('biodata.review'),
    id,
    validateMiddleware.validate({ body: adminValidation.rejectBiodata }),
    adminBiodataController.reject,
  );
  router.put(
    '/biodatas/:id/sections/:section',
    authMiddleware.requirePermission('biodata.edit'),
    validateMiddleware.validate({
      params: commonValidation.idParams.extend(biodataValidation.sectionParams.shape),
      body: biodataValidation.saveSection,
    }),
    adminBiodataController.editSection,
  );
  router.post(
    '/biodatas/:id/suspend-edit',
    authMiddleware.requirePermission('biodata.review'),
    id,
    validateMiddleware.validate({ body: adminValidation.suspendEdit }),
    adminBiodataController.suspendEdit,
  );
  router.post(
    '/biodatas/:id/block',
    authMiddleware.requirePermission('biodata.review'),
    id,
    validateMiddleware.validate({ body: adminValidation.blockBiodata }),
    adminBiodataController.block,
  );
  router.post(
    '/biodatas/:id/delete',
    authMiddleware.requirePermission('biodata.review'),
    id,
    validateMiddleware.validate({ body: adminValidation.deleteBiodata }),
    adminBiodataController.softDelete,
  );
  router.post(
    '/biodatas/:id/restore',
    authMiddleware.requirePermission('recovery.manage'),
    id,
    validateMiddleware.validate({ body: adminValidation.note }),
    adminBiodataController.restore,
  );
  router.get(
    '/restore-requests',
    authMiddleware.requirePermission('recovery.manage'),
    validateMiddleware.validate({ query: adminValidation.restoreRequestsQuery }),
    adminBiodataController.restoreRequests,
  );
  router.post(
    '/restore-requests/:id/approve',
    authMiddleware.requirePermission('recovery.manage'),
    id,
    validateMiddleware.validate({ body: adminValidation.note }),
    adminBiodataController.approveRestoreRequest,
  );
  router.post(
    '/restore-requests/:id/decline',
    authMiddleware.requirePermission('recovery.manage'),
    id,
    validateMiddleware.validate({ body: adminValidation.declineRestore }),
    adminBiodataController.declineRestoreRequest,
  );

  // Users and roles
  router.get(
    '/users',
    authMiddleware.requirePermission('users.view'),
    validateMiddleware.validate({ query: adminValidation.usersQuery }),
    adminUserController.list,
  );
  router.get('/users/:id', authMiddleware.requirePermission('users.view'), id, adminUserController.get);
  router.patch(
    '/users/:id',
    authMiddleware.requirePermission('users.manage'),
    id,
    validateMiddleware.validate({ body: adminValidation.updateUser }),
    adminUserController.update,
  );
  router.post(
    '/users',
    authMiddleware.requirePermission('users.manage'),
    validateMiddleware.validate({ body: adminValidation.createUser }),
    adminUserController.create,
  );
  router.post(
    '/users/:id/reset-password',
    authMiddleware.requirePermission('users.manage'),
    id,
    validateMiddleware.validate({ body: adminValidation.resetUserPassword }),
    adminUserController.resetPassword,
  );

  // Payments, refunds, connection adjustments, packages
  router.get(
    '/payments',
    authMiddleware.requirePermission('payments.manage'),
    validateMiddleware.validate({ query: paymentValidation.paymentsQuery }),
    adminBillingController.payments,
  );
  router.post(
    '/payments/:id/verify',
    authMiddleware.requirePermission('payments.manage'),
    id,
    adminBillingController.verifyPayment,
  );
  router.post(
    '/payments/:id/reject',
    authMiddleware.requirePermission('payments.manage'),
    id,
    validateMiddleware.validate({ body: paymentValidation.rejectPayment }),
    adminBillingController.rejectPayment,
  );
  router.get(
    '/refunds',
    authMiddleware.requirePermission('refunds.manage'),
    validateMiddleware.validate({ query: paymentValidation.refundsQuery }),
    adminBillingController.refunds,
  );
  router.post(
    '/refunds/:id/approve',
    authMiddleware.requirePermission('refunds.manage'),
    id,
    validateMiddleware.validate({ body: paymentValidation.approveRefund }),
    adminBillingController.approveRefund,
  );
  router.post(
    '/refunds/:id/reject',
    authMiddleware.requirePermission('refunds.manage'),
    id,
    validateMiddleware.validate({ body: paymentValidation.rejectRefund }),
    adminBillingController.rejectRefund,
  );
  router.post(
    '/connections/adjust',
    authMiddleware.requirePermission('connections.adjust'),
    validateMiddleware.validate({ body: paymentValidation.adjustConnections }),
    adminBillingController.adjustConnections,
  );
  router.get(
    '/connections/ledger',
    authMiddleware.requirePermission('connections.adjust'),
    validateMiddleware.validate({ query: paymentValidation.ledgerQuery }),
    adminBillingController.ledger,
  );
  router.get(
    '/packages',
    authMiddleware.requirePermission('packages.manage'),
    adminBillingController.packages,
  );
  router.post(
    '/packages',
    authMiddleware.requirePermission('packages.manage'),
    validateMiddleware.validate({ body: paymentValidation.createPackage }),
    adminBillingController.createPackage,
  );
  router.patch(
    '/packages/:id',
    authMiddleware.requirePermission('packages.manage'),
    id,
    validateMiddleware.validate({ body: paymentValidation.updatePackage }),
    adminBillingController.updatePackage,
  );
  router.delete(
    '/packages/:id',
    authMiddleware.requirePermission('packages.manage'),
    id,
    adminBillingController.removePackage,
  );

  // Reports, support tickets, contact form messages
  router.get(
    '/reports',
    authMiddleware.requirePermission('reports.manage'),
    validateMiddleware.validate({ query: supportValidation.reportsQuery }),
    adminModerationController.reports,
  );
  router.patch(
    '/reports/:id',
    authMiddleware.requirePermission('reports.manage'),
    id,
    validateMiddleware.validate({ body: supportValidation.updateReport }),
    adminModerationController.updateReport,
  );
  router.get(
    '/tickets',
    authMiddleware.requirePermission('tickets.manage'),
    validateMiddleware.validate({ query: supportValidation.ticketsQuery }),
    adminModerationController.tickets,
  );
  router.get(
    '/tickets/:id',
    authMiddleware.requirePermission('tickets.manage'),
    id,
    adminModerationController.ticket,
  );
  router.post(
    '/tickets/:id/messages',
    authMiddleware.requirePermission('tickets.manage'),
    id,
    validateMiddleware.validate({ body: supportValidation.staffReply }),
    adminModerationController.replyToTicket,
  );
  router.patch(
    '/tickets/:id',
    authMiddleware.requirePermission('tickets.manage'),
    id,
    validateMiddleware.validate({ body: supportValidation.updateTicket }),
    adminModerationController.updateTicket,
  );
  router.get(
    '/contact-messages',
    authMiddleware.requirePermission('tickets.manage'),
    validateMiddleware.validate({ query: supportValidation.contactMessagesQuery }),
    adminModerationController.contactMessages,
  );
  router.patch(
    '/contact-messages/:id',
    authMiddleware.requirePermission('tickets.manage'),
    id,
    validateMiddleware.validate({ body: supportValidation.updateContactMessage }),
    adminModerationController.updateContactMessage,
  );

  // Site settings, content pages, FAQs
  router.get(
    '/settings',
    authMiddleware.requirePermission('settings.manage'),
    adminContentController.settings,
  );
  router.put(
    '/settings/:key',
    authMiddleware.requirePermission('settings.manage'),
    validateMiddleware.validate({
      params: adminValidation.settingsParams,
      body: adminValidation.updateSettings,
    }),
    adminContentController.updateSettings,
  );
  router.get(
    '/marriage-reports',
    authMiddleware.requirePermission('content.manage'),
    validateMiddleware.validate({ query: adminValidation.storiesQuery }),
    adminContentController.marriageReports,
  );
  router.patch(
    '/marriage-reports/:id',
    authMiddleware.requirePermission('content.manage'),
    id,
    validateMiddleware.validate({ body: adminValidation.updateStory }),
    adminContentController.updateStory,
  );
  router.get('/banners', authMiddleware.requirePermission('content.manage'), adminContentController.banners);
  router.post(
    '/banners',
    authMiddleware.requirePermission('content.manage'),
    validateMiddleware.validate({ body: adminValidation.createBanner }),
    adminContentController.createBanner,
  );
  router.patch(
    '/banners/:id',
    authMiddleware.requirePermission('content.manage'),
    id,
    validateMiddleware.validate({ body: adminValidation.updateBanner }),
    adminContentController.updateBanner,
  );
  router.delete(
    '/banners/:id',
    authMiddleware.requirePermission('content.manage'),
    id,
    adminContentController.deleteBanner,
  );
  router.get('/pages', authMiddleware.requirePermission('content.manage'), adminContentController.pages);
  router.get(
    '/pages/:slug',
    authMiddleware.requirePermission('content.manage'),
    validateMiddleware.validate({ params: adminValidation.pageParams }),
    adminContentController.page,
  );
  router.put(
    '/pages/:slug',
    authMiddleware.requirePermission('content.manage'),
    validateMiddleware.validate({ params: adminValidation.pageParams, body: adminValidation.upsertPage }),
    adminContentController.upsertPage,
  );
  router.delete(
    '/pages/:slug',
    authMiddleware.requirePermission('content.manage'),
    validateMiddleware.validate({ params: adminValidation.pageParams }),
    adminContentController.deletePage,
  );
  router.get('/faqs', authMiddleware.requirePermission('content.manage'), adminContentController.faqs);
  router.post(
    '/faqs',
    authMiddleware.requirePermission('content.manage'),
    validateMiddleware.validate({ body: adminValidation.createFaq }),
    adminContentController.createFaq,
  );
  router.patch(
    '/faqs/:id',
    authMiddleware.requirePermission('content.manage'),
    id,
    validateMiddleware.validate({ body: adminValidation.updateFaq }),
    adminContentController.updateFaq,
  );
  router.delete(
    '/faqs/:id',
    authMiddleware.requirePermission('content.manage'),
    id,
    adminContentController.deleteFaq,
  );

  const __default = router;

  return __default;
})();

// --- routes/index.js ---------------------------------------------------------------------------
const apiRoutes = (() => {
  /** Every JSON endpoint, mounted under /api by app.js. See docs/API.md for the full reference. */
  const api = Router();

  api.use('/me', accountRoutes);
  api.use('/biodatas', biodataRoutes);
  api.use('/public', contentRoutes);
  api.use('/admin', adminRoutes);
  api.use(paymentRoutes); // /packages, /payments, /refunds
  api.use(supportRoutes); // /tickets, /contact

  const __default = api;

  return __default;
})();

// ==============================================================================================
// EXPRESS APPLICATION
// ==============================================================================================

// --- app.js ------------------------------------------------------------------------------------
const appModule = (() => {
  /**
   * Builds the Express application (without listening), so tests can use it directly.
   *
   * Request pipeline: security headers → CORS → logging → Better Auth (/api/auth) →
   * JSON body → body sanitising → origin check → rate limit → load user → routes → errors.
   */
  function createApp() {
    const app = express();
    app.disable('x-powered-by');
    app.set('trust proxy', envConfig.env.TRUST_PROXY);

    app.use(helmet({ crossOriginResourcePolicy: { policy: 'same-site' } }));
    app.use(cors({ origin: envConfig.env.CORS_ORIGINS, credentials: true }));
    if (!envConfig.isTest)
      app.use(
        pinoHttp({
          logger: loggerConfig.logger,
          autoLogging: { ignore: (req) => req.url === '/api/health' },
        }),
      );

    app.get('/api/health', (_req, res) => res.json({ ok: true, time: new Date().toISOString() }));

    // Better Auth reads the raw request itself, so it is mounted before the JSON parser.
    // It is created on first use, after the database connection is open.
    app.all('/api/auth/*splat', securityMiddleware.originCheck, securityMiddleware.apiLimiter, (req, res) =>
      toNodeHandler(authConfig.getAuth())(req, res),
    );
    // Payment gateways post form data from their own domain (see gateway.routes.js).
    app.use('/api/gateway', securityMiddleware.apiLimiter, gatewayRoutes);

    app.use(cookieParser());
    app.use(express.json({ limit: '200kb' }));
    app.use(securityMiddleware.sanitizeBody);
    app.use(
      '/api',
      securityMiddleware.originCheck,
      securityMiddleware.apiLimiter,
      authMiddleware.loadUser,
      apiRoutes,
    );

    app.use(errorMiddleware.notFoundHandler);
    app.use(errorMiddleware.errorHandler);
    return app;
  }

  return { createApp };
})();

// ==============================================================================================
// SEED DATA AND SEED SCRIPT
// ==============================================================================================

// --- scripts/seed-data/content.js --------------------------------------------------------------
const seedContent = (() => {
  // Default CMS content. Admins can edit all of it from the admin panel (Content).
  // Text in [square brackets] is a placeholder for details only the business can supply.

  const PACKAGES = [
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

  const PAGES = [
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

  const FAQS = [
    {
      question: { en: 'Is creating a biodata free?', bn: 'বায়োডাটা তৈরি করা কি বিনামূল্যে?' },
      answer: {
        en: "Yes. Creating, editing, browsing and filtering biodatas are always free. You only pay when you unlock a guardian's contact details.",
        bn: 'হ্যাঁ। বায়োডাটা তৈরি, সম্পাদনা, দেখা ও ফিল্টার করা সবসময় বিনামূল্যে। শুধু অভিভাবকের যোগাযোগ আনলক করতে খরচ হয়।',
      },
    },
    {
      question: {
        en: 'Which religions can use Ghotok?',
        bn: 'কোন কোন ধর্মের মানুষ ঘটক ব্যবহার করতে পারবেন?',
      },
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
      question: {
        en: 'Can I hide or delete my biodata?',
        bn: 'বায়োডাটা কি লুকিয়ে রাখা বা মুছে ফেলা যায়?',
      },
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

  return { PACKAGES, PAGES, FAQS };
})();

// --- scripts/seed-data/demo-people.js ----------------------------------------------------------
const seedPeople = (() => {
  // Demo people for local development and tests. Fictional names and numbers.

  // [type, religion, age, heightInches, district, education, profession, jobTitle, institution, name]
  const PEOPLE = [
    [
      'bride',
      'hindu',
      26,
      63,
      'dhaka',
      'masters',
      'private_job',
      'Marketing manager, Unilever Bangladesh',
      'MBA, University of Dhaka',
      'Ananya Saha',
    ],
    [
      'groom',
      'muslim',
      31,
      69,
      'chattogram',
      'bachelor',
      'engineer',
      'Software engineer, a fintech company',
      'B.Sc. in CSE, CUET',
      'Tanvir Ahmed',
    ],
    [
      'bride',
      'christian',
      29,
      62,
      'sylhet',
      'bachelor',
      'doctor',
      'Medical officer, Sylhet MAG Osmani Medical College Hospital',
      'MBBS, Sylhet MAG Osmani Medical College',
      'Grace Gomes',
    ],
    [
      'groom',
      'buddhist',
      34,
      67,
      'rangamati',
      'masters',
      'banker',
      'Senior officer, Sonali Bank',
      'M.A., University of Chittagong',
      'Pradip Chakma',
    ],
    [
      'bride',
      'muslim',
      24,
      61,
      'rajshahi',
      'bachelor',
      'student',
      'Final-year student',
      'B.Sc. in Pharmacy, University of Rajshahi',
      'Nusrat Jahan',
    ],
    [
      'groom',
      'hindu',
      30,
      70,
      'khulna',
      'masters',
      'teacher',
      'Lecturer, Khulna University',
      'M.Sc. in Physics, Khulna University',
      'Arindam Ghosh',
    ],
    [
      'bride',
      'muslim',
      27,
      64,
      'cumilla',
      'masters',
      'government_job',
      'Assistant commissioner (BCS admin)',
      'M.S.S. in Economics, Jahangirnagar University',
      'Farzana Akter',
    ],
    [
      'groom',
      'christian',
      32,
      68,
      'gazipur',
      'bachelor',
      'business',
      'Owner, a garments accessories business',
      'BBA, North South University',
      'Daniel D’Costa',
    ],
    [
      'bride',
      'buddhist',
      25,
      60,
      'bandarban',
      'bachelor',
      'teacher',
      'Primary school teacher',
      'B.A. (Hons) in English',
      'Mithila Marma',
    ],
    [
      'groom',
      'muslim',
      28,
      66,
      'barishal',
      'diploma',
      'private_job',
      'Electrical supervisor, Walton',
      'Diploma in Electrical Engineering',
      'Rakibul Islam',
    ],
    [
      'bride',
      'hindu',
      23,
      62,
      'mymensingh',
      'hsc',
      'student',
      'B.A. student',
      'HSC, Mymensingh Girls’ College',
      'Puja Debnath',
    ],
    [
      'groom',
      'hindu',
      35,
      69,
      'dhaka',
      'doctorate',
      'teacher',
      'Associate professor, BUET',
      'PhD in Civil Engineering',
      'Sourav Banerjee',
    ],
    [
      'bride',
      'muslim',
      30,
      63,
      'dhaka',
      'masters',
      'lawyer',
      'Advocate, Dhaka Judge Court',
      'LL.M., University of Dhaka',
      'Sadia Rahman',
    ],
    [
      'groom',
      'muslim',
      29,
      67,
      'sylhet',
      'bachelor',
      'abroad',
      'Accountant in the UK',
      'B.Com, Sylhet Govt. College',
      'Imran Chowdhury',
    ],
    [
      'bride',
      'christian',
      27,
      64,
      'barishal',
      'masters',
      'private_job',
      'HR executive, BRAC',
      'MBA in HRM, East West University',
      'Rina Baroi',
    ],
    [
      'groom',
      'buddhist',
      30,
      66,
      'chattogram',
      'bachelor',
      'government_job',
      'Sub-assistant engineer, LGED',
      'B.Sc. in Civil Engineering',
      'Sujan Barua',
    ],
    [
      'bride',
      'hindu',
      28,
      61,
      'jashore',
      'bachelor',
      'banker',
      'Officer, Pubali Bank',
      'BBA, University of Jashore',
      'Moumita Kundu',
    ],
    [
      'groom',
      'muslim',
      33,
      71,
      'rangpur',
      'masters',
      'armed_forces',
      'Major, Bangladesh Army',
      'M.Sc. in Military Studies',
      'Shahriar Hasan',
    ],
    [
      'bride',
      'muslim',
      26,
      62,
      'narayanganj',
      'bachelor',
      'freelancer',
      'UI designer (freelance)',
      'B.Sc. in CSE, Daffodil International University',
      'Tasnim Ferdous',
    ],
    [
      'groom',
      'hindu',
      27,
      68,
      'faridpur',
      'bachelor',
      'private_job',
      'Sales officer, Square Pharmaceuticals',
      'B.Pharm, Stamford University',
      'Rahul Mondal',
    ],
  ];

  const THIS_YEAR = new Date().getFullYear();
  const FIRST_GUARDIAN = [
    'Abdul',
    'Haripada',
    'Joseph',
    'Ratan',
    'Mizanur',
    'Nirmal',
    'Shafiqul',
    'Peter',
    'Ushainu',
    'Abul',
  ];

  function dobForAge(age, i) {
    const d = new Date();
    d.setUTCFullYear(d.getUTCFullYear() - age);
    d.setUTCMonth((i * 5) % 12, ((i * 7) % 27) + 1);
    d.setUTCDate(d.getUTCDate() - 40);
    return d.toISOString().slice(0, 10);
  }

  /** A real upazila of the district, varied by person. */
  function pickUpazila(district, i) {
    const list = shared.upazilasOf(district);
    return list[i % list.length].value;
  }

  function demoSections(
    [type, religion, age, height, district, education, profession, job, institution, name],
    i,
  ) {
    const bride = type === 'bride';
    const district2 = shared.DISTRICTS[(i * 11) % shared.DISTRICTS.length].value;
    const placeName = shared.DISTRICTS.find((x) => x.value === district).en;
    return {
      general: {
        biodataType: type,
        maritalStatus: i % 9 === 2 ? 'divorced' : 'never_married',
        religion,
        dateOfBirth: dobForAge(age, i),
        height,
        weight: bride ? 52 + (i % 8) : 64 + (i % 10),
        complexion: ['fair', 'wheatish', 'brown', 'very_fair'][i % 4],
        bloodGroup: ['A+', 'B+', 'O+', 'AB+'][i % 4],
        nationality: 'Bangladeshi',
      },
      address: {
        permanentDivision: shared.divisionOf(district),
        permanentDistrict: district,
        permanentUpazila: pickUpazila(district, i),
        presentLocation: profession === 'abroad' ? 'abroad' : 'bangladesh',
        ...(profession === 'abroad'
          ? { presentCountry: 'United Kingdom' }
          : {
              presentDistrict: i % 3 ? district : 'dhaka',
              presentUpazila: pickUpazila(i % 3 ? district : 'dhaka', i + 1),
            }),
        grewUpAt: `${placeName} town`,
      },
      education: {
        educationMedium: 'general',
        highestEducation: education,
        institution,
        subject: institution.split(',')[0],
        sscDetails: `${THIS_YEAR - age + 16}, Science, GPA 5.00`,
        hscDetails: `${THIS_YEAR - age + 18}, Science, GPA 5.00`,
      },
      family: {
        fatherName: `${FIRST_GUARDIAN[i % FIRST_GUARDIAN.length]} ${name.split(' ').slice(-1)[0]}`,
        fatherAlive: 'alive',
        fatherOccupation: ['Retired government officer', 'Businessman', 'Teacher', 'Farmer'][i % 4],
        motherName: 'Mrs. ' + name.split(' ').slice(-1)[0],
        motherAlive: i % 7 === 3 ? 'deceased' : 'alive',
        motherOccupation: i % 3 ? 'Homemaker' : 'School teacher',
        brothersCount: i % 3,
        brothersInfo: i % 3 ? 'Elder brother works in a private bank and is married.' : undefined,
        sistersCount: (i + 1) % 3,
        sistersInfo: (i + 1) % 3 ? 'Younger sister is a university student.' : undefined,
        economicStatus: ['middle', 'upper_middle', 'lower_middle', 'middle'][i % 4],
        economicDetails: 'Own house in the home district. Father has a monthly pension.',
        familyValues: 'A warm, practising family that values education and respect for elders.',
      },
      personal: {
        aboutMe: `I am ${bride ? 'a calm and caring person' : 'an honest and hard-working person'} who loves spending time with family. I enjoy reading, travelling and cooking on weekends.`,
        religiousPractice: 'I practise my faith regularly and respect every religion.',
        diet: religion === 'buddhist' && i % 2 ? 'vegetarian' : 'non_vegetarian',
        smoking: 'no',
        hobbies: 'Reading, gardening, travelling',
        languages: 'Bangla, English',
      },
      occupation: {
        profession,
        jobTitle: job,
        occupationDetails: `Has worked in this role for ${(i % 6) + 1} years.`,
        monthlyIncome: ['40k_70k', '70k_100k', '20k_40k', '100k_200k'][i % 4],
      },
      marriage: {
        guardiansAgree: 'yes',
        ...(i % 9 === 2
          ? {
              previousMarriage: 'Married in 2019; divorced by mutual consent in 2021. No children.',
              children: 'No children.',
            }
          : {}),
        careerAfterMarriage: bride
          ? 'I would like to continue my career after marriage.'
          : 'I support my partner continuing her studies or career.',
        residenceAfterMarriage: district === 'dhaka' ? 'In Dhaka.' : `In Dhaka or ${placeName}.`,
        thoughtsOnMarriage: 'Marriage is a lifelong partnership built on trust, respect and friendship.',
      },
      partner: {
        ageMin: bride ? age : Math.max(18, age - 8),
        ageMax: bride ? age + 7 : age,
        heightMin: bride ? 64 : 58,
        heightMax: bride ? 74 : 66,
        religions: [religion],
        maritalStatuses: ['never_married'],
        minEducation: 'bachelor',
        districts: [district, district2]
          .map((d) => shared.DISTRICTS.find((x) => x.value === d).en)
          .join(', '),
        profession: 'Any respectable profession',
        economicStatus: ['middle', 'upper_middle'],
        qualities: 'Kind, honest, family-oriented and respectful towards both families.',
      },
      pledge: { parentsKnow: 'yes', infoTrue: 'yes', acceptResponsibility: 'yes' },
      contact: {
        candidateName: name,
        guardianName: `${FIRST_GUARDIAN[i % FIRST_GUARDIAN.length]} ${name.split(' ').slice(-1)[0]}`,
        guardianRelation: 'father',
        guardianPhone: `017${String(10000000 + i * 7919).slice(0, 8)}`,
        contactEmail: `family${i + 1}@example.com`,
      },
    };
  }

  return { PEOPLE, demoSections };
})();

// --- scripts/seed.js ---------------------------------------------------------------------------
const seedScript = (() => {
  // Seeds the database.
  //   npm run seed        → the first admin, packages, pages and FAQs (safe to run repeatedly)
  //   npm run seed:demo   → the above plus demo users, biodatas, payments and support data
  //
  // Demo data is for local development only. Never run --demo against production.

  // The seed command reports its progress on the terminal.
  // eslint-disable-next-line no-console
  const log = (...a) => console.log('•', ...a);

  async function seedBase() {
    let admin = await models.User.findOne({ email: envConfig.env.SEED_ADMIN_EMAIL.toLowerCase() });
    if (!admin) {
      // Every other account starts as "user"; this one is made an admin directly.
      admin = await credentialsService.createPasswordAccount({
        name: envConfig.env.SEED_ADMIN_NAME,
        email: envConfig.env.SEED_ADMIN_EMAIL,
        password: envConfig.env.SEED_ADMIN_PASSWORD,
        role: 'admin',
        verified: true,
      });
      log(`Admin created: ${admin.email} (change the password after first login)`);
    } else {
      log(`Admin exists: ${admin.email} (role: ${admin.role})`);
    }

    if (!(await models.Package.exists({}))) {
      await models.Package.insertMany(seedContent.PACKAGES);
      log(
        `Packages created: ${seedContent.PACKAGES.map((p) => `${p.connections} for ৳${p.price}`).join(', ')}`,
      );
    }
    for (const page of seedContent.PAGES) {
      const exists = await models.Page.exists({ slug: page.slug });
      if (!exists) await models.Page.create(page);
    }
    log(`Pages ready: ${seedContent.PAGES.map((p) => p.slug).join(', ')}`);
    if (!(await models.Faq.exists({}))) {
      await models.Faq.insertMany(seedContent.FAQS);
      log(`FAQs created: ${seedContent.FAQS.length}`);
    }
    return admin;
  }

  // ---------------------------------------------------------------------------
  // Demo data
  // ---------------------------------------------------------------------------

  async function seedDemo(admin) {
    if (await models.User.exists({ email: 'demo1@example.com' })) {
      log('Demo data already present, skipping.');
      return;
    }
    const password = 'Demo@12345';
    const users = [];
    for (const [i, person] of seedPeople.PEOPLE.entries()) {
      const user = await credentialsService.createPasswordAccount({
        name: person[9],
        email: `demo${i + 1}@example.com`,
        phoneNumber: `018${String(20000000 + i * 104729).slice(0, 8)}`,
        password,
        verified: true,
      });
      users.push(user);
      const sections = seedPeople.demoSections(person, i);
      const errors = shared.validateBiodata(sections);
      if (Object.keys(errors).length)
        throw new Error(`Demo biodata ${i} is invalid: ${JSON.stringify(errors)}`);
      const status = i === 4 || i === 15 ? 'pending' : 'approved';
      const daysAgo = seedPeople.PEOPLE.length - i;
      await models.Biodata.create({
        user: user._id,
        biodataNo: `GH-${await models.nextSequence('biodata', 1000)}`,
        ...sections,
        status,
        submittedAt: new Date(Date.now() - (daysAgo + 1) * 864e5),
        ...(status === 'approved'
          ? {
              approvedAt: new Date(Date.now() - daysAgo * 864e5),
              firstApprovedAt: new Date(Date.now() - daysAgo * 864e5),
              reviewedBy: admin._id,
            }
          : {}),
        stats: { views: 40 + ((i * 37) % 300) },
      });
    }
    log(`Demo biodatas created: ${seedPeople.PEOPLE.length} (password for every demo account: Demo@12345)`);

    // A ready-to-use member account with a few connections and some history.
    const member = await credentialsService.createPasswordAccount({
      name: 'Demo Member',
      email: 'member@example.com',
      phoneNumber: '01911000000',
      password,
      verified: true,
    });
    const pkg = await models.Package.findOne({ connections: 5 });
    const verified = await models.Payment.create({
      invoiceNo: `INV-DEMO-${await models.nextSequence('invoice', 10000)}`,
      user: member._id,
      package: pkg._id,
      packageName: pkg.name,
      connections: pkg.connections,
      amount: pkg.price,
      method: 'bkash',
      mode: 'manual',
      senderNumber: '01911000000',
      trxId: 'DEMO8K2L1M',
      status: 'verified',
      reviewedBy: admin._id,
      reviewedAt: new Date(),
      creditedAt: new Date(),
    });
    await connectionService.changeBalance(member._id, pkg.connections, {
      type: 'purchase',
      payment: verified._id,
      actor: admin._id,
      reason: verified.invoiceNo,
    });

    // Payments waiting for verification.
    for (const [i, u] of users.slice(0, 3).entries()) {
      const p = i % 2 ? await models.Package.findOne({ connections: 3 }) : pkg;
      await models.Payment.create({
        invoiceNo: `INV-DEMO-${await models.nextSequence('invoice', 10000)}`,
        user: u._id,
        package: p._id,
        packageName: p.name,
        connections: p.connections,
        amount: p.price,
        method: ['bkash', 'nagad', 'rocket'][i],
        mode: 'manual',
        senderNumber: u.phoneNumber,
        trxId: `DEMO${i}TRX${i + 7}A`,
        status: 'pending',
      });
    }

    const biodatas = await models.Biodata.find().sort({ biodataNo: 1 });
    await models.Proposal.create({
      from: users[1]._id,
      fromBiodata: biodatas[1]._id,
      to: users[0]._id,
      toBiodata: biodatas[0]._id,
      message: 'Our family would like to know more about your family.',
    });
    await models.Proposal.create({
      from: users[0]._id,
      fromBiodata: biodatas[0]._id,
      to: users[5]._id,
      toBiodata: biodatas[5]._id,
      status: 'accepted',
      respondedAt: new Date(),
    });
    await models.Report.create({
      reporter: member._id,
      biodata: biodatas[7]._id,
      targetUser: users[7]._id,
      reason: 'wrong_contact',
      details: 'The guardian number was switched off for three days.',
    });
    await models.SupportTicket.create({
      ticketNo: `T-${await models.nextSequence('ticket', 1000)}`,
      user: member._id,
      subject: 'Payment not reflected yet',
      category: 'payment',
      messages: [
        {
          author: member._id,
          staff: false,
          body: 'I paid with bKash an hour ago but my connections are not added yet.',
        },
      ],
    });
    // A deleted biodata waiting in the recovery queue.
    const deleted = biodatas[9];
    deleted.deletedAt = new Date(Date.now() - 3 * 864e5);
    deleted.deleteReason = 'not_interested';
    await deleted.save();
    await models.RestoreRequest.create({
      biodata: deleted._id,
      user: users[9]._id,
      reason: 'I want to start looking again.',
    });
    // Two couples who married through Ghotok: one story published, one waiting for staff.
    const [bride, groom] = [biodatas[16], biodatas[17]];
    for (const b of [bride, groom]) {
      b.deletedAt = new Date(Date.now() - 20 * 864e5);
      b.deleteReason = 'married_via_ghotok';
      await b.save();
    }
    await models.MarriageReport.create({
      user: bride.user,
      biodata: bride._id,
      viaGhotok: true,
      marriedOn: new Date(Date.now() - 40 * 864e5),
      partnerBiodata: groom._id,
      story: 'Our families talked for two months before the wedding. Thank you, Ghotok.',
      shareStory: true,
      storyStatus: 'published',
      publishedStory:
        'Our families met through Ghotok and talked for two months. Both families felt at ease from the first visit. Thank you for making it simple and respectful.',
      publishedAt: new Date(Date.now() - 10 * 864e5),
    });
    await models.MarriageReport.create({
      user: groom.user,
      biodata: groom._id,
      viaGhotok: true,
      marriedOn: new Date(Date.now() - 40 * 864e5),
      partnerBiodata: bride._id,
      story: 'We found each other here. Our parents handled everything with great care.',
      shareStory: true,
    });
    await models.ContactMessage.create({
      name: 'Rahima Begum',
      phone: '01700000000',
      subject: 'Help creating a biodata',
      message: 'Can someone help my daughter fill in the biodata form?',
    });

    log('Demo member: member@example.com / Demo@12345 (5 connections)');
    log(`Admin: ${admin.email} (password from SEED_ADMIN_PASSWORD)`);
  }

  async function main() {
    const demo = process.argv.includes('--demo');
    if (demo && envConfig.isProd) throw new Error('Refusing to load demo data in production.');
    await dbConfig.connectDb();
    const admin = await seedBase();
    if (demo) await seedDemo(admin);
    await dbConfig.disconnectDb();
    log('Done.');
  }

  /** `node index.js seed [--demo]` */
  function runSeedCommand() {
    main().catch(async (err) => {
      console.error(err);
      await dbConfig.disconnectDb().catch(() => undefined);
      process.exit(1);
    });
  }

  return { seedBase, runSeedCommand };
})();

// ==============================================================================================
// START
// ==============================================================================================

const { createApp } = appModule;

/** Connects to MongoDB and starts listening; shuts down cleanly on SIGINT/SIGTERM. */
async function startServer() {
  await dbConfig.connectDb();
  const { env } = envConfig;
  const { logger } = loggerConfig;

  const server = createApp().listen(env.PORT, () => {
    logger.info(`Ghotok API listening on http://localhost:${env.PORT}`);
  });

  async function shutdown(signal) {
    logger.info({ signal }, 'Shutting down');
    server.close(async () => {
      await dbConfig.disconnectDb();
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  }

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

// Only when run as `node index.js ...`; importing this file (the tests do) starts nothing.
const runDirectly =
  Boolean(process.argv[1]) && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (runDirectly) {
  if (process.argv[2] === 'seed') seedScript.runSeedCommand();
  else await startServer();
}

export {
  createApp,
  envConfig,
  loggerConfig,
  dbConfig,
  sharedOptions,
  sharedLocations,
  sharedUpazilas,
  sharedBiodata,
  sharedPermissions,
  shared,
  apiErrorUtils,
  paginationUtils,
  requestUtils,
  stringsUtils,
  auditLogModel,
  bannerModel,
  biodataModel,
  connectionTransactionModel,
  contactMessageModel,
  contactUnlockModel,
  counterModel,
  dislikeModel,
  faqModel,
  favoriteModel,
  marriageReportModel,
  notificationModel,
  packageModel,
  pageModel,
  paymentModel,
  profileVisitModel,
  proposalModel,
  refundRequestModel,
  reportModel,
  restoreRequestModel,
  settingModel,
  supportTicketModel,
  userModel,
  models,
  devOutboxIntegration,
  emailIntegration,
  smsIntegration,
  bkashIntegration,
  nagadIntegration,
  sslcommerzIntegration,
  messaging,
  paymentGateways,
  authConfig,
  accountService,
  analyticsService,
  attachmentService,
  auditService,
  bannerService,
  biodataReviewService,
  biodataService,
  connectionService,
  contentService,
  credentialsService,
  dashboardService,
  listService,
  notificationService,
  packageService,
  paymentService,
  proposalService,
  refundService,
  reportService,
  searchService,
  settingsService,
  storyService,
  ticketService,
  userService,
  visitService,
  accountValidation,
  commonValidation,
  adminValidation,
  biodataValidation,
  paymentValidation,
  supportValidation,
  biodataSerializer,
  paymentSerializer,
  ticketSerializer,
  userSerializer,
  authMiddleware,
  errorMiddleware,
  securityMiddleware,
  validateMiddleware,
  accountController,
  adminBillingController,
  adminBiodataController,
  adminContentController,
  adminInsightsController,
  adminModerationController,
  adminUserController,
  biodataController,
  contentController,
  paymentController,
  supportController,
  accountRoutes,
  biodataRoutes,
  contentRoutes,
  gatewayRoutes,
  paymentRoutes,
  supportRoutes,
  adminRoutes,
  apiRoutes,
  appModule,
  seedContent,
  seedPeople,
  seedScript,
};
