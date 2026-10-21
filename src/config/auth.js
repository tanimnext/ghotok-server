import { betterAuth } from 'better-auth';
import { mongodbAdapter } from 'better-auth/adapters/mongodb';
import { APIError } from 'better-auth/api';
import { emailOTP, phoneNumber } from 'better-auth/plugins';
import mongoose from 'mongoose';
import { deliver } from '../integrations/messaging/index.js';
import { recordDevCode } from '../integrations/messaging/dev-outbox.js';
import { isValidPhone, normalizePhone } from '../shared/index.js';
import { env } from './env.js';

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
  recordDevCode(to, code);
  return deliver(to, {
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
    baseURL: env.BETTER_AUTH_URL,
    basePath: '/api/auth',
    secret: env.BETTER_AUTH_SECRET,
    trustedOrigins: env.CORS_ORIGINS,
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
      env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET
        ? { google: { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET } }
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
        phoneNumberValidator: (value) => value === normalizePhone(value) && isValidPhone(value),
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
      useSecureCookies: env.COOKIE_SECURE,
      ipAddress: { ipAddressHeaders: ['x-forwarded-for'] },
    },
    rateLimit: { enabled: env.NODE_ENV === 'production', window: 60, max: 100 },
  });
}

let instance;

/**
 * The Better Auth instance, created on first use (after Mongoose has connected,
 * because the adapter needs the database handle).
 */
export function getAuth() {
  if (!mongoose.connection.db) throw new Error('Connect to MongoDB before using auth.');
  instance ??= createAuth();
  return instance;
}
