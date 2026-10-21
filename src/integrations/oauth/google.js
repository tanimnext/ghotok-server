import { env } from '../../config/env.js';

// Google sign-in (OAuth 2.0 authorization code flow with OpenID Connect).
// The ID token is checked by Google's tokeninfo endpoint, then its audience,
// issuer, expiry, nonce and verified-email flag are checked here.

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const TOKENINFO_URL = 'https://oauth2.googleapis.com/tokeninfo';
const ISSUERS = ['accounts.google.com', 'https://accounts.google.com'];

export const google = {
  get enabled() {
    return !!(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET);
  },

  redirectUri() {
    return `${env.API_PUBLIC_URL}/api/auth/google/callback`;
  },

  authorizationUrl({ state, nonce }) {
    const url = new URL(AUTH_URL);
    url.search = new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID,
      redirect_uri: this.redirectUri(),
      response_type: 'code',
      scope: 'openid email profile',
      state,
      nonce,
      prompt: 'select_account',
    }).toString();
    return url.toString();
  },

  /**
   * Exchanges the authorization code and returns the verified Google profile.
   * @returns {Promise<{ googleId: string, email: string, name: string }>}
   */
  async profileFromCode(code, nonce) {
    const tokenRes = await fetch(TOKEN_URL, {
      method: 'POST',
      body: new URLSearchParams({
        code,
        client_id: env.GOOGLE_CLIENT_ID,
        client_secret: env.GOOGLE_CLIENT_SECRET,
        redirect_uri: this.redirectUri(),
        grant_type: 'authorization_code',
      }),
      signal: AbortSignal.timeout(15000),
    });
    const tokens = await tokenRes.json().catch(() => ({}));
    if (!tokenRes.ok || !tokens.id_token)
      throw new Error(`Google token exchange failed (${tokenRes.status})`);

    const infoRes = await fetch(`${TOKENINFO_URL}?id_token=${encodeURIComponent(tokens.id_token)}`, {
      signal: AbortSignal.timeout(15000),
    });
    const info = await infoRes.json().catch(() => ({}));
    if (!infoRes.ok) throw new Error('Google rejected the ID token');
    const valid =
      info.aud === env.GOOGLE_CLIENT_ID &&
      ISSUERS.includes(info.iss) &&
      Number(info.exp) * 1000 > Date.now() &&
      info.nonce === nonce &&
      String(info.email_verified) === 'true' &&
      info.sub &&
      info.email;
    if (!valid) throw new Error('Google ID token failed verification');
    return {
      googleId: info.sub,
      email: String(info.email).toLowerCase(),
      name: info.name || info.email.split('@')[0],
    };
  },
};
