import { z } from 'zod';

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

export const env = load();
export const isProd = env.NODE_ENV === 'production';
export const isTest = env.NODE_ENV === 'test';
