import { z } from 'zod';
import { identifier, optionalEmail, optionalPhone, password } from './common.validation.js';

export const register = z.object({
  name: z.string().trim().min(2, 'Please enter your name.').max(80),
  email: optionalEmail,
  phone: optionalPhone,
  password,
  language: z.enum(['en', 'bn']).default('en'),
});

// "Remember me" (default on): off makes the session end when the browser closes.
const remember = z.boolean().default(true);

export const login = z.object({ identifier, password: z.string().min(1).max(128), remember });

export const loginCodeRequest = z.object({ identifier });

export const loginCodeVerify = z.object({
  identifier,
  code: z.string().trim().length(6, 'Enter the 6-digit code.'),
  remember,
});

/** Where to send the member after Google sign-in: a path on the website only. */
export const googleStart = z.object({
  next: z
    .string()
    .trim()
    .max(300)
    .regex(/^\/(?!\/)[^\s\\]*$/, 'Invalid return path')
    .optional()
    .catch(undefined),
  remember: z.enum(['0', '1']).optional().catch(undefined),
});

export const googleCallback = z.object({
  code: z.string().max(2000).optional(),
  state: z.string().max(200).optional(),
  error: z.string().max(200).optional(),
});

export const sessionParams = z.object({ id: z.string().uuid() });

export const verify = z.object({ identifier, code: z.string().trim().length(6, 'Enter the 6-digit code.') });

export const resendOtp = z.object({ identifier, purpose: z.enum(['verify', 'reset']).default('verify') });

export const forgotPassword = z.object({ identifier });

export const resetPassword = z.object({ identifier, code: z.string().trim().length(6), password });
