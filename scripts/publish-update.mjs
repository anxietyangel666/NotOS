import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

async function main() {
  const rootDir = process.cwd();
  const clientPkgPath = path.join(rootDir, 'apps', 'client', 'package.json');
  const clientPkg = JSON.parse(await fs.readFile(clientPkgPath, 'utf8'));

  const version = process.argv[2] || clientPkg.version;
  const notes = process.argv[3] || 'Автоматическое обновление NotOS';

  console.log(`[Publish] Preparing update for version v${version}...`);

  const serverUpdatesDir = path.join(rootDir, 'apps', 'server', 'updates');
  await fs.mkdir(serverUpdatesDir, { recursive: true });

  const clientDistDir = path.join(rootDir, 'apps', 'client', 'dist');
  try {
    await fs.access(clientDistDir);
  } catch {
    console.error(`[Error] dist directory not found at ${clientDistDir}. Please run 'npm run build' first.`);
    process.exit(1);
  }

  // Create staging directory to pack dist and electron runtime together
  const os = await import('node:os');
  const tempPack = path.join(os.tmpdir(), `notos-pack-${Date.now()}`);
  await fs.mkdir(tempPack, { recursive: true });
  await copyDir(clientDistDir, tempPack);

  const electronDir = path.join(rootDir, 'apps', 'client', 'electron');
  try {
    const statEl = await fs.stat(electronDir);
    if (statEl.isDirectory()) {
      await copyDir(electronDir, path.join(tempPack, 'electron'));
    }
  } catch {}

  // Create zip package using tar.exe
  const zipName = `NotOS-Update-${version}.zip`;
  const zipTarget = path.join(serverUpdatesDir, zipName);

  console.log(`[Publish] Packaging ${zipName}...`);
  try {
    await fs.unlink(zipTarget);
  } catch {}

  await execFileAsync('tar.exe', ['-a', '-cf', zipTarget, '-C', tempPack, '.']);
  try { await fs.rm(tempPack, { recursive: true, force: true }); } catch {}
  console.log(`[Publish] Created update bundle: ${zipTarget}`);

  // Check if NSIS installer exists in release directory
  const releaseInstaller = path.join(rootDir, 'apps', 'client', 'release', `NotOS-Setup-${version}.exe`);
  let installerAvailable = false;
  try {
    await fs.access(releaseInstaller);
    const destInstaller = path.join(serverUpdatesDir, `NotOS-Setup-${version}.exe`);
    await fs.copyFile(releaseInstaller, destInstaller);
    installerAvailable = true;
    console.log(`[Publish] Copied installer: ${destInstaller}`);
  } catch {
    console.log(`[Info] No installer found at ${releaseInstaller} (skipping installer copy)`);
  }

  // Generate version.json
  const installerTargetUrl = installerAvailable ? `https://notos.tech/updates/NotOS-Setup-${version}.exe` : '';
  const bundleTargetUrl = `https://notos.tech/updates/${zipName}`;
  const versionData = {
    version,
    url: installerTargetUrl || bundleTargetUrl,
    bundleUrl: bundleTargetUrl,
    installerUrl: installerTargetUrl,
    notes,
    publishedAt: new Date().toISOString()
  };

  const versionJsonPath = path.join(serverUpdatesDir, 'version.json');
  await fs.writeFile(versionJsonPath, JSON.stringify(versionData, null, 2), 'utf8');
  console.log(`[Publish] Generated ${versionJsonPath}:`, versionData);

  console.log(`\n[Success] Update v${version} published successfully to apps/server/updates/!`);
  console.log(`When any desktop client starts, it will detect v${version}, download the bundle, and automatically update.`);
}

async function copyDir(src, dest) {
  await fs.mkdir(dest, { recursive: true });
  const entries = await fs.readdir(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      await copyDir(srcPath, destPath);
    } else {
      await fs.copyFile(srcPath, destPath);
    }
  }
}

main().catch((err) => {
  console.error('[Publish Error]', err);
  process.exit(1);
});
