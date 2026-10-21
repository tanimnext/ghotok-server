import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { isTest } from '../config/env.js';

const BCRYPT_ROUNDS = isTest ? 4 : 12;

export const hashPassword = (password) => bcrypt.hash(password, BCRYPT_ROUNDS);
export const verifyPassword = (password, hash) => (hash ? bcrypt.compare(password, hash) : false);
export const sha256 = (value) => crypto.createHash('sha256').update(String(value)).digest('hex');
export const randomToken = (bytes = 48) => crypto.randomBytes(bytes).toString('base64url');
