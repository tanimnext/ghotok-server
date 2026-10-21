import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globalSetup: './test/global-setup.js',
    setupFiles: ['./test/setup.js'],
    env: {
      NODE_ENV: 'test',
      OTP_DEV_ECHO: 'true',
      REQUIRE_VERIFICATION: 'true',
      API_PUBLIC_URL: 'http://localhost:4000',
      CLIENT_URL: 'http://localhost:3000',
      BETTER_AUTH_URL: 'http://localhost:3000',
      CORS_ORIGINS: 'http://localhost:3000',
    },
    testTimeout: 30000,
    hookTimeout: 180000,
  },
});
