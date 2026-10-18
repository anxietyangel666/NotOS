const { app, BrowserWindow, dialog, ipcMain, desktopCapturer, session, globalShortcut, shell, screen, nativeImage, clipboard } = require('electron');
const http = require('node:http');
const fsSync = require('node:fs');
const fs = require('node:fs/promises');
const path = require('node:path');
const { spawn } = require('node:child_process');

const isDev = !app.isPackaged;
const updater = require('./updater.cjs');
const DEFAULT_SERVER_URL = process.env.VITE_API_URL || 'http://163.5.16.156:4000';
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

const REAL_CHROME_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';

// Set standard clean Chrome User-Agent so embeds, YouTube and webviews see a standard browser without Electron
app.userAgentFallback = REAL_CHROME_UA;

// Allow running multiple client instances side-by-side on one PC without corrupting or sharing session/localStorage.
// The primary instance uses default userData; any subsequent instance uses an isolated profile directory.
const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  const baseUserData = app.getPath('appData');
  app.setPath('userData', path.join(baseUserData, `${APP_USER_MODEL_ID}-client-2`));
}

// Currently registered global push-to-talk accelerator, so we can unregister
// it before registering a new one (or on app quit).
let pttAccelerator = null;
let pttProcess = null;
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
    PageDown: 'PageDown',
    Escape: 'Escape',
    ScrollLock: 'ScrollLock',
    Pause: 'Pause',
    PrintScreen: 'PrintScreen'
  };
  return map[code] || null;
}

// Map a KeyboardEvent.code or mouse button to a Windows Virtual Key code.
// Returns integer VK code or null if unsupported.
function codeToVk(code) {
  if (!code) return null;
  // Modifiers - map to both specific L/R virtual key and generic modifier virtual key
  if (code === 'AltLeft') return [164, 18]; // VK_LMENU, VK_MENU
  if (code === 'AltRight') return [165, 18]; // VK_RMENU, VK_MENU
  if (code === 'Alt') return [18, 164, 165]; // VK_MENU, VK_LMENU, VK_RMENU
  if (code === 'ControlLeft') return [162, 17]; // VK_LCONTROL, VK_CONTROL
  if (code === 'ControlRight') return [163, 17]; // VK_RCONTROL, VK_CONTROL
  if (code === 'Control' || code === 'Ctrl') return [17, 162, 163]; // VK_CONTROL
  if (code === 'ShiftLeft') return [160, 16]; // VK_LSHIFT, VK_SHIFT
  if (code === 'ShiftRight') return [161, 16]; // VK_RSHIFT, VK_SHIFT
  if (code === 'Shift') return [16, 160, 161]; // VK_SHIFT

  // Mouse buttons
  if (code === 'Mouse1') return [1]; // VK_LBUTTON
  if (code === 'Mouse2') return [2]; // VK_RBUTTON
  if (code === 'Mouse3') return [4]; // VK_MBUTTON
  if (code === 'Mouse4') return [5]; // VK_XBUTTON1
  if (code === 'Mouse5') return [6]; // VK_XBUTTON2

  // Letters KeyA - KeyZ
  if (/^Key[A-Z]$/.test(code)) {
    return [code.charCodeAt(3)];
  }
  // Digits Digit0 - Digit9
  if (/^Digit[0-9]$/.test(code)) {
    return [code.charCodeAt(5)];
  }
  // Numpad 0 - 9
  if (/^Numpad[0-9]$/.test(code)) {
    return [96 + parseInt(code.slice(6), 10)];
  }
  // Function keys F1 - F24
  const fMatch = /^F(\d{1,2})$/.exec(code);
  if (fMatch) {
    const fNum = parseInt(fMatch[1], 10);
    if (fNum >= 1 && fNum <= 24) {
      return [111 + fNum];
    }
  }

  const specialMap = {
    Space: 32,
    Enter: 13,
    Tab: 9,
    Escape: 27,
    CapsLock: 20,
    Backspace: 8,
    Insert: 45,
    Delete: 46,
    Home: 36,
    End: 35,
    PageUp: 33,
    PageDown: 34,
    ArrowLeft: 37,
    ArrowUp: 38,
    ArrowRight: 39,
    ArrowDown: 40,
    Backquote: 192,
    Minus: 189,
    Equal: 187,
    BracketLeft: 219,
    BracketRight: 221,
    Backslash: 220,
    Semicolon: 186,
    Quote: 222,
    Comma: 188,
    Period: 190,
    Slash: 191,
    ScrollLock: 145,
    Pause: 19,
    PrintScreen: 44,
    NumpadMultiply: 106,
    NumpadAdd: 107,
    NumpadSeparator: 108,
    NumpadSubtract: 109,
    NumpadDecimal: 110,
    NumpadDivide: 111
  };

  return specialMap[code] ? [specialMap[code]] : null;
}

function getPttHelperPath() {
  const candidates = [
    path.join(__dirname, 'ptt-helper.exe'),
    process.resourcesPath ? path.join(process.resourcesPath, 'electron', 'ptt-helper.exe') : null,
    process.resourcesPath ? path.join(process.resourcesPath, 'app', 'electron', 'ptt-helper.exe') : null
  ].filter(Boolean);
  for (const candidate of candidates) {
    if (fsSync.existsSync(candidate)) return candidate;
  }
  return null;
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

let localStaticServer = null;
let localStaticPort = 0;

function startLocalStaticServer(distPath) {
  return new Promise((resolve, reject) => {
    const mimeTypes = {
      '.html': 'text/html; charset=utf-8',
      '.js': 'application/javascript; charset=utf-8',
      '.mjs': 'application/javascript; charset=utf-8',
      '.css': 'text/css; charset=utf-8',
      '.json': 'application/json; charset=utf-8',
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.gif': 'image/gif',
      '.svg': 'image/svg+xml',
      '.ico': 'image/x-icon',
      '.woff2': 'font/woff2',
      '.woff': 'font/woff',
      '.ttf': 'font/ttf',
      '.wasm': 'application/wasm',
      '.mp3': 'audio/mpeg',
      '.mp4': 'video/mp4',
      '.webm': 'video/webm'
    };

    const server = http.createServer(async (req, res) => {
      try {
        const parsedUrl = new URL(req.url || '/', 'http://127.0.0.1');
        let pathname = decodeURIComponent(parsedUrl.pathname);
        if (pathname === '/' || pathname === '') pathname = '/index.html';

        let filePath = path.normalize(path.join(distPath, pathname));
        if (!filePath.startsWith(distPath)) {
          res.writeHead(403);
          res.end();
          return;
        }

        let isDir = false;
        try {
          const stat = await fs.stat(filePath);
          if (stat.isDirectory()) isDir = true;
        } catch {
          // File not found -> SPA fallback: index.html
          filePath = path.join(distPath, 'index.html');
        }

        if (isDir) {
          filePath = path.join(filePath, 'index.html');
        }

        const ext = path.extname(filePath).toLowerCase();
        const contentType = mimeTypes[ext] || 'application/octet-stream';
        const content = await fs.readFile(filePath);

        res.writeHead(200, {
          'Content-Type': contentType,
          'Access-Control-Allow-Origin': '*',
          'Cache-Control': 'no-cache'
        });
        res.end(content);
      } catch (err) {
        res.writeHead(500);
        res.end();
      }
    });

    const basePort = gotSingleInstanceLock ? 24124 : 24125;
    const tryListen = (port, maxPort) => {
      const onError = (err) => {
        if (err.code === 'EADDRINUSE' && port < maxPort) {
          server.removeListener('error', onError);
          tryListen(port + 1, maxPort);
        } else {
          server.removeListener('error', onError);
          reject(err);
        }
      };
      server.once('error', onError);
      server.listen(port, '127.0.0.1', () => {
        server.removeListener('error', onError);
        const address = server.address();
        localStaticPort = address.port;
        localStaticServer = server;
        resolve(localStaticPort);
      });
    };
    tryListen(basePort, basePort + 20);
  });
}

let splashWindow = null;
let mainWindow = null;
let detachedMessengerWindow = null;
let distPath = null;
let isMainWindowReady = false;
let shouldShowMainWindow = false;
let activeServerUrl = DEFAULT_SERVER_URL;

function createSplashWindow() {
  splashWindow = new BrowserWindow({
    width: 320,
    height: 380,
    frame: false,
    transparent: true,
    resizable: false,
    center: true,
    show: false,
    backgroundColor: '#00000000',
    icon: appIconPath,
    skipTaskbar: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload-splash.cjs'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  splashWindow.setMenu(null);

  splashWindow.loadFile(path.join(__dirname, 'splash.html'));
  splashWindow.once('ready-to-show', () => {
    if (splashWindow && !splashWindow.isDestroyed()) {
      splashWindow.show();
    }
  });

  splashWindow.on('closed', () => {
    splashWindow = null;
  });
}

function updateSplash(data) {
  if (splashWindow && !splashWindow.isDestroyed()) {
    splashWindow.webContents.send('splash:update', data);
  }
}

function showMainWindow() {
  shouldShowMainWindow = true;
  if (!isMainWindowReady || !mainWindow || mainWindow.isDestroyed()) return;

  mainWindow.show();
  mainWindow.focus();

  if (splashWindow && !splashWindow.isDestroyed()) {
    splashWindow.destroy();
    splashWindow = null;
  }
}

function createMainWindow() {
  const workArea = screen.getPrimaryDisplay().workArea;
  mainWindow = new BrowserWindow({
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
      backgroundThrottling: false,
      spellcheck: true
    }
  });
  mainWindow.setMenu(null);

  try {
    const spellSes = mainWindow.webContents.session || session.defaultSession;
    const available = spellSes.availableSpellCheckerLanguages || [];
    const desired = ['ru-RU', 'ru', 'en-US', 'en', 'uk'];
    const toSet = desired.filter((lang) => available.includes(lang));
    if (toSet.length > 0) {
      spellSes.setSpellCheckerLanguages(toSet);
    } else if (available.length > 0) {
      spellSes.setSpellCheckerLanguages(available.slice(0, 3));
    }
  } catch (err) {
    console.warn('Spellchecker init error:', err);
  }

  mainWindow.webContents.setZoomFactor(DEFAULT_ZOOM_FACTOR);

  const onReady = () => {
    isMainWindowReady = true;
    if (shouldShowMainWindow) {
      showMainWindow();
    }
  };

  mainWindow.webContents.on('did-finish-load', () => {
    mainWindow.webContents.setZoomFactor(DEFAULT_ZOOM_FACTOR);
    onReady();
  });

  mainWindow.once('ready-to-show', onReady);

  const showFallback = setTimeout(onReady, 4000);
  mainWindow.once('closed', () => {
    clearTimeout(showFallback);
    mainWindow = null;
    if (detachedMessengerWindow && !detachedMessengerWindow.isDestroyed()) {
      detachedMessengerWindow.close();
      detachedMessengerWindow = null;
    }
  });

  mainWindow.webContents.setUserAgent(REAL_CHROME_UA);
  const ses = mainWindow.webContents.session || session.defaultSession;
  ses.setUserAgent(REAL_CHROME_UA);

  ses.webRequest.onBeforeSendHeaders((details, callback) => {
    const requestHeaders = { ...details.requestHeaders };
    const url = details.url || '';
    if (url.includes('youtube.com') || url.includes('youtube-nocookie.com') || url.includes('googlevideo.com') || url.includes('ytimg.com')) {
      delete requestHeaders['Referer'];
      delete requestHeaders['referer'];
      requestHeaders['Referer'] = 'https://google.com/';
    }
    callback({ requestHeaders });
  });

  ses.webRequest.onHeadersReceived((details, callback) => {
    const responseHeaders = { ...details.responseHeaders };
    for (const key of Object.keys(responseHeaders)) {
      const lower = key.toLowerCase();
      if (lower === 'x-frame-options') {
        delete responseHeaders[key];
      } else if (lower === 'content-security-policy') {
        responseHeaders[key] = responseHeaders[key].map((csp) =>
          csp.replace(/frame-ancestors\s+[^;]+;?/gi, '')
        );
      }
    }
    callback({ responseHeaders });
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const parsed = new URL(String(url));
      if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
        void shell.openExternal(parsed.toString());
      }
    } catch {}
    return { action: 'deny' };
  });

  if (mainWindow.webContents.session.setDisplayMediaRequestHandler) {
    mainWindow.webContents.session.setDisplayMediaRequestHandler((_request, callback) => {
      desktopCapturer
        .getSources({ types: ['screen', 'window'] })
        .then((sources) => {
          const chosen = (pendingScreenSourceId && sources.find((source) => source.id === pendingScreenSourceId)) || sources[0];
          pendingScreenSourceId = null;
          if (chosen) callback({ video: chosen });
          else callback({});
        })
        .catch(() => callback({}));
    });
  }

  if (isDev) {
    void mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL || 'http://127.0.0.1:5173');
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    void mainWindow.loadURL(`http://127.0.0.1:${localStaticPort}`);
  }
}

function createDetachedMessengerWindow(params = {}) {
  if (detachedMessengerWindow && !detachedMessengerWindow.isDestroyed()) {
    detachedMessengerWindow.show();
    detachedMessengerWindow.focus();
    return detachedMessengerWindow;
  }

  const primaryDisplay = screen.getPrimaryDisplay();
  const workArea = primaryDisplay.workArea;
  const width = Math.min(1280, Math.max(980, Math.round(workArea.width * 0.8)));
  const height = Math.min(840, Math.max(640, Math.round(workArea.height * 0.85)));
  const x = Math.max(workArea.x, Math.round(workArea.x + (workArea.width - width) / 2));
  const y = Math.max(workArea.y, Math.round(workArea.y + (workArea.height - height) / 2));

  detachedMessengerWindow = new BrowserWindow({
    x,
    y,
    width,
    height,
    minWidth: 940,
    minHeight: 600,
    show: false,
    frame: false,
    icon: appIconPath,
    titleBarStyle: 'hidden',
    backgroundColor: '#1e1f22',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false,
      spellcheck: true
    }
  });
  detachedMessengerWindow.setMenu(null);

  try {
    const spellSes = detachedMessengerWindow.webContents.session || session.defaultSession;
    const available = spellSes.availableSpellCheckerLanguages || [];
    const desired = ['ru-RU', 'ru', 'en-US', 'en', 'uk'];
    const toSet = desired.filter((lang) => available.includes(lang));
    if (toSet.length > 0) {
      spellSes.setSpellCheckerLanguages(toSet);
    }
  } catch (err) {
    console.warn('Spellchecker init error in detached messenger:', err);
  }

  detachedMessengerWindow.webContents.setZoomFactor(DEFAULT_ZOOM_FACTOR);

  detachedMessengerWindow.webContents.on('did-finish-load', () => {
    detachedMessengerWindow?.webContents.setZoomFactor(DEFAULT_ZOOM_FACTOR);
    if (detachedMessengerWindow && !detachedMessengerWindow.isDestroyed()) {
      detachedMessengerWindow.show();
      detachedMessengerWindow.focus();
    }
  });

  detachedMessengerWindow.once('ready-to-show', () => {
    if (detachedMessengerWindow && !detachedMessengerWindow.isDestroyed()) {
      detachedMessengerWindow.show();
      detachedMessengerWindow.focus();
    }
  });

  detachedMessengerWindow.webContents.setUserAgent(REAL_CHROME_UA);

  detachedMessengerWindow.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const parsed = new URL(String(url));
      if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
        void shell.openExternal(parsed.toString());
      }
    } catch {}
    return { action: 'deny' };
  });

  if (detachedMessengerWindow.webContents.session.setDisplayMediaRequestHandler) {
    detachedMessengerWindow.webContents.session.setDisplayMediaRequestHandler((_request, callback) => {
      desktopCapturer
        .getSources({ types: ['screen', 'window'] })
        .then((sources) => {
          const chosen = (pendingScreenSourceId && sources.find((source) => source.id === pendingScreenSourceId)) || sources[0];
          pendingScreenSourceId = null;
          if (chosen) callback({ video: chosen });
          else callback({});
        })
        .catch(() => callback({}));
    });
  }

  detachedMessengerWindow.on('closed', () => {
    detachedMessengerWindow = null;
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('messenger:docked');
    }
  });

  const queryParams = new URLSearchParams();
  queryParams.set('window', 'messenger');
  if (params.activeUserId) queryParams.set('userId', String(params.activeUserId));
  if (params.activeGroupId) queryParams.set('groupId', String(params.activeGroupId));
  if (params.token) queryParams.set('token', String(params.token));

  const queryString = queryParams.toString();
  const baseUrl = isDev
    ? (process.env.VITE_DEV_SERVER_URL || 'http://127.0.0.1:5173')
    : `http://127.0.0.1:${localStaticPort}`;

  void detachedMessengerWindow.loadURL(`${baseUrl}/?${queryString}`);

  return detachedMessengerWindow;
}

async function runStartupSequence() {
  const currentVersion = app.getVersion();
  updateSplash({
    version: currentVersion,
    status: 'checking',
    title: 'Проверка обновлений...',
    detail: 'Подключение к серверу...'
  });

  await new Promise((r) => setTimeout(r, 600));

  try {
    const isOnline = await updater.checkServerHealth(activeServerUrl);
    if (!isOnline) {
      updateSplash({
        status: 'offline',
        title: 'Автономный режим',
        detail: 'Сервер недоступен, запуск NotOS...'
      });
      await new Promise((r) => setTimeout(r, 900));
      showMainWindow();
      return;
    }

    updateSplash({
      status: 'checking',
      title: 'Проверка обновлений...',
      detail: 'Поиск новой версии...'
    });

    const updateInfo = await updater.checkForUpdate(activeServerUrl, currentVersion);
    if (updateInfo.available && updateInfo.downloadUrl) {
      updateSplash({
        status: 'downloading',
        title: 'Загрузка обновления...',
        detail: `Версия ${updateInfo.latestVersion}`,
        percent: 0
      });

      const ext = path.extname(new URL(updateInfo.downloadUrl).pathname).toLowerCase() || '.exe';
      const tempFile = path.join(app.getPath('temp'), `NotOS-update-${Date.now()}${ext}`);

      await updater.downloadFile(updateInfo.downloadUrl, tempFile, (progress) => {
        updateSplash({
          status: 'downloading',
          title: 'Загрузка обновления...',
          detail: `Версия ${updateInfo.latestVersion}`,
          percent: progress.percent,
          downloaded: progress.downloaded,
          total: progress.total
        });
      });

      updateSplash({
        status: 'installing',
        title: 'Установка обновления...',
        detail: 'Перезапуск NotOS...'
      });

      await new Promise((r) => setTimeout(r, 500));
      await updater.applyUpdate(tempFile, { distPath, latestVersion: updateInfo.latestVersion });
      return;
    }

    updateSplash({
      status: 'ready',
      title: 'Запуск NotOS...',
      detail: 'Установлена последняя версия'
    });
    await new Promise((r) => setTimeout(r, 450));
    showMainWindow();
  } catch (err) {
    updateSplash({
      status: 'offline',
      title: 'Запуск NotOS...',
      detail: 'Переход в главное окно...'
    });
    await new Promise((r) => setTimeout(r, 600));
    showMainWindow();
  }
}

app.whenReady().then(async () => {
  distPath = path.normalize(path.join(__dirname, '..', 'dist'));
  activeServerUrl = await updater.loadServerUrl(app.getPath('userData'), DEFAULT_SERVER_URL);

  if (!isDev) {
    await startLocalStaticServer(distPath);
  }

  createSplashWindow();
  createMainWindow();
  void runStartupSequence();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('will-quit', () => {
  clearGlobalPushToTalk();
  if (localStaticServer) {
    try { localStaticServer.close(); } catch {}
  }
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

ipcMain.handle('messenger:detach', (_event, params) => {
  createDetachedMessengerWindow(params);
  return { ok: true };
});

ipcMain.handle('messenger:dock', () => {
  if (detachedMessengerWindow && !detachedMessengerWindow.isDestroyed()) {
    detachedMessengerWindow.close();
    detachedMessengerWindow = null;
  }
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.show();
    mainWindow.focus();
    mainWindow.webContents.send('messenger:docked');
  }
  return { ok: true };
});

ipcMain.handle('messenger:is-detached', () => {
  return Boolean(detachedMessengerWindow && !detachedMessengerWindow.isDestroyed());
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
  if (pttProcess) {
    try {
      pttProcess.kill();
    } catch {}
    pttProcess = null;
  }
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
  const sender = event.sender;

  if (process.platform === 'win32') {
    const vks = codeToVk(code);
    const helperPath = vks && vks.length > 0 ? getPttHelperPath() : null;
    if (helperPath) {
      try {
        const cp = spawn(helperPath, vks.map(String), {
          windowsHide: true,
          stdio: ['ignore', 'pipe', 'ignore']
        });

        let buffer = '';
        cp.stdout.on('data', (chunk) => {
          buffer += chunk.toString();
          const lines = buffer.split(/\r?\n/);
          buffer = lines.pop() || '';
          for (const line of lines) {
            const trimmed = line.trim();
            if (trimmed === 'DOWN') {
              if (!sender.isDestroyed()) sender.send('ptt:down');
            } else if (trimmed === 'UP') {
              if (!sender.isDestroyed()) sender.send('ptt:up');
            }
          }
        });

        cp.on('error', (err) => {
          console.error('[PTT] helper error:', err);
        });

        cp.on('exit', () => {
          if (pttProcess === cp) {
            pttProcess = null;
          }
        });

        pttProcess = cp;
        return { ok: true, helper: true, vk };
      } catch (err) {
        console.error('[PTT] helper spawn failed:', err);
      }
    }
  }

  const accelerator = codeToAccelerator(code);
  if (!accelerator) return { ok: false, reason: 'unsupported-key' };

  let ok = false;
  try {
    ok = globalShortcut.register(accelerator, () => {
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
  } catch {
    ok = false;
  }

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

ipcMain.on('splash:close', () => {
  app.quit();
});

ipcMain.handle('app:set-server-url', async (_event, url) => {
  if (typeof url === 'string') {
    activeServerUrl = url.replace(/\/+$/, '');
    await updater.saveServerUrl(app.getPath('userData'), activeServerUrl);
    return { ok: true, serverUrl: activeServerUrl };
  }
  return { ok: false };
});

ipcMain.handle('app:get-server-url', () => {
  return activeServerUrl;
});

let downloadedUpdatePath = null;

ipcMain.handle('app:start-update', async (event, urlStr) => {
  try {
    let targetUrl = typeof urlStr === 'string' ? urlStr.trim() : '';
    if (!targetUrl.startsWith('http://') && !targetUrl.startsWith('https://')) {
      const base = (activeServerUrl || DEFAULT_SERVER_URL).replace(/\/+$/, '');
      targetUrl = `${base}${targetUrl.startsWith('/') ? '' : '/'}${targetUrl}`;
    }
    const parsed = new URL(targetUrl);
    const ext = path.extname(parsed.pathname).toLowerCase() || '.zip';
    const tempFile = path.join(app.getPath('temp'), `NotOS-update-${Date.now()}${ext}`);
    const sender = event.sender;

    await updater.downloadFile(targetUrl, tempFile, (progress) => {
      if (!sender.isDestroyed()) {
        sender.send('update:progress', progress);
      }
    });

    downloadedUpdatePath = tempFile;
    return { ok: true, filePath: tempFile };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('app:apply-update', async (_event, filePath) => {
  try {
    const targetFile = typeof filePath === 'string' ? filePath : downloadedUpdatePath;
    if (!targetFile) throw new Error('No update file specified');
    await updater.applyUpdate(targetFile, { distPath });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('spellcheck:add-word', (_event, word) => {
  if (typeof word === 'string' && word.trim()) {
    try {
      (mainWindow?.webContents.session || session.defaultSession).addWordToSpellCheckerDictionary(word.trim());
      return { ok: true };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  }
  return { ok: false };
});

