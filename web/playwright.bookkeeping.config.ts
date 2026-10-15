import { defineConfig } from '@playwright/test';
import base from './playwright.config';
export default defineConfig({ ...base, testIgnore: [], testMatch:'bookkeeping-mvp.spec.ts', webServer: {command:'npm run start',url:'http://127.0.0.1:3210',reuseExistingServer:false,env:{ZEIRISHI_FIXTURE_MODE:'1',ZEIRISHI_BOOKKEEPING_MVP:'1',ZEIRISHI_SUPABASE_ENABLED:'0',ZEIRISHI_DATABASE_ENABLED:'0',ZEIRISHI_LOCAL_CLI_PROVIDER:''},timeout:120000} });
