import { defineConfig } from '@playwright/test';
import base from './playwright.config';

// An isolated online-mode entry smoke: no real Auth/DB settings or external mail.
export default defineConfig({ ...base, testIgnore: [], testMatch: 'online-entry.spec.ts',
  webServer: { command: 'npm run start', url: 'http://127.0.0.1:3210', reuseExistingServer: false,
    env: { ZEIRISHI_SUPABASE_ENABLED: '1', ZEIRISHI_FIXTURE_MODE: '0', ZEIRISHI_DATABASE_ENABLED: '0',
      SUPABASE_URL: '', SUPABASE_PUBLISHABLE_KEY: '', ZEIRISHI_APP_ORIGIN: '' }, timeout: 120000 },
});
