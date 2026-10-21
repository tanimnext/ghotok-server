import jwt from 'jsonwebtoken';
import { env } from '../../config/env.js';

// Short-lived signed tickets used by the upload flow:
// - "ticket": proves an uploaded image/key was issued to this user (checked when attaching it),
// - "put": authorises one local upload (development driver),
// - "get": authorises reading one local file (development driver).
export function signUploadToken(payload, expiresIn = '15m') {
  return jwt.sign(payload, env.JWT_UPLOAD_SECRET, { expiresIn, issuer: 'ghotok-upload' });
}

export function verifyUploadToken(token, kind) {
  try {
    const payload = jwt.verify(token, env.JWT_UPLOAD_SECRET, { issuer: 'ghotok-upload' });
    return payload.kind === kind ? payload : null;
  } catch {
    return null;
  }
}
