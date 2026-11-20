import { defineConfig } from '@playwright/test';
const serveDist=process.env.DRAG_TEST_DIST==='1';
const distPort=process.env.DRAG_TEST_PORT||'4173';
const baseURL=process.env.DRAG_TEST_URL||(serveDist?`http://127.0.0.1:${distPort}`:'http://127.0.0.1:5173');
export default defineConfig({
  outputDir: process.env.DRAG_TEST_OUTPUT || 'test-results',
  testDir: './tests', testMatch: '**/*.spec.js',
  timeout: 30000, workers: 1, fullyParallel: false,
  reporter: [['list'], ['json', { outputFile: process.env.DRAG_TEST_JSON || 'test-results/results.json' }], ['html', { open: 'never', outputFolder: process.env.DRAG_TEST_REPORT || 'playwright-report' }]],
  use: {
    browserName: process.env.DRAG_BROWSER || 'chromium',
    timezoneId: process.env.DRAG_TIMEZONE || 'Asia/Taipei',
    baseURL,
    viewport: { width: 1440, height: 1000 },
    screenshot: 'only-on-failure', trace: 'retain-on-failure',
    launchOptions: process.env.DRAG_CHROME_PATH ? { executablePath: process.env.DRAG_CHROME_PATH } : {},
  },
  webServer: process.env.DRAG_TEST_URL ? undefined : {
    command: serveDist ? `${process.platform === 'win32' ? 'python' : 'python3'} scripts/serve.py --port ${distPort}` : `"${process.execPath}" node_modules/vite/bin/vite.js --host 127.0.0.1`,
    url: baseURL, reuseExistingServer: !process.env.CI,
  },
});
