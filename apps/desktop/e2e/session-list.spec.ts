import { test, expect, type ElectronApplication } from '@playwright/test'
import { _electron as electron } from '@playwright/test'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// Check if we're in a CI or restricted environment where Electron may not launch
const isCI = !!process.env.CI
const isRestrictedEnvironment = isCI || process.env.ELECTRON_SKIP_TEST === '1'

// Skip all tests in restricted environments at file level
test.skip(isRestrictedEnvironment, 'Electron E2E tests skipped in restricted environment')

test.describe('Session List E2E', () => {
  let electronApp: ElectronApplication | null = null

  test.beforeEach(async () => {
    const args = [path.join(__dirname, '../dist/main/index.js')]

    // Add sandbox-disabling flags for CI/container environments
    if (isCI) {
      args.push(
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu'
      )
    }

    electronApp = await electron.launch({
      args,
      env: {
        ...process.env,
        NODE_ENV: 'test',
      },
    })
  })

  test.afterEach(async () => {
    if (electronApp) {
      await electronApp.close()
      electronApp = null
    }
  })

  test('keyboard navigation - tab through session list elements', async () => {
    const window = await electronApp!.firstWindow()

    // Wait for the app to load
    await window.waitForSelector('.session-list')

    // Get initial focus
    await window.keyboard.press('Tab')

    // Tab to create button
    const createBtn = window.locator('.new-session-btn')
    await expect(createBtn).toBeFocused()

    // Tab to first session select button
    await window.keyboard.press('Tab')
    const firstSessionBtn = window.locator('.session-content').first()
    await expect(firstSessionBtn).toBeFocused()

    // Tab to first session delete button
    await window.keyboard.press('Tab')
    const firstDeleteBtn = window.locator('.delete-btn').first()
    await expect(firstDeleteBtn).toBeFocused()
  })

  test('keyboard navigation - activate with Enter key', async () => {
    const window = await electronApp!.firstWindow()
    await window.waitForSelector('.session-list')

    // Tab to create button
    await window.keyboard.press('Tab')

    // Press Enter to create new session
    await window.keyboard.press('Enter')

    // Wait for new session to appear
    const sessions = window.locator('.session-item')
    await expect(sessions).toHaveCount(3) // 2 initial + 1 new

    // Verify new session is active (prepended, so it's first)
    const newSession = sessions.first()
    await expect(newSession).toHaveClass(/active/)
  })

  test('keyboard navigation - activate with Space key', async () => {
    const window = await electronApp!.firstWindow()
    await window.waitForSelector('.session-list')

    // Tab to create button
    await window.keyboard.press('Tab')

    // Press Space to create new session
    await window.keyboard.press('Space')

    // Wait for new session to appear
    const sessions = window.locator('.session-item')
    await expect(sessions).toHaveCount(3)
  })

  test('keyboard navigation - switch sessions', async () => {
    const window = await electronApp!.firstWindow()
    await window.waitForSelector('.session-list')

    // Get all session items
    const sessions = window.locator('.session-item')
    const firstSession = sessions.first()
    const secondSession = sessions.nth(1)

    // Initially first session should be active
    await expect(firstSession).toHaveClass(/active/)

    // Tab to first session's select button and press Enter
    await window.keyboard.press('Tab') // create button
    await window.keyboard.press('Tab') // first session select
    await window.keyboard.press('Enter')

    // First session should still be active
    await expect(firstSession).toHaveClass(/active/)

    // Tab to delete button of first session
    await window.keyboard.press('Tab')

    // Tab to second session's select button
    await window.keyboard.press('Tab')
    await window.keyboard.press('Enter')

    // Second session should now be active
    await expect(secondSession).toHaveClass(/active/)
    await expect(firstSession).not.toHaveClass(/active/)
  })

  test('keyboard navigation - delete with Enter key', async () => {
    const window = await electronApp!.firstWindow()
    await window.waitForSelector('.session-list')

    // Tab to create button
    await window.keyboard.press('Tab')

    // Tab to first session select button
    await window.keyboard.press('Tab')

    // Tab to delete button
    await window.keyboard.press('Tab')

    // Press Enter to delete
    await window.keyboard.press('Enter')

    // Wait for session to be removed
    const sessions = window.locator('.session-item')
    await expect(sessions).toHaveCount(1)
  })

  test('mouse interaction - click to select session', async () => {
    const window = await electronApp!.firstWindow()
    await window.waitForSelector('.session-list')

    const sessions = window.locator('.session-item')
    const secondSession = sessions.nth(1)

    // Click on second session
    await secondSession.locator('.session-content').click()

    // Second session should be active
    await expect(secondSession).toHaveClass(/active/)
  })

  test('mouse interaction - click to delete session', async () => {
    const window = await electronApp!.firstWindow()
    await window.waitForSelector('.session-list')

    const initialSessions = window.locator('.session-item')
    await expect(initialSessions).toHaveCount(2)

    // Click delete on first session
    await initialSessions.first().locator('.delete-btn').click()

    // Wait for deletion
    const remainingSessions = window.locator('.session-item')
    await expect(remainingSessions).toHaveCount(1)
  })

  test('mouse interaction - click to create session', async () => {
    const window = await electronApp!.firstWindow()
    await window.waitForSelector('.session-list')

    // Click create button
    await window.locator('.new-session-btn').click()

    // New session should appear
    const sessions = window.locator('.session-item')
    await expect(sessions).toHaveCount(3)

    // New session should be active and at the top
    const firstSession = sessions.first()
    await expect(firstSession).toHaveClass(/active/)
  })

  test('focus management - maintains logical tab order', async () => {
    const window = await electronApp!.firstWindow()
    await window.waitForSelector('.session-list')

    // Tab through all interactive elements
    const focusedElements: string[] = []

    for (let i = 0; i < 5; i++) {
      await window.keyboard.press('Tab')
      const focused = await window.evaluate(() => {
        const el = document.activeElement
        return el?.getAttribute('aria-label') || el?.className || 'unknown'
      })
      focusedElements.push(focused)
    }

    // Verify tab order includes our key elements
    expect(focusedElements).toContain('Create new session')
    expect(focusedElements.some((el) => el.includes('Select session'))).toBe(true)
    expect(focusedElements.some((el) => el.includes('Delete session'))).toBe(true)
  })

  test('accessibility - buttons have correct roles and labels', async () => {
    const window = await electronApp!.firstWindow()
    await window.waitForSelector('.session-list')

    // Check create button
    const createBtn = window.locator('.new-session-btn')
    await expect(createBtn).toHaveAttribute('aria-label', 'Create new session')

    // Check session buttons
    const selectBtns = window.locator('.session-content')
    const firstSelectBtn = selectBtns.first()
    await expect(firstSelectBtn).toHaveAttribute('aria-label', /Select session/)

    const deleteBtns = window.locator('.delete-btn')
    const firstDeleteBtn = deleteBtns.first()
    await expect(firstDeleteBtn).toHaveAttribute('aria-label', /Delete session/)
  })
})
