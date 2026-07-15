const { app, BrowserWindow, dialog, ipcMain, shell } = require('electron');
const { spawn, execFile } = require('node:child_process');
const { createWriteStream, existsSync } = require('node:fs');
const fs = require('node:fs/promises');
const path = require('node:path');
const { Readable } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const { promisify } = require('node:util');
const { pathToFileURL } = require('node:url');

const execFileAsync = promisify(execFile);
let autoUpdater;

try {
  ({ autoUpdater } = require('electron-updater'));
} catch {
  autoUpdater = null;
}

const APP_NAME = 'MadiaznX Hub';
const DEFAULT_OWNER = 'MadiaznX';
const GITHUB_API_VERSION = '2022-11-28';
const USER_AGENT = 'MadiaznX-Hub';
const MAX_ICON_BYTES = 2 * 1024 * 1024;
const CATALOG_CACHE_MAX_AGE_MS = 15 * 60 * 1000;
const IMAGE_MIME = new Map([
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.webp', 'image/webp'],
  ['.gif', 'image/gif'],
  ['.svg', 'image/svg+xml'],
  ['.ico', 'image/x-icon']
]);

let mainWindow;

app.setName(APP_NAME);

function resourcePath(...segments) {
  return path.join(__dirname, '..', ...segments);
}

function getPaths() {
  const localAppData = process.env.LOCALAPPDATA || app.getPath('userData');
  const userData = app.getPath('userData');

  return {
    userData,
    settingsFile: path.join(userData, 'settings.json'),
    installedFile: path.join(userData, 'installed.json'),
    installerPreferencesFile: path.join(userData, 'installer-preferences.json'),
    catalogCacheFile: path.join(userData, 'catalog-cache.json'),
    installRoot: path.join(localAppData, APP_NAME, 'apps'),
    appDataRoot: path.join(userData, 'app-data')
  };
}

async function ensureBaseFolders() {
  const paths = getPaths();
  await Promise.all([
    fs.mkdir(paths.userData, { recursive: true }),
    fs.mkdir(paths.installRoot, { recursive: true }),
    fs.mkdir(paths.appDataRoot, { recursive: true })
  ]);
}

async function readJson(filePath, fallback) {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    return JSON.parse(raw);
  } catch (error) {
    if (error.code !== 'ENOENT') {
      console.warn(`Could not read ${filePath}:`, error.message);
    }
    return fallback;
  }
}

async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function safeSegment(value) {
  return String(value || 'app')
    .normalize('NFKD')
    .replace(/[^\w.-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 120) || 'app';
}

function safeFileName(value) {
  const cleaned = String(value || 'download.exe')
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned.toLowerCase().endsWith('.exe') ? cleaned : `${cleaned || 'download'}.exe`;
}

function assertInside(basePath, targetPath) {
  const relative = path.relative(path.resolve(basePath), path.resolve(targetPath));
  if (relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))) {
    return;
  }
  throw new Error(`Caminho fora da area gerenciada: ${targetPath}`);
}

function githubHeaders(token, accept = 'application/vnd.github+json') {
  const headers = {
    Accept: accept,
    'User-Agent': USER_AGENT,
    'X-GitHub-Api-Version': GITHUB_API_VERSION
  };

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  return headers;
}

async function responseError(response) {
  let message = `${response.status} ${response.statusText}`;
  try {
    const body = await response.text();
    if (body) {
      const parsed = JSON.parse(body);
      message = parsed.message || body.slice(0, 220);
    }
  } catch {
    // Keep the HTTP status message.
  }
  return message;
}

function isRateLimitResponse(response, message) {
  return (
    response.status === 429 ||
    response.headers.get('x-ratelimit-remaining') === '0' ||
    /rate limit|api rate limit|secondary rate/i.test(message || '')
  );
}

function rateLimitError(response, message) {
  const resetSeconds = Number(response.headers.get('x-ratelimit-reset') || 0);
  const resetAt = resetSeconds ? new Date(resetSeconds * 1000).toISOString() : '';
  const error = new Error(
    resetAt
      ? `Limite da API do GitHub atingido. Tente de novo depois de ${new Date(resetAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })} ou salve um token do GitHub.`
      : 'Limite da API do GitHub atingido. Salve um token do GitHub para aumentar o limite.'
  );

  error.code = 'GITHUB_RATE_LIMIT';
  error.isRateLimit = true;
  error.resetAt = resetAt;
  error.githubMessage = message;
  return error;
}

async function fetchJson(url, token) {
  const response = await fetch(url, {
    headers: githubHeaders(token),
    redirect: 'follow'
  });

  if (!response.ok) {
    const message = await responseError(response);
    if (isRateLimitResponse(response, message)) {
      throw rateLimitError(response, message);
    }
    throw new Error(message);
  }

  return {
    data: await response.json(),
    link: response.headers.get('link') || ''
  };
}

async function fetchAllPages(url, token, maxPages = 5) {
  const output = [];
  let nextUrl = url;
  let page = 0;

  while (nextUrl && page < maxPages) {
    page += 1;
    const { data, link } = await fetchJson(nextUrl, token);
    if (!Array.isArray(data)) {
      return data;
    }
    output.push(...data);

    const nextMatch = link.match(/<([^>]+)>;\s*rel="next"/);
    nextUrl = nextMatch ? nextMatch[1] : '';
  }

  return output;
}

async function getSettings() {
  const { settingsFile } = getPaths();
  const stored = await readJson(settingsFile, {});
  return {
    owner: stored.owner || DEFAULT_OWNER,
    token: stored.token || '',
    scanRepositoryFiles: stored.scanRepositoryFiles === true
  };
}

async function saveSettings(partialSettings) {
  const current = await getSettings();
  const next = {
    owner: String(partialSettings.owner || current.owner || DEFAULT_OWNER).trim() || DEFAULT_OWNER,
    token: String(partialSettings.token ?? current.token ?? '').trim(),
    scanRepositoryFiles: Boolean(partialSettings.scanRepositoryFiles)
  };

  await writeJson(getPaths().settingsFile, next);
  return next;
}

async function getInstalledRecords() {
  return readJson(getPaths().installedFile, {});
}

async function getInstallerPreferences() {
  return readJson(getPaths().installerPreferencesFile, {});
}

async function getCatalogCache() {
  return readJson(getPaths().catalogCacheFile, null);
}

async function saveCatalogCache(catalog) {
  await writeJson(getPaths().catalogCacheFile, {
    owner: catalog.owner,
    scannedAt: catalog.scannedAt,
    apps: catalog.apps || [],
    errors: catalog.errors || []
  });
}

function isFreshCatalogCache(cache, owner) {
  if (!cache || !Array.isArray(cache.apps) || cache.owner !== owner || !cache.scannedAt) {
    return false;
  }

  return Date.now() - (Date.parse(cache.scannedAt) || 0) < CATALOG_CACHE_MAX_AGE_MS;
}

function rateLimitNotice(error, usedCache) {
  const reset = error.resetAt
    ? ` Tente de novo depois de ${new Date(error.resetAt).toLocaleString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    })}.`
    : '';

  return {
    repo: 'GitHub',
    message: usedCache
      ? `Limite da API atingido; mostrando cache local.${reset} Salve um token para evitar isso.`
      : `Limite da API atingido.${reset} Salve um token do GitHub nas configurações do Hub.`
  };
}

function normalizeInstallerPreference(preference = {}) {
  const mode = preference.mode === 'run' ? 'run' : 'managed';

  return {
    mode,
    args: String(preference.args || '').trim(),
    waitForExit: Boolean(preference.waitForExit)
  };
}

async function saveInstallerPreference(appId, preference) {
  const preferences = await getInstallerPreferences();
  preferences[appId] = normalizeInstallerPreference(preference);
  await writeJson(getPaths().installerPreferencesFile, preferences);
  return preferences[appId];
}

function installedForRenderer(records) {
  return Object.fromEntries(Object.entries(records).map(([id, record]) => {
    const iconUrl = record.iconPath && existsSync(record.iconPath)
      ? pathToFileURL(record.iconPath).href
      : record.iconUrl;

    return [id, {
      appId: record.appId,
      name: record.name,
      owner: record.owner,
      repo: record.repo,
      repoUrl: record.repoUrl,
      versionKey: record.versionKey,
      versionName: record.versionName,
      fileName: record.fileName,
      exePath: record.exePath,
      installerPath: record.installerPath,
      shortcutPath: record.shortcutPath,
      appDir: record.appDir,
      dataDir: record.dataDir,
      installMode: record.installMode || 'managed',
      installSource: record.installSource || 'managed',
      canUninstall: record.installSource !== 'system' || Boolean(record.uninstallString),
      installedAt: record.installedAt,
      iconUrl
    }];
  }));
}

function normalizeComparableName(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\.[a-z0-9]+$/i, '')
    .replace(/\b(setup|installer|install|portable|windows|win|x64|x86|amd64|ia32|latest|release|app|desktop)\b/gi, ' ')
    .replace(/[^a-z0-9]+/gi, '')
    .toLowerCase();
}

function normalizedWords(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\.[a-z0-9]+$/i, '')
    .replace(/\b(setup|installer|install|portable|windows|win|x64|x86|amd64|ia32|latest|release|app|desktop)\b/gi, ' ')
    .toLowerCase()
    .split(/[^a-z0-9]+/i)
    .filter((word) => word.length >= 3);
}

function appNameCandidates(appInfo) {
  const names = [
    appInfo.name,
    appInfo.repo,
    appInfo.latest?.fileName,
    ...(appInfo.versions || []).slice(0, 5).map((version) => version.fileName)
  ];

  return [...new Set(names
    .map(normalizeComparableName)
    .filter((name) => name.length >= 4))];
}

function scoreInstallEntry(entry, appInfo) {
  const displayName = entry.DisplayName || entry.displayName || '';
  const normalizedDisplay = normalizeComparableName(displayName);
  if (normalizedDisplay.length < 4) return 0;

  const candidates = appNameCandidates(appInfo);
  let score = 0;

  for (const candidate of candidates) {
    if (normalizedDisplay === candidate) score = Math.max(score, 100);
    else if (normalizedDisplay.includes(candidate) && candidate.length >= 5) score = Math.max(score, 88);
    else if (candidate.includes(normalizedDisplay) && normalizedDisplay.length >= 5) score = Math.max(score, 78);
  }

  if (score >= 78) return score;

  const displayWords = new Set(normalizedWords(displayName));
  const appWords = new Set([
    ...normalizedWords(appInfo.name),
    ...normalizedWords(appInfo.repo),
    ...normalizedWords(appInfo.latest?.fileName)
  ]);
  const overlap = [...appWords].filter((word) => displayWords.has(word));

  return overlap.length && overlap.length >= Math.min(2, appWords.size) ? 72 : 0;
}

function extractExePath(value) {
  const text = String(value || '').trim();
  if (!text) return '';

  const quoted = text.match(/^"([^"]+?\.exe)"/i);
  if (quoted) return quoted[1];

  const unquoted = text.match(/([a-z]:\\.*?\.exe)/i);
  if (unquoted) return unquoted[1].replace(/,+$/, '').trim();

  return '';
}

async function pathExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function findBestExeInDirectory(rootDir, appInfo) {
  if (!rootDir || !(await pathExists(rootDir))) return '';

  const candidates = appNameCandidates(appInfo);
  let best = { score: 0, filePath: '' };
  let visited = 0;

  async function walk(currentDir, depth) {
    if (depth > 3 || visited > 1400) return;

    let entries = [];
    try {
      entries = await fs.readdir(currentDir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      visited += 1;
      const fullPath = path.join(currentDir, entry.name);

      if (entry.isDirectory()) {
        if (!/node_modules|resources\\app|locales|swiftshader/i.test(fullPath)) {
          await walk(fullPath, depth + 1);
        }
        continue;
      }

      if (!entry.isFile() || !isExe(entry.name)) continue;
      if (isInstallerFileName(entry.name) || /unins|uninstall|update|crash|helper|elevate/i.test(entry.name)) continue;

      const normalizedFile = normalizeComparableName(entry.name);
      let score = 45;
      for (const candidate of candidates) {
        if (normalizedFile === candidate) score = Math.max(score, 98);
        else if (normalizedFile.includes(candidate) || candidate.includes(normalizedFile)) score = Math.max(score, 82);
      }

      if (score > best.score) {
        best = { score, filePath: fullPath };
      }
    }
  }

  await walk(rootDir, 0);
  return best.score >= 45 ? best.filePath : '';
}

async function queryWindowsInstallInventory() {
  if (process.platform !== 'win32') return [];

  const script = `
$ErrorActionPreference = 'SilentlyContinue'
$items = @()
$roots = @(
  'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*',
  'HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*',
  'HKLM:\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*'
)
foreach ($root in $roots) {
  Get-ItemProperty $root | Where-Object { $_.DisplayName } | ForEach-Object {
    $items += [pscustomobject]@{
      Kind = 'registry'
      DisplayName = $_.DisplayName
      DisplayVersion = $_.DisplayVersion
      Publisher = $_.Publisher
      InstallLocation = $_.InstallLocation
      DisplayIcon = $_.DisplayIcon
      UninstallString = $_.UninstallString
      QuietUninstallString = $_.QuietUninstallString
      TargetPath = ''
      ShortcutPath = ''
    }
  }
}
$shortcutRoots = @(
  "$env:APPDATA\\Microsoft\\Windows\\Start Menu\\Programs",
  "$env:ProgramData\\Microsoft\\Windows\\Start Menu\\Programs",
  "$env:USERPROFILE\\Desktop",
  "$env:PUBLIC\\Desktop"
)
$wsh = New-Object -ComObject WScript.Shell
foreach ($root in $shortcutRoots) {
  if (Test-Path $root) {
    Get-ChildItem -LiteralPath $root -Filter *.lnk -Recurse | ForEach-Object {
      $shortcut = $wsh.CreateShortcut($_.FullName)
      if ($shortcut.TargetPath -and $shortcut.TargetPath.ToLower().EndsWith('.exe')) {
        $items += [pscustomobject]@{
          Kind = 'shortcut'
          DisplayName = $_.BaseName
          DisplayVersion = ''
          Publisher = ''
          InstallLocation = Split-Path $shortcut.TargetPath
          DisplayIcon = $shortcut.TargetPath
          UninstallString = ''
          QuietUninstallString = ''
          TargetPath = $shortcut.TargetPath
          ShortcutPath = $_.FullName
        }
      }
    }
  }
}
$items | ConvertTo-Json -Compress -Depth 4
`;

  try {
    const { stdout } = await execFileAsync(
      'powershell.exe',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script],
      { windowsHide: true, timeout: 20000, maxBuffer: 12 * 1024 * 1024 }
    );
    if (!stdout.trim()) return [];
    const parsed = JSON.parse(stdout);
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch (error) {
    console.warn('Could not query Windows install inventory:', error.message);
    return [];
  }
}

async function resolveSystemExePath(entry, appInfo) {
  const directPaths = [
    entry.TargetPath,
    extractExePath(entry.DisplayIcon),
    extractExePath(entry.UninstallString)
  ].filter(Boolean);

  for (const filePath of directPaths) {
    if (isExe(filePath) && await pathExists(filePath) && !isInstallerFileName(filePath) && !/unins|uninstall/i.test(path.basename(filePath))) {
      return filePath;
    }
  }

  return findBestExeInDirectory(entry.InstallLocation, appInfo);
}

async function buildSystemInstallRecord(appInfo, entry) {
  const exePath = await resolveSystemExePath(entry, appInfo);
  const shortcutPath = entry.ShortcutPath && await pathExists(entry.ShortcutPath) ? entry.ShortcutPath : '';
  if (!exePath && !shortcutPath) return null;

  const paths = getPaths();
  const iconPath = exePath
    ? await extractExeIcon(exePath, path.join(paths.userData, 'system-icons', `${safeSegment(appInfo.id)}.png`))
    : '';

  return {
    appId: appInfo.id,
    name: appInfo.name,
    owner: appInfo.owner,
    repo: appInfo.repo,
    repoUrl: appInfo.repoUrl,
    versionKey: `system:${entry.DisplayVersion || exePath || shortcutPath}`,
    versionName: entry.DisplayVersion || 'Instalado no Windows',
    fileName: path.basename(exePath || shortcutPath),
    exePath,
    shortcutPath,
    appDir: entry.InstallLocation || (exePath ? path.dirname(exePath) : ''),
    dataDir: '',
    installMode: 'system',
    installSource: 'system',
    displayName: entry.DisplayName,
    quietUninstallString: entry.QuietUninstallString || '',
    uninstallString: entry.QuietUninstallString || entry.UninstallString || '',
    iconPath,
    iconUrl: appInfo.iconUrl,
    installedAt: new Date().toISOString()
  };
}

async function detectSystemInstalledApps(apps) {
  const inventory = await queryWindowsInstallInventory();
  const detected = {};

  for (const appInfo of apps) {
    const best = inventory
      .map((entry) => ({ entry, score: scoreInstallEntry(entry, appInfo) }))
      .filter((item) => item.score >= 78)
      .sort((a, b) => b.score - a.score)[0];

    if (!best) continue;

    const record = await buildSystemInstallRecord(appInfo, best.entry);
    if (record) {
      detected[appInfo.id] = record;
    }
  }

  return detected;
}

function appInfoFromInstallRecord(record) {
  return {
    id: record.appId,
    name: record.name,
    owner: record.owner,
    repo: record.repo,
    repoUrl: record.repoUrl,
    iconUrl: record.iconUrl,
    latest: {
      fileName: record.fileName,
      versionName: record.versionName
    },
    versions: [{
      fileName: record.fileName,
      versionName: record.versionName
    }]
  };
}

async function detectInstalledAppForRecord(record) {
  const appInfo = appInfoFromInstallRecord(record);
  const detected = await detectSystemInstalledApps([appInfo]);
  const systemRecord = detected[record.appId];

  if (!systemRecord) return null;

  return {
    ...systemRecord,
    installerPath: record.installerPath || record.exePath || '',
    installerVersionKey: record.installerVersionKey || record.versionKey,
    installerVersionName: record.installerVersionName || record.versionName,
    installedAt: record.installedAt || systemRecord.installedAt
  };
}

async function saveInstalledRecord(record) {
  const installed = await getInstalledRecords();
  installed[record.appId] = record;
  await writeJson(getPaths().installedFile, installed);
  return record;
}

async function getInstalledForCatalog(apps) {
  const records = await getInstalledRecords();
  const nextRecords = { ...records };
  let changed = false;

  for (const [appId, record] of Object.entries(records)) {
    if ((record.installSource || 'managed') !== 'system' && record.exePath && !existsSync(record.exePath)) {
      delete nextRecords[appId];
      changed = true;
    }
  }

  const detected = await detectSystemInstalledApps(apps);
  for (const appInfo of apps) {
    const current = nextRecords[appInfo.id];
    if (current && (current.installSource || 'managed') !== 'system') continue;

    if (detected[appInfo.id]) {
      nextRecords[appInfo.id] = detected[appInfo.id];
      changed = true;
    } else if (current?.installSource === 'system') {
      delete nextRecords[appInfo.id];
      changed = true;
    }
  }

  if (changed) {
    await writeJson(getPaths().installedFile, nextRecords);
  }

  return nextRecords;
}

function cleanRepoName(name) {
  return String(name || '')
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function encodedPath(filePath) {
  return filePath.split('/').map((segment) => encodeURIComponent(segment)).join('/');
}

function isExe(name) {
  return /\.exe$/i.test(name || '');
}

function isInstallerFileName(value) {
  const cleanValue = String(value || '').trim().replace(/^"|"$/g, '');
  const name = path.basename(cleanValue).toLowerCase();

  if (!isExe(name) || /unins|uninstall/.test(name)) return false;

  return /(^|[\s._-])(setup|installer|install|bootstrapper)([\s._-]|$)/i.test(name)
    || /(setup|installer)(?:[\s._-]?v?\d|\.)/i.test(name);
}

function isIconCandidate(name) {
  const ext = path.extname(name || '').toLowerCase();
  return IMAGE_MIME.has(ext) && /(^|\/)(app[-_ ]?icon|icon|logo|favicon|launcher)[^/]*\.(png|jpe?g|webp|gif|svg|ico)$/i.test(name);
}

function scoreIconPath(filePath) {
  const value = filePath.toLowerCase();
  let score = 0;
  if (/(^|\/)app[-_ ]?icon/.test(value)) score += 30;
  if (/(^|\/)icon/.test(value)) score += 24;
  if (/(^|\/)logo/.test(value)) score += 18;
  if (/(^|\/)favicon/.test(value)) score += 12;
  if (/assets|resources|public|build|src/.test(value)) score += 5;
  if (/test|sample|docs/.test(value)) score -= 10;
  return score;
}

function scoreExeAssetName(name) {
  const value = String(name || '').toLowerCase();
  let score = 0;
  if (/setup|installer|install/.test(value)) score += 10;
  if (/portable/.test(value)) score += 6;
  if (/win|windows/.test(value)) score += 4;
  if (/x64|amd64/.test(value)) score += 3;
  if (/arm|ia32|x86/.test(value)) score -= 1;
  return score;
}

function versionTokens(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/^v/, '')
    .match(/\d+(?:[.-]\d+){0,4}(?:[-.][a-z0-9]+)?/g) || [];
}

function scoreReleaseExeAsset(release, asset) {
  const name = String(asset.name || '').toLowerCase();
  const releaseTokens = [
    ...versionTokens(release.tag_name),
    ...versionTokens(release.name)
  ].filter(Boolean);
  let score = scoreExeAssetName(name);

  if (releaseTokens.some((token) => name.includes(token))) score += 80;
  if (/v?\d+(?:\.\d+){1,4}/.test(name)) score += 35;
  if (/latest|stable|download/i.test(name)) score -= 18;
  if (/setup\.exe$/i.test(name) && !/v?\d/.test(name)) score -= 24;

  return score;
}

function selectReleaseExeAssets(release) {
  const exeAssets = (release.assets || []).filter((asset) => isExe(asset.name));
  if (exeAssets.length <= 1) return exeAssets;

  return [exeAssets
    .slice()
    .sort((a, b) => {
      const scoreDelta = scoreReleaseExeAsset(release, b) - scoreReleaseExeAsset(release, a);
      if (scoreDelta) return scoreDelta;
      return (b.size || 0) - (a.size || 0);
    })[0]];
}

function compareVersions(a, b) {
  const dateA = Date.parse(a.createdAt || '') || 0;
  const dateB = Date.parse(b.createdAt || '') || 0;
  if (dateA !== dateB) return dateB - dateA;
  return scoreExeAssetName(b.fileName) - scoreExeAssetName(a.fileName);
}

function releaseAssetToVersion(repo, release, asset) {
  const versionName = release.tag_name || release.name || release.published_at || asset.name;
  return {
    source: 'release',
    versionKey: `release:${release.id}:${asset.id}`,
    versionName,
    releaseName: release.name || release.tag_name || versionName,
    fileName: asset.name,
    size: asset.size || 0,
    createdAt: release.published_at || release.created_at || asset.created_at,
    downloadUrl: asset.browser_download_url,
    downloadApiUrl: asset.url,
    repoUrl: repo.html_url,
    releaseUrl: release.html_url
  };
}

function treeFileToVersion(repo, file) {
  const branch = repo.default_branch || 'main';
  const fileUrl = `${repo.url}/contents/${encodedPath(file.path)}?ref=${encodeURIComponent(branch)}`;
  const rawUrl = `https://raw.githubusercontent.com/${repo.owner.login}/${repo.name}/${encodeURIComponent(branch)}/${encodedPath(file.path)}`;

  return {
    source: 'repository',
    versionKey: `repository:${branch}:${file.path}:${repo.pushed_at || repo.updated_at || ''}`,
    versionName: `${branch} (${new Date(repo.pushed_at || repo.updated_at || Date.now()).toLocaleDateString('pt-BR')})`,
    releaseName: branch,
    fileName: path.basename(file.path),
    filePath: file.path,
    size: file.size || 0,
    createdAt: repo.pushed_at || repo.updated_at,
    downloadUrl: rawUrl,
    downloadApiUrl: fileUrl,
    repoUrl: repo.html_url
  };
}

async function fetchIconDataUrl(apiUrl, token, mime) {
  if (!token) return '';

  const response = await fetch(apiUrl, {
    headers: githubHeaders(token, 'application/vnd.github.raw'),
    redirect: 'follow'
  });

  if (!response.ok) return '';

  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > MAX_ICON_BYTES) return '';
  return `data:${mime};base64,${bytes.toString('base64')}`;
}

async function fetchRepoTree(repo, token) {
  const branch = repo.default_branch || 'main';
  const treeUrl = `${repo.url}/git/trees/${encodeURIComponent(branch)}?recursive=1`;
  const tree = await fetchJson(treeUrl, token);
  return Array.isArray(tree.data.tree) ? tree.data.tree : [];
}

async function iconFromTree(repo, token, tree) {
  const iconFile = tree
    .filter((item) => item.type === 'blob' && isIconCandidate(item.path))
    .sort((a, b) => scoreIconPath(b.path) - scoreIconPath(a.path))[0];

  if (!iconFile) return '';

  const ext = path.extname(iconFile.path).toLowerCase();
  const mime = IMAGE_MIME.get(ext) || 'application/octet-stream';
  const branch = repo.default_branch || 'main';
  const apiUrl = `${repo.url}/contents/${encodedPath(iconFile.path)}?ref=${encodeURIComponent(branch)}`;
  const privateIcon = await fetchIconDataUrl(apiUrl, token, mime);

  if (privateIcon) return privateIcon;

  return `https://raw.githubusercontent.com/${repo.owner.login}/${repo.name}/${encodeURIComponent(branch)}/${encodedPath(iconFile.path)}`;
}

function iconFromReleaseAssets(assets) {
  const asset = assets
    .filter((item) => isIconCandidate(item.name))
    .sort((a, b) => scoreIconPath(b.name) - scoreIconPath(a.name))[0];

  return asset ? asset.browser_download_url : '';
}

function repoIconRawUrl(repo, filePath) {
  const branch = repo.default_branch || 'main';
  return `https://raw.githubusercontent.com/${repo.owner.login}/${repo.name}/${encodeURIComponent(branch)}/${encodedPath(filePath)}`;
}

function uniqueValues(values) {
  return [...new Set(values.filter(Boolean))];
}

function repoIconCandidates(repo) {
  const repoBase = repo.name
    .replace(/[-_]?updates?$/i, '')
    .replace(/[-_]+/g, ' ')
    .trim();
  const compactBase = repoBase.replace(/\s+/g, '-').toLowerCase();
  const spacedBase = repoBase.replace(/\s+/g, ' ').toLowerCase();
  const names = uniqueValues([
    'logo.png',
    'logo.jpg',
    'logo.jpeg',
    'logo.webp',
    'icon.png',
    'icon.jpg',
    'icon.jpeg',
    'app-icon.png',
    'favicon.png',
    'favicon.ico',
    compactBase && `${compactBase}.png`,
    compactBase && `logo-${compactBase}.png`,
    compactBase && `${compactBase}-logo.png`,
    spacedBase && `logo ${spacedBase}.png`,
    spacedBase && `${spacedBase} logo.png`,
    spacedBase && `${spacedBase}.png`
  ]);
  const folders = ['', 'assets/', 'public/', 'src/assets/', 'build/', 'resources/'];

  return uniqueValues(folders.flatMap((folder) => {
    return names.map((name) => repoIconRawUrl(repo, `${folder}${name}`));
  }));
}

async function scanRepo(repo, settings) {
  const token = settings.token;
  const releases = await fetchAllPages(`${repo.url}/releases?per_page=100`, token, 3);
  const visibleReleases = releases.filter((release) => !release.draft);
  const releaseAssets = visibleReleases.flatMap((release) => release.assets || []);
  const releaseVersions = visibleReleases.flatMap((release) => {
    return selectReleaseExeAssets(release)
      .map((asset) => releaseAssetToVersion(repo, release, asset));
  });

  let tree = [];
  let treeIconUrl = '';
  let treeVersions = [];

  if (settings.scanRepositoryFiles && releaseVersions.length === 0) {
    try {
      tree = await fetchRepoTree(repo, token);
      treeIconUrl = await iconFromTree(repo, token, tree);

      treeVersions = tree
        .filter((item) => item.type === 'blob' && isExe(item.path))
        .map((item) => treeFileToVersion(repo, item));
    } catch (error) {
      if (releaseVersions.length === 0) {
        throw error;
      }
    }
  }

  const versions = [...releaseVersions, ...treeVersions].sort(compareVersions);
  if (!versions.length) return null;

  const iconUrl = treeIconUrl || iconFromReleaseAssets(releaseAssets) || repo.owner.avatar_url || resourcePath('assets', 'logo-madiaznx.png');
  const iconUrls = uniqueValues([
    treeIconUrl,
    iconFromReleaseAssets(releaseAssets),
    ...repoIconCandidates(repo),
    repo.owner.avatar_url,
    resourcePath('assets', 'logo-madiaznx.png')
  ]);
  const latest = versions[0];

  return {
    id: `${repo.owner.login}/${repo.name}`,
    owner: repo.owner.login,
    repo: repo.name,
    name: cleanRepoName(repo.name),
    description: repo.description || '',
    repoUrl: repo.html_url,
    iconUrl,
    iconUrls,
    latest,
    versions
  };
}

async function loadRepos(owner, token) {
  const ownerName = owner || DEFAULT_OWNER;
  const publicUrl = `https://api.github.com/users/${encodeURIComponent(ownerName)}/repos?per_page=100&sort=updated&type=owner`;
  const tokenUrl = 'https://api.github.com/user/repos?per_page=100&sort=updated&affiliation=owner,collaborator,organization_member';
  const url = token ? tokenUrl : publicUrl;
  const repos = await fetchAllPages(url, token, 10);

  return repos
    .filter((repo) => !repo.archived)
    .filter((repo) => repo.owner && repo.owner.login.toLowerCase() === ownerName.toLowerCase());
}

async function mapLimit(items, limit, iteratee) {
  const results = new Array(items.length);
  let index = 0;

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (index < items.length) {
      const currentIndex = index;
      index += 1;

      try {
        results[currentIndex] = await iteratee(items[currentIndex], currentIndex);
      } catch (error) {
        results[currentIndex] = { error, item: items[currentIndex] };
      }
    }
  }));

  return results;
}

async function catalogForRenderer(catalog, extraErrors = []) {
  return {
    owner: catalog.owner,
    scannedAt: catalog.scannedAt,
    apps: catalog.apps || [],
    errors: [...(catalog.errors || []), ...extraErrors],
    installed: installedForRenderer(await getInstalledForCatalog(catalog.apps || [])),
    installerPreferences: await getInstallerPreferences(),
    fromCache: Boolean(catalog.fromCache)
  };
}

async function refreshCatalog(_event, options = {}) {
  const settings = await getSettings();
  const cache = await getCatalogCache();
  const force = Boolean(options.force);

  if (!settings.token && !force && isFreshCatalogCache(cache, settings.owner)) {
    return catalogForRenderer({ ...cache, fromCache: true });
  }

  try {
    const repos = await loadRepos(settings.owner, settings.token);
    const scanned = await mapLimit(repos, settings.token ? 4 : 2, (repo) => scanRepo(repo, settings));
    const apps = [];
    const errors = [];

    for (const result of scanned) {
      if (!result) continue;
      if (result.error) {
        if (result.error.isRateLimit) {
          throw result.error;
        }
        errors.push({
          repo: result.item ? `${result.item.owner.login}/${result.item.name}` : 'repositorio',
          message: result.error.message
        });
        continue;
      }
      apps.push(result);
    }

    apps.sort((a, b) => compareVersions(a.latest, b.latest));

    const catalog = {
      owner: settings.owner,
      scannedAt: new Date().toISOString(),
      apps,
      errors
    };

    await saveCatalogCache(catalog);
    return catalogForRenderer(catalog);
  } catch (error) {
    if (error.isRateLimit && cache && cache.owner === settings.owner && Array.isArray(cache.apps)) {
      return catalogForRenderer(
        { ...cache, fromCache: true },
        [rateLimitNotice(error, true)]
      );
    }

    if (error.isRateLimit) {
      const friendly = new Error(rateLimitNotice(error, false).message);
      friendly.code = error.code;
      throw friendly;
    }

    throw error;
  }
}

async function downloadToFile(version, destinationPath, token, onProgress) {
  const candidates = downloadCandidates(version, token);
  let response;
  let lastError = '';

  for (const candidate of candidates) {
    response = await fetch(candidate.url, {
      headers: candidate.headers,
      redirect: 'follow'
    });

    if (response.ok) break;
    lastError = await responseError(response);
    response = null;
  }

  if (!response) {
    throw new Error(lastError || 'Falha ao baixar arquivo.');
  }

  await fs.mkdir(path.dirname(destinationPath), { recursive: true });
  const tempPath = `${destinationPath}.download`;
  const total = Number(response.headers.get('content-length')) || version.size || 0;
  let transferred = 0;
  let lastReportedAt = 0;

  if (typeof onProgress === 'function') {
    onProgress({
      transferred,
      total,
      percent: total ? 0 : null,
      indeterminate: !total
    });
  }

  const stream = Readable.fromWeb(response.body);
  stream.on('data', (chunk) => {
    transferred += chunk.length;
    const now = Date.now();

    if (typeof onProgress === 'function' && (now - lastReportedAt > 120 || (total && transferred >= total))) {
      lastReportedAt = now;
      onProgress({
        transferred,
        total,
        percent: total ? Math.min(100, Math.round((transferred / total) * 100)) : null,
        indeterminate: !total
      });
    }
  });

  await pipeline(stream, createWriteStream(tempPath));
  await fs.rename(tempPath, destinationPath);
}

function downloadCandidates(version, token) {
  const authHeaders = token ? githubHeaders(token, 'application/octet-stream') : { 'User-Agent': USER_AGENT };

  if (version.source === 'release') {
    return [
      version.downloadUrl && {
        url: version.downloadUrl,
        headers: authHeaders
      },
      token && version.downloadApiUrl && {
        url: version.downloadApiUrl,
        headers: githubHeaders(token, 'application/octet-stream')
      }
    ].filter(Boolean);
  }

  return [
    !token && version.downloadUrl && {
      url: version.downloadUrl,
      headers: { 'User-Agent': USER_AGENT }
    },
    version.downloadApiUrl && {
      url: version.downloadApiUrl,
      headers: token ? githubHeaders(token, 'application/vnd.github.raw') : { 'User-Agent': USER_AGENT }
    },
    version.downloadUrl && {
      url: version.downloadUrl,
      headers: authHeaders
    }
  ].filter(Boolean);
}

function formatBytes(bytes) {
  const value = Number(bytes || 0);
  if (!value) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let amount = value;
  let unit = 0;

  while (amount >= 1024 && unit < units.length - 1) {
    amount /= 1024;
    unit += 1;
  }

  return `${amount.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
}

function downloadProgressMessage(progress, fallback) {
  if (!progress.total) {
    return `${fallback} - ${formatBytes(progress.transferred)}`;
  }

  return `${progress.percent}% - ${formatBytes(progress.transferred)} de ${formatBytes(progress.total)}`;
}

async function extractExeIcon(exePath, iconPath) {
  if (process.platform !== 'win32') return '';

  const command = [
    'Add-Type -AssemblyName System.Drawing;',
    '$exe = $args[0];',
    '$out = $args[1];',
    '$icon = [System.Drawing.Icon]::ExtractAssociatedIcon($exe);',
    'if ($null -eq $icon) { exit 2 }',
    '$bitmap = $icon.ToBitmap();',
    '$bitmap.Save($out, [System.Drawing.Imaging.ImageFormat]::Png);',
    '$bitmap.Dispose();',
    '$icon.Dispose();'
  ].join(' ');

  try {
    await fs.mkdir(path.dirname(iconPath), { recursive: true });
    await execFileAsync(
      'powershell.exe',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', command, exePath, iconPath],
      { windowsHide: true, timeout: 15000 }
    );
    return iconPath;
  } catch (error) {
    console.warn(`Could not extract icon from ${exePath}:`, error.message);
    return '';
  }
}

function splitCommandLineArgs(input) {
  const args = [];
  const pattern = /"([^"\\]*(?:\\.[^"\\]*)*)"|'([^']*)'|([^\s]+)/g;
  let match;

  while ((match = pattern.exec(input || '')) !== null) {
    const value = match[1] ?? match[2] ?? match[3] ?? '';
    args.push(value.replace(/\\"/g, '"'));
  }

  return args;
}

function normalizeMsiUninstallArgs(command, args) {
  if (!/msiexec(?:\.exe)?$/i.test(command)) {
    return args;
  }

  const normalized = args.length ? [...args] : [];
  const installIndex = normalized.findIndex((arg) => /^\/i/i.test(arg));

  if (installIndex >= 0) {
    normalized[installIndex] = normalized[installIndex].replace(/^\/i/i, '/X');
  } else if (!normalized.some((arg) => /^\/x/i.test(arg))) {
    normalized.unshift('/X');
  }

  return normalized;
}

function expandWindowsEnvVars(value) {
  return String(value || '').replace(/%([^%]+)%/g, (_match, name) => process.env[name] || process.env[name.toUpperCase()] || '');
}

async function runExternalUninstaller(record) {
  const commandLine = record.uninstallString || record.quietUninstallString || '';
  const parts = splitCommandLineArgs(commandLine);

  if (!parts.length) {
    throw new Error('Este app nao informou um desinstalador no Windows.');
  }

  const command = expandWindowsEnvVars(parts.shift());
  const args = normalizeMsiUninstallArgs(command, parts.map(expandWindowsEnvVars));
  const child = spawn(command, args, {
    cwd: record.appDir && existsSync(record.appDir) ? record.appDir : undefined,
    detached: false,
    stdio: 'ignore',
    windowsHide: false
  });

  await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code) => {
      if (code === 0 || code === null || code === 3010) {
        resolve();
        return;
      }
      reject(new Error(`Desinstalador finalizou com codigo ${code}.`));
    });
  });
}

async function runDownloadedInstaller(exePath, preference) {
  const args = splitCommandLineArgs(preference.args);
  const child = spawn(exePath, args, {
    cwd: path.dirname(exePath),
    detached: !preference.waitForExit,
    stdio: 'ignore',
    windowsHide: false
  });

  if (!preference.waitForExit) {
    child.unref();
    return;
  }

  await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code) => {
      if (code === 0 || code === null) {
        resolve();
        return;
      }
      reject(new Error(`Instalador finalizou com codigo ${code}.`));
    });
  });
}

async function installManagedApp(payload, onProgress) {
  const settings = await getSettings();
  const { appInfo, version = appInfo.latest } = payload;
  const paths = getPaths();
  const installed = await getInstalledRecords();
  const installerPreferences = await getInstallerPreferences();
  const installPreference = normalizeInstallerPreference(installerPreferences[appInfo.id]);
  const appDir = path.join(paths.installRoot, safeSegment(appInfo.id));
  const versionDir = path.join(appDir, safeSegment(version.versionKey));
  const dataDir = path.join(paths.appDataRoot, safeSegment(appInfo.id));
  const fileName = safeFileName(version.fileName);
  const downloadedFileIsInstaller = isInstallerFileName(fileName);
  const effectiveInstallPreference = downloadedFileIsInstaller
    ? { ...installPreference, mode: 'run', waitForExit: true }
    : installPreference;
  const exePath = path.join(versionDir, fileName);
  const iconPath = path.join(appDir, 'icon.png');

  assertInside(paths.installRoot, appDir);
  assertInside(paths.appDataRoot, dataDir);

  await fs.rm(appDir, { recursive: true, force: true });
  await fs.mkdir(versionDir, { recursive: true });
  await fs.mkdir(dataDir, { recursive: true });

  onProgress({ appId: appInfo.id, status: 'downloading', percent: null, indeterminate: true, message: 'Iniciando download' });
  await downloadToFile(version, exePath, settings.token, (progress) => {
    onProgress({
      appId: appInfo.id,
      status: 'downloading',
      percent: progress.percent,
      indeterminate: progress.indeterminate,
      message: downloadProgressMessage(progress, 'Baixando')
    });
  });

  onProgress({ appId: appInfo.id, status: 'installing', percent: 100, message: 'Preparando' });
  const extractedIconPath = await extractExeIcon(exePath, iconPath);

  if (effectiveInstallPreference.mode === 'run') {
    onProgress({ appId: appInfo.id, status: 'installing', percent: 100, message: 'Executando instalador' });
    await runDownloadedInstaller(exePath, effectiveInstallPreference);

    onProgress({ appId: appInfo.id, status: 'installing', percent: 100, message: 'Detectando aplicativo instalado' });
    const detectedRecord = await detectInstalledAppForRecord({
      appId: appInfo.id,
      name: appInfo.name,
      owner: appInfo.owner,
      repo: appInfo.repo,
      repoUrl: appInfo.repoUrl,
      versionKey: version.versionKey,
      versionName: version.versionName,
      fileName,
      exePath,
      installerPath: exePath,
      appDir,
      dataDir,
      installMode: 'run',
      installSource: 'installer',
      iconUrl: appInfo.iconUrl,
      installedAt: new Date().toISOString()
    });

    if (detectedRecord) {
      installed[appInfo.id] = detectedRecord;
      await writeJson(paths.installedFile, installed);
      onProgress({ appId: appInfo.id, status: 'done', percent: 100, message: 'Concluido' });
      return installedForRenderer({ [appInfo.id]: detectedRecord })[appInfo.id];
    }
  }

  const record = {
    appId: appInfo.id,
    name: appInfo.name,
    owner: appInfo.owner,
    repo: appInfo.repo,
    repoUrl: appInfo.repoUrl,
    versionKey: version.versionKey,
    versionName: version.versionName,
    fileName,
    exePath: effectiveInstallPreference.mode === 'run' ? '' : exePath,
    installerPath: effectiveInstallPreference.mode === 'run' ? exePath : '',
    appDir,
    dataDir,
    installMode: effectiveInstallPreference.mode,
    installSource: effectiveInstallPreference.mode === 'run' ? 'installer' : 'managed',
    installerArgs: effectiveInstallPreference.args,
    installerWaitForExit: effectiveInstallPreference.waitForExit,
    iconPath: extractedIconPath,
    iconUrl: appInfo.iconUrl,
    installedAt: new Date().toISOString()
  };

  installed[appInfo.id] = record;
  await writeJson(paths.installedFile, installed);
  onProgress({ appId: appInfo.id, status: 'done', percent: 100, message: 'Concluido' });

  return installedForRenderer({ [appInfo.id]: record })[appInfo.id];
}

async function uninstallManagedApp(appId) {
  const paths = getPaths();
  const installed = await getInstalledRecords();
  const record = installed[appId];

  if (!record) {
    return { removed: false };
  }

  if (record.installSource === 'system') {
    await runExternalUninstaller(record);
    delete installed[appId];
    await writeJson(paths.installedFile, installed);
    return { removed: true, external: true };
  }

  assertInside(paths.installRoot, record.appDir);
  assertInside(paths.appDataRoot, record.dataDir);

  await Promise.all([
    fs.rm(record.appDir, { recursive: true, force: true }),
    fs.rm(record.dataDir, { recursive: true, force: true })
  ]);

  delete installed[appId];
  await writeJson(paths.installedFile, installed);

  return { removed: true };
}

async function launchInstallRecord(record) {
  if (record.exePath && existsSync(record.exePath) && !isInstallerFileName(record.exePath)) {
    const child = spawn(record.exePath, [], {
      cwd: path.dirname(record.exePath),
      detached: true,
      stdio: 'ignore',
      env: {
        ...process.env,
        MADIAZNX_APP_DATA_DIR: record.dataDir || ''
      }
    });

    child.unref();
    return { opened: true };
  }

  if (record.shortcutPath && existsSync(record.shortcutPath)) {
    const error = await shell.openPath(record.shortcutPath);
    if (!error) return { opened: true };
    throw new Error(error);
  }

  return null;
}

function shouldResolveInstalledAppBeforeOpen(record) {
  if (record.installMode === 'run' || record.installSource === 'installer') return true;
  if ((record.installSource || 'managed') === 'system') return false;

  return isInstallerFileName(record.exePath)
    || (!record.exePath && isInstallerFileName(record.installerPath || record.fileName));
}

async function openManagedApp(appId) {
  const installed = await getInstalledRecords();
  const record = installed[appId];

  if (!record) {
    throw new Error('Aplicativo instalado nao encontrado.');
  }

  if (shouldResolveInstalledAppBeforeOpen(record)) {
    const detectedRecord = await detectInstalledAppForRecord(record);

    if (detectedRecord) {
      installed[appId] = detectedRecord;
      await writeJson(getPaths().installedFile, installed);
      const opened = await launchInstallRecord(detectedRecord);
      if (opened) return opened;
    }

    throw new Error('O instalador foi baixado, mas o app instalado ainda nao foi localizado no Windows.');
  }

  const opened = await launchInstallRecord(record);
  if (opened) return opened;

  throw new Error('Aplicativo instalado nao encontrado.');
}

async function downloadVersion(payload, onProgress) {
  const settings = await getSettings();
  const { appInfo, version } = payload;
  const defaultPath = path.join(app.getPath('downloads'), safeFileName(version.fileName));
  const result = await dialog.showSaveDialog(mainWindow, {
    title: 'Baixar versao',
    defaultPath,
    filters: [
      { name: 'Executaveis', extensions: ['exe'] },
      { name: 'Todos os arquivos', extensions: ['*'] }
    ]
  });

  if (result.canceled || !result.filePath) {
    return { canceled: true };
  }

  onProgress({ appId: appInfo.id, status: 'downloading', percent: null, indeterminate: true, message: 'Iniciando download' });
  await downloadToFile(version, result.filePath, settings.token, (progress) => {
    onProgress({
      appId: appInfo.id,
      status: 'downloading',
      percent: progress.percent,
      indeterminate: progress.indeterminate,
      message: downloadProgressMessage(progress, 'Baixando versao')
    });
  });
  onProgress({ appId: appInfo.id, status: 'done', percent: 100, message: 'Baixado' });

  return { canceled: false, filePath: result.filePath };
}

async function getInitialState() {
  await ensureBaseFolders();
  return {
    settings: await getSettings(),
    installed: installedForRenderer(await getInstalledRecords()),
    installerPreferences: await getInstallerPreferences()
  };
}

function sendUpdateStatus(payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('updates:status', payload);
  }
}

function setupAutoUpdates() {
  if (!autoUpdater || !app.isPackaged) {
    return;
  }

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('checking-for-update', () => sendUpdateStatus({
    type: 'checking',
    message: 'Procurando atualização do Hub'
  }));

  autoUpdater.on('update-available', (info) => sendUpdateStatus({
    type: 'available',
    message: `Atualização ${info.version} encontrada`
  }));

  autoUpdater.on('update-not-available', () => sendUpdateStatus({
    type: 'none',
    message: 'Hub atualizado'
  }));

  autoUpdater.on('download-progress', (progress) => sendUpdateStatus({
    type: 'downloading',
    message: `Baixando atualização do Hub ${Math.round(progress.percent || 0)}%`
  }));

  autoUpdater.on('update-downloaded', (info) => sendUpdateStatus({
    type: 'downloaded',
    message: `Atualização ${info.version} pronta. Ela será aplicada ao reiniciar.`
  }));

  autoUpdater.on('error', (error) => sendUpdateStatus({
    type: 'error',
    message: error.message
  }));

  setTimeout(() => {
    autoUpdater.checkForUpdatesAndNotify().catch((error) => {
      sendUpdateStatus({ type: 'error', message: error.message });
    });
  }, 2500);
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 760,
    minWidth: 860,
    minHeight: 620,
    title: APP_NAME,
    icon: resourcePath('assets', 'logo-madiaznx.png'),
    backgroundColor: '#10131a',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

ipcMain.handle('state:get', getInitialState);
ipcMain.handle('settings:save', async (_event, settings) => saveSettings(settings));
ipcMain.handle('installer-preferences:save', async (_event, payload) => saveInstallerPreference(payload.appId, payload.preference));
ipcMain.handle('catalog:refresh', refreshCatalog);
ipcMain.handle('apps:install', async (event, payload) => installManagedApp(payload, (progress) => {
  event.sender.send('apps:progress', progress);
}));
ipcMain.handle('apps:uninstall', async (_event, payload) => uninstallManagedApp(payload.appId));
ipcMain.handle('apps:open', async (_event, payload) => openManagedApp(payload.appId));
ipcMain.handle('apps:download-version', async (event, payload) => downloadVersion(payload, (progress) => {
  event.sender.send('apps:progress', progress);
}));
ipcMain.handle('shell:open-external', async (_event, payload) => {
  if (/^https?:\/\//i.test(payload.url)) {
    await shell.openExternal(payload.url);
    return { opened: true };
  }
  throw new Error('Link externo invalido.');
});

app.whenReady().then(async () => {
  await ensureBaseFolders();
  createWindow();
  setupAutoUpdates();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
