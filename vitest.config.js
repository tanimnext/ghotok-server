import os from 'node:os';
import path from 'node:path';
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
      STORAGE_DRIVER: 'local',
      UPLOAD_DIR: path.join(os.tmpdir(), 'ghotok-test-uploads'),
      API_PUBLIC_URL: 'http://localhost:4000',
      WEB_URL: 'http://localhost:3000',
    },
    testTimeout: 30000,
    hookTimeout: 180000,
  },
});
