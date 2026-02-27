import { app, BrowserWindow, ipcMain } from 'electron'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  createSession,
  deleteSession,
  getSessions,
  initMockSessions,
  switchSession,
} from './sessions'
import {
  generateSimulatedEvents,
  generateSimulatedStream,
  getEventsBySession,
  replayEvents,
  respondToApproval,
  subscribeToEventStream,
  __resetEvents,
} from './events'
import type { EventReplayOptions, IPCError, IPCResponse, IPCErrorCode } from '../types'
import { isIPCError, IPCErrorException } from '../types'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// ============================================================================
// IPC Error Handler Wrapper
// ============================================================================

function handleIPCError(error: unknown): IPCError {
  console.error('IPC Error:', error)

  if (error instanceof IPCErrorException) {
    return error.toJSON()
  }

  if (error instanceof Error) {
    return {
      code: 'INTERNAL_ERROR',
      message: error.message,
      details: { stack: error.stack },
    }
  }

  return {
    code: 'INTERNAL_ERROR',
    message: 'An unknown error occurred',
    details: { error },
  }
}

async function wrapIPCHandler<T>(handler: () => Promise<T>): Promise<IPCResponse<T>> {
  try {
    const data = await handler()
    return { success: true, data }
  } catch (error) {
    return { success: false, error: handleIPCError(error) }
  }
}

function wrapSyncIPCHandler<T>(handler: () => T): IPCResponse<T> {
  try {
    const data = handler()
    return { success: true, data }
  } catch (error) {
    return { success: false, error: handleIPCError(error) }
  }
}

function createWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    titleBarStyle: 'hiddenInset',
    show: false,
  })

  // Load the renderer
  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL)
    mainWindow.webContents.openDevTools()
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'))
  }

  mainWindow.once('ready-to-show', () => {
    mainWindow.show()
  })
}

app.whenReady().then(() => {
  // Initialize mock sessions for PR-02
  initMockSessions()

  // Session management IPC handlers with error handling
  ipcMain.handle('sessions:get', () => wrapSyncIPCHandler(getSessions))
  ipcMain.handle('sessions:create', async (_, req) => wrapIPCHandler(async () => createSession(req)))
  ipcMain.handle('sessions:switch', async (_, sessionId) =>
    wrapIPCHandler(async () => {
      switchSession(sessionId)
    })
  )
  ipcMain.handle('sessions:delete', async (_, sessionId) =>
    wrapIPCHandler(async () => {
      deleteSession(sessionId)
    })
  )

  // Event replay IPC handlers (PR-03) with error handling
  ipcMain.handle('events:replay', async (_, options: EventReplayOptions) =>
    wrapIPCHandler(async () => replayEvents(options))
  )
  ipcMain.handle('events:getBySession', async (_, { sessionId, options }) =>
    wrapIPCHandler(async () => getEventsBySession(sessionId, options))
  )

  // Approval IPC handlers (PR-03) with error handling
  ipcMain.handle('approval:respond', async (_, { approvalId, approved, reason }) =>
    wrapIPCHandler(async () => {
      respondToApproval(approvalId, approved, reason)
    })
  )

  // Legacy placeholder
  ipcMain.handle('ping', () => 'pong')

  // Set up event stream broadcasting (PR-03)
  subscribeToEventStream((event) => {
    // Broadcast to all windows
    const windows = BrowserWindow.getAllWindows()
    windows.forEach(window => {
      window.webContents.send('event:stream', event)
    })
  })

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
