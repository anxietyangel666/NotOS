const http = require('node:http');
const https = require('node:https');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { spawn, execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { app } = require('electron');

const execFileAsync = promisify(execFile);

function parseVersion(version) {
  if (!version || typeof version !== 'string') return [0, 0, 0];
  return version
    .split(/[.-]/)
    .map((part) => Number.parseInt(part.replace(/\D+/g, ''), 10))
    .map((part) => (Number.isFinite(part) ? part : 0));
}

function compareVersions(a, b) {
  const left = parseVersion(a);
  const right = parseVersion(b);
  const length = Math.max(left.length, right.length, 3);
  for (let index = 0; index < length; index += 1) {
    const diff = (left[index] ?? 0) - (right[index] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

function getConfigFile(userDataPath) {
  return path.join(userDataPath, 'notos-config.json');
}

async function loadServerUrl(userDataPath, fallbackUrl) {
  try {
    const content = await fsp.readFile(getConfigFile(userDataPath), 'utf8');
    const parsed = JSON.parse(content);
    if (parsed.serverUrl && typeof parsed.serverUrl === 'string') {
      return parsed.serverUrl.replace(/\/+$/, '');
    }
  } catch {}
  return fallbackUrl.replace(/\/+$/, '');
}

async function saveServerUrl(userDataPath, serverUrl) {
  try {
    const file = getConfigFile(userDataPath);
    let existing = {};
    try {
      existing = JSON.parse(await fsp.readFile(file, 'utf8'));
    } catch {}
    existing.serverUrl = serverUrl.replace(/\/+$/, '');
    await fsp.writeFile(file, JSON.stringify(existing, null, 2), 'utf8');
  } catch {}
}

function fetchJson(urlStr, timeoutMs = 6000) {
  return new Promise((resolve, reject) => {
    try {
      const parsed = new URL(urlStr);
      const client = parsed.protocol === 'https:' ? https : http;
      const req = client.get(urlStr, { timeout: timeoutMs, headers: { 'Cache-Control': 'no-cache' } }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          const nextUrl = new URL(res.headers.location, urlStr).toString();
          return resolve(fetchJson(nextUrl, timeoutMs));
        }
        if (res.statusCode < 200 || res.statusCode >= 300) {
          return reject(new Error(`HTTP ${res.statusCode}`));
        }
        let data = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          try {
            resolve(JSON.parse(data));
          } catch (err) {
            reject(err);
          }
        });
      });
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Request timeout'));
      });
      req.on('error', reject);
    } catch (err) {
      reject(err);
    }
  });
}

async function checkServerHealth(serverUrl) {
  try {
    const healthUrl = `${serverUrl}/health`;
    const res = await fetchJson(healthUrl, 4000);
    return res && res.status === 'ok';
  } catch {
    return false;
  }
}

async function checkForUpdate(serverUrl, currentVersion) {
  const updateUrl = `${serverUrl}/api/client/update?type=bundle`;
  const manifest = await fetchJson(updateUrl, 5000);
  const latestVersion = manifest?.version?.trim() || currentVersion;
  const isAvailable = compareVersions(latestVersion, currentVersion) > 0;

  let bundleUrl = manifest?.bundleUrl?.trim() || '';
  if (bundleUrl && !bundleUrl.startsWith('http://') && !bundleUrl.startsWith('https://')) {
    bundleUrl = `${serverUrl}${bundleUrl.startsWith('/') ? '' : '/'}${bundleUrl}`;
  }

  let downloadUrl = manifest?.url?.trim() || '';
  if (downloadUrl && !downloadUrl.startsWith('http://') && !downloadUrl.startsWith('https://')) {
    downloadUrl = `${serverUrl}${downloadUrl.startsWith('/') ? '' : '/'}${downloadUrl}`;
  }

  let installerUrl = manifest?.installerUrl?.trim() || '';
  if (installerUrl && !installerUrl.startsWith('http://') && !installerUrl.startsWith('https://')) {
    installerUrl = `${serverUrl}${installerUrl.startsWith('/') ? '' : '/'}${installerUrl}`;
  }

  return {
    available: isAvailable,
    currentVersion,
    latestVersion,
    downloadUrl: bundleUrl || downloadUrl || installerUrl,
    installerUrl: installerUrl || downloadUrl,
    notes: manifest?.notes?.trim() || '',
    required: Boolean(manifest?.required)
  };
}

function downloadFile(urlStr, targetPath, onProgress) {
  return new Promise((resolve, reject) => {
    try {
      const parsed = new URL(urlStr);
      const client = parsed.protocol === 'https:' ? https : http;
      const req = client.get(urlStr, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          const nextUrl = new URL(res.headers.location, urlStr).toString();
          return resolve(downloadFile(nextUrl, targetPath, onProgress));
        }
        if (res.statusCode !== 200) {
          return reject(new Error(`Download failed with HTTP ${res.statusCode}`));
        }

        const totalBytes = Number.parseInt(res.headers['content-length'] || '0', 10);
        let downloadedBytes = 0;
        const fileStream = fs.createWriteStream(targetPath);

        res.on('data', (chunk) => {
          downloadedBytes += chunk.length;
          const percent = totalBytes > 0 ? (downloadedBytes / totalBytes) * 100 : 0;
          if (onProgress) {
            onProgress({
              percent,
              downloaded: downloadedBytes,
              total: totalBytes
            });
          }
        });

        res.pipe(fileStream);

        fileStream.on('finish', () => {
          fileStream.close(() => resolve(targetPath));
        });

        fileStream.on('error', (err) => {
          fs.unlink(targetPath, () => {});
          reject(err);
        });
      });

      req.on('error', (err) => {
        fs.unlink(targetPath, () => {});
        reject(err);
      });
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * Applies the downloaded update file.
 * Handles both .exe (NSIS installer) and .zip (app web bundle).
 */
async function applyUpdate(filePath, { distPath, latestVersion }) {
  const ext = path.extname(filePath).toLowerCase();

  if (ext === '.exe') {
    // Run NSIS setup silently with /S and restart
    const child = spawn(filePath, ['/S', '--updated'], {
      detached: true,
      stdio: 'ignore'
    });
    child.unref();
    app.quit();
    return true;
  }

  if (ext === '.zip') {
    // Hot-update the dist bundle
    const tempStage = path.join(app.getPath('temp'), `notos-stage-${Date.now()}`);
    await fsp.mkdir(tempStage, { recursive: true });

    // Use built-in tar.exe on Windows to extract zip
    await execFileAsync('tar.exe', ['-xf', filePath, '-C', tempStage]);

    // Check if zip contains a dist/ folder or root files directly
    const stageDist = path.join(tempStage, 'dist');
    let sourceDir = tempStage;
    try {
      const stat = await fsp.stat(stageDist);
      if (stat.isDirectory()) sourceDir = stageDist;
    } catch {}

    // Copy updated dist files over current dist (excluding electron folder)
    await copyDirRecursive(sourceDir, distPath, ['electron']);

    // Also check if zip contains electron/ folder to update electron runtime files
    const stageElectron = path.join(tempStage, 'electron');
    try {
      const statEl = await fsp.stat(stageElectron);
      if (statEl.isDirectory()) {
        const destElectron = path.join(distPath, '..', 'electron');
        await copyDirRecursive(stageElectron, destElectron);
      }
    } catch (err) {
      console.warn('Failed to update electron directory, dist updated:', err);
    }

    // If version is provided, write version marker
    if (latestVersion) {
      try {
        const versionMarker = path.join(distPath, '..', 'package.json');
        const pkgContent = JSON.parse(await fsp.readFile(versionMarker, 'utf8'));
        pkgContent.version = latestVersion;
        await fsp.writeFile(versionMarker, JSON.stringify(pkgContent, null, 2), 'utf8');
      } catch {}
    }

    // Cleanup temp files
    try { await fsp.rm(tempStage, { recursive: true, force: true }); } catch {}
    try { await fsp.unlink(filePath); } catch {}

    // Relaunch the application smoothly!
    app.relaunch();
    app.exit(0);
    return true;
  }

  throw new Error(`Unsupported update format: ${ext}`);
}

async function copyDirRecursive(src, dest, excludeNames = []) {
  await fsp.mkdir(dest, { recursive: true });
  const entries = await fsp.readdir(src, { withFileTypes: true });
  for (const entry of entries) {
    if (excludeNames.includes(entry.name)) continue;
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      await copyDirRecursive(srcPath, destPath, excludeNames);
    } else {
      await fsp.copyFile(srcPath, destPath);
    }
  }
}

module.exports = {
  compareVersions,
  loadServerUrl,
  saveServerUrl,
  checkServerHealth,
  checkForUpdate,
  downloadFile,
  applyUpdate
};
