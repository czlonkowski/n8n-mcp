import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/browser', retries: 0, workers: 1,
  reporter: 'list', use: { baseURL: 'http://127.0.0.1:5173', trace: 'retain-on-failure' },
  webServer: { command: 'npm run dev', url: 'http://127.0.0.1:5173/lab.html', reuseExistingServer: !process.env.CI },
});
