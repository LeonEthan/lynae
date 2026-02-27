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

const __dirname = path.dirname(fileURLToPath(import.meta.url))

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

  // Session management IPC handlers
  ipcMain.handle('sessions:get', () => getSessions())
  ipcMain.handle('sessions:create', (_, req) => createSession(req))
  ipcMain.handle('sessions:switch', (_, sessionId) => switchSession(sessionId))
  ipcMain.handle('sessions:delete', (_, sessionId) => deleteSession(sessionId))

  // Legacy placeholder
  ipcMain.handle('ping', () => 'pong')

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
