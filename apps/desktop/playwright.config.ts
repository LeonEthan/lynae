import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false, // Electron tests should run serially
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1, // Electron tests need to run sequentially
  reporter: 'list',
  timeout: 60000,
  use: {
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'electron',
      testMatch: '**/*.spec.ts',
    },
  ],
})
