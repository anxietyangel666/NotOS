const { app, BrowserWindow, dialog, ipcMain, desktopCapturer, session, globalShortcut, shell, screen, nativeImage, clipboard } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');

const isDev = !app.isPackaged;
const appIconFile = process.platform === 'win32' ? 'app-icon.ico' : 'app-icon.png';
const appIconPath = isDev
  ? path.join(__dirname, '..', 'public', 'Emoji', appIconFile)
  : path.join(__dirname, '..', 'dist', 'Emoji', appIconFile);
const APP_USER_MODEL_ID = 'local.notoc.client';
const DEFAULT_ZOOM_FACTOR = 0.67;
const YOUTUBE_EMBED_REFERRER = 'https://www.youtube.com/';
const taskbarBadgeCache = new Map();
const taskbarBadgeDir = path.join(__dirname, 'badges');
const YOUTUBE_REQUEST_FILTER = {
  urls: [
    '*://*.youtube.com/*',
    '*://*.youtube-nocookie.com/*',
    '*://*.googlevideo.com/*',
    '*://*.ytimg.com/*',
    '*://*.ggpht.com/*',
    '*://*.google.com/*'
  ]
};

function taskbarBadgeLabel(count) {
  const value = Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0;
  if (value <= 0) return '';
  return value > 9 ? '9+' : String(value);
}

function createTaskbarBadge(label) {
  const cached = taskbarBadgeCache.get(label);
  if (cached) return cached;

  const file = label === '9+' ? 'badge-9-plus.png' : `badge-${label}.png`;
  const image = nativeImage.createFromPath(path.join(taskbarBadgeDir, file));
  taskbarBadgeCache.set(label, image);
  return image;
}

function setTaskbarUnreadBadge(window, count) {
  const label = taskbarBadgeLabel(count);
  if (process.platform === 'win32') {
    window.setOverlayIcon(label ? createTaskbarBadge(label) : null, label ? `${label} unread notifications` : '');
    return;
  }
  app.setBadgeCount(label ? Math.max(1, Math.floor(count)) : 0);
}

if (process.platform === 'win32') {
  app.setAppUserModelId(APP_USER_MODEL_ID);
}

// Currently registered global push-to-talk accelerator, so we can unregister
// it before registering a new one (or on app quit).
let pttAccelerator = null;
// Tracks whether the PTT key is currently held. Electron's globalShortcut only
// fires on key-down, so we emulate key-up with an idle timer that the renderer
// refreshes via the OS auto-repeat key-down events while the key is held.
//
// The tricky part: the OS auto-repeat interval varies by system (and the first
// repeat is delayed 250-500ms). A fixed release delay that is shorter than the
// repeat interval cuts the mic off mid-hold. To stay robust we measure the
// observed repeat interval at runtime and keep the release window comfortably
// larger than it, clamped to a sane min/max.
let pttHeld = false;
let pttReleaseTimer = null;
let pttLastDownAt = 0;
// Smoothed estimate of the OS auto-repeat interval (ms) between key-down events.
let pttRepeatInterval = 0;
// Floor/ceiling for the synthetic key-up delay.
const PTT_RELEASE_MIN = 350;
const PTT_RELEASE_MAX = 900;
// How much longer than the observed repeat interval we wait before releasing,
// so a single skipped/late repeat does not falsely release the key.
const PTT_RELEASE_FACTOR = 2.5;

function pttReleaseDelay() {
  if (!pttRepeatInterval) return PTT_RELEASE_MIN;
  const delay = Math.round(pttRepeatInterval * PTT_RELEASE_FACTOR);
  return Math.min(PTT_RELEASE_MAX, Math.max(PTT_RELEASE_MIN, delay));
}

// Map a KeyboardEvent.code (used by the in-app voice settings) to an Electron
// accelerator string. Returns null for codes we cannot register globally.
function codeToAccelerator(code) {
  if (!code) return null;
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Numpad')) return `num${code.slice(6).toLowerCase()}`;
  if (code.startsWith('F') && /^F\d{1,2}$/.test(code)) return code;
  if (code.startsWith('Arrow')) return code.slice(5);
  const map = {
    Space: 'Space',
    Enter: 'Enter',
    Tab: 'Tab',
    Backquote: '`',
    Minus: '-',
    Equal: '=',
    BracketLeft: '[',
    BracketRight: ']',
    Backslash: '\\\\',
    Semicolon: ';',
    Quote: "'",
    Comma: ',',
    Period: '.',
    Slash: '/',
    CapsLock: 'CapsLock',
    Insert: 'Insert',
    Delete: 'Delete',
    Home: 'Home',
    End: 'End',
    PageUp: 'PageUp',
    PageDown: 'PageDown'
  };
  return map[code] || null;
}

// Screen source chosen in the renderer's own picker; consumed by the next
// getDisplayMedia() request through setDisplayMediaRequestHandler.
let pendingScreenSourceId = null;

function sanitizeFilename(filename) {
  return String(filename || 'notoc.auth.json').replace(/[<>:"/\\|?*\x00-\x1F]/g, '-');
}

function imageMimeByExt(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.png') return 'image/png';
  if (ext === '.webp') return 'image/webp';
  if (ext === '.gif') return 'image/gif';
  if (ext === '.svg') return 'image/svg+xml';
  return 'application/octet-stream';
}

function createWindow() {
  const workArea = screen.getPrimaryDisplay().workArea;
  const window = new BrowserWindow({
    x: workArea.x,
    y: workArea.y,
    width: workArea.width,
    height: workArea.height,
    minWidth: 920,
    minHeight: 620,
    show: false,
    frame: false,
    icon: appIconPath,
    titleBarStyle: 'hidden',
    backgroundColor: '#f4f7fb',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      // Keep the renderer (audio graph, timers, RAF) running at full speed when
      // the window is minimized or in the background. Without this Chromium
      // throttles the page while a game is focused, which breaks push-to-talk:
      // the mic AudioContext stalls and no voice is transmitted.
      backgroundThrottling: false
    }
  });

  window.webContents.setZoomFactor(DEFAULT_ZOOM_FACTOR);
  let windowShown = false;
  const showWindow = () => {
    if (windowShown || window.isDestroyed()) return;
    windowShown = true;
    window.show();
    window.focus();
  };

  window.webContents.on('did-finish-load', () => {
    window.webContents.setZoomFactor(DEFAULT_ZOOM_FACTOR);
    showWindow();
  });

  window.webContents.session.webRequest.onBeforeSendHeaders(YOUTUBE_REQUEST_FILTER, (details, callback) => {
    const requestHeaders = { ...details.requestHeaders };
    requestHeaders.Referer = requestHeaders.Referer || YOUTUBE_EMBED_REFERRER;
    requestHeaders.Origin = requestHeaders.Origin || 'https://www.youtube.com';
    callback({ requestHeaders });
  });

  window.once('ready-to-show', showWindow);

  // A renderer can be fully running (including audio) without Electron emitting
  // ready-to-show on some Windows/GPU combinations. Never leave the main window
  // permanently hidden in that case.
  const showFallback = setTimeout(showWindow, 3000);
  window.once('closed', () => clearTimeout(showFallback));

  window.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const parsed = new URL(String(url));
      if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
        void shell.openExternal(parsed.toString());
      }
    } catch {}
    return { action: 'deny' };
  });

  // Allow the renderer to capture the screen via navigator.mediaDevices.getDisplayMedia().
  // Electron requires an explicit display media request handler; without it getDisplayMedia rejects.
  if (window.webContents.session.setDisplayMediaRequestHandler) {
    window.webContents.session.setDisplayMediaRequestHandler((_request, callback) => {
      desktopCapturer
        .getSources({ types: ['screen', 'window'] })
        .then((sources) => {
          // Use the source chosen in the renderer's picker; fall back to the primary screen.
          const chosen = (pendingScreenSourceId && sources.find((source) => source.id === pendingScreenSourceId)) || sources[0];
          pendingScreenSourceId = null;
          if (chosen) callback({ video: chosen });
          else callback({});
        })
        .catch(() => callback({}));
    });
  }

  if (isDev) {
    void window.loadURL(process.env.VITE_DEV_SERVER_URL || 'http://127.0.0.1:5173');
    window.webContents.openDevTools({ mode: 'detach' });
  } else {
    void window.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('will-quit', () => {
  clearGlobalPushToTalk();
});

ipcMain.handle('auth-file:save', async (_event, authFile) => {
  const filename = sanitizeFilename(authFile?.filename);
  const defaultPath = path.join(app.getPath('downloads'), filename);
  const result = await dialog.showSaveDialog({
    title: 'Сохранить NotOS auth-файл',
    defaultPath,
    filters: [{ name: 'NotOS auth file', extensions: ['json'] }]
  });

  if (result.canceled || !result.filePath) {
    return { canceled: true };
  }

  await fs.writeFile(result.filePath, String(authFile.content || ''), 'utf8');
  return { canceled: false, filePath: result.filePath };
});

ipcMain.handle('auth-file:open', async () => {
  const result = await dialog.showOpenDialog({
    title: 'Выбрать NotOS auth-файл',
    properties: ['openFile'],
    filters: [
      { name: 'NotOS auth file', extensions: ['json', 'auth'] },
      { name: 'All files', extensions: ['*'] }
    ]
  });

  if (result.canceled || !result.filePaths[0]) {
    return { canceled: true };
  }

  const filePath = result.filePaths[0];
  return {
    canceled: false,
    filePath,
    content: await fs.readFile(filePath, 'utf8')
  };
});

ipcMain.handle('image-file:open', async () => {
  const result = await dialog.showOpenDialog({
    title: 'Выбрать изображение',
    properties: ['openFile'],
    filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg'] }]
  });

  if (result.canceled || !result.filePaths[0]) {
    return { canceled: true };
  }

  const filePath = result.filePaths[0];
  const buffer = await fs.readFile(filePath);
  const mimeType = imageMimeByExt(filePath);

  return {
    canceled: false,
    filePath,
    dataUrl: `data:${mimeType};base64,${buffer.toString('base64')}`
  };
});

ipcMain.handle('window:minimize', (event) => {
  BrowserWindow.fromWebContents(event.sender)?.minimize();
});

ipcMain.handle('window:maximize-toggle', (event) => {
  const window = BrowserWindow.fromWebContents(event.sender);
  if (!window) return;
  if (window.isMaximized()) window.unmaximize();
  else window.maximize();
});

ipcMain.handle('window:close', (event) => {
  BrowserWindow.fromWebContents(event.sender)?.close();
});

ipcMain.handle('app:get-version', () => app.getVersion());

ipcMain.handle('app:restart', () => {
  app.relaunch();
  app.exit(0);
});

ipcMain.handle('app:set-unread-badge', (event, count) => {
  const window = BrowserWindow.fromWebContents(event.sender);
  if (!window) return { ok: false };
  try {
    setTaskbarUnreadBadge(window, typeof count === 'number' ? count : 0);
    return { ok: true };
  } catch {
    return { ok: false };
  }
});

ipcMain.handle('clipboard:write-image', (_event, dataUrl) => {
  try {
    if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/')) return { ok: false };
    const image = nativeImage.createFromDataURL(dataUrl);
    if (image.isEmpty()) return { ok: false };
    clipboard.writeImage(image);
    return { ok: true };
  } catch {
    return { ok: false };
  }
});

ipcMain.handle('shell:open-external', async (_event, url) => {
  try {
    const parsed = new URL(String(url));
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return { ok: false };
    await shell.openExternal(parsed.toString());
    return { ok: true };
  } catch {
    return { ok: false };
  }
});

ipcMain.handle('screen:select-source', (_event, sourceId) => {
  pendingScreenSourceId = typeof sourceId === 'string' ? sourceId : null;
});

// --- Background (global) push-to-talk ---------------------------------------
// Registers a system-wide hotkey so the user can transmit voice while another
// app (e.g. a game) is focused. We send 'ptt:down'/'ptt:up' to the renderer,
// which drives the same mic-enable logic the in-app PTT uses.
function clearGlobalPushToTalk() {
  if (pttReleaseTimer) {
    clearTimeout(pttReleaseTimer);
    pttReleaseTimer = null;
  }
  if (pttAccelerator) {
    try { globalShortcut.unregister(pttAccelerator); } catch {}
    pttAccelerator = null;
  }
  pttHeld = false;
  pttLastDownAt = 0;
  pttRepeatInterval = 0;
}

ipcMain.handle('ptt:register', (event, code) => {
  clearGlobalPushToTalk();
  const accelerator = codeToAccelerator(code);
  if (!accelerator) return { ok: false, reason: 'unsupported-key' };

  const sender = event.sender;
  const ok = globalShortcut.register(accelerator, () => {
    // Each global key-down (the OS auto-repeats while held) extends the hold
    // window; when repeats stop we emit a synthetic key-up.
    const now = Date.now();
    if (!pttHeld) {
      pttHeld = true;
      pttRepeatInterval = 0;
      if (!sender.isDestroyed()) sender.send('ptt:down');
    } else if (pttLastDownAt) {
      // Learn the OS auto-repeat cadence from the gap between repeats so the
      // release delay adapts to the user's keyboard settings. Ignore the first
      // (delayed) repeat and outliers; smooth the rest with an EMA.
      const gap = now - pttLastDownAt;
      if (gap > 10 && gap < PTT_RELEASE_MAX) {
        pttRepeatInterval = pttRepeatInterval ? Math.round(pttRepeatInterval * 0.6 + gap * 0.4) : gap;
      }
    }
    pttLastDownAt = now;
    if (pttReleaseTimer) clearTimeout(pttReleaseTimer);
    pttReleaseTimer = setTimeout(() => {
      pttHeld = false;
      pttReleaseTimer = null;
      pttLastDownAt = 0;
      pttRepeatInterval = 0;
      if (!sender.isDestroyed()) sender.send('ptt:up');
    }, pttReleaseDelay());
  });

  if (!ok) {
    pttAccelerator = null;
    return { ok: false, reason: 'register-failed' };
  }
  pttAccelerator = accelerator;
  return { ok: true, accelerator };
});

ipcMain.handle('ptt:unregister', () => {
  clearGlobalPushToTalk();
  return { ok: true };
});

ipcMain.handle('screen:get-sources', async () => {
  const sources = await desktopCapturer.getSources({
    types: ['screen', 'window'],
    thumbnailSize: { width: 320, height: 200 }
  });
  return sources.map((source) => ({
    id: source.id,
    name: source.name,
    thumbnail: source.thumbnail.toDataURL(),
    isScreen: source.id.startsWith('screen:')
  }));
});
