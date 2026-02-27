import { defineConfig } from '@playwright/test'

const isCI = !!process.env.CI

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false, // Electron tests should run serially
  forbidOnly: isCI,
  retries: isCI ? 2 : 0,
  workers: 1, // Electron tests need to run sequentially
  reporter: 'list',
  timeout: 60000,
  use: {
    trace: 'on-first-retry',
    // CI environments often need longer timeouts for Electron startup
    launchOptions: {
      timeout: isCI ? 60000 : 30000,
    },
  },
  projects: [
    {
      name: 'electron',
      testMatch: '**/*.spec.ts',
    },
  ],
})
