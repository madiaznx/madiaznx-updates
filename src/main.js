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

async function fetchJson(url, token) {
  const response = await fetch(url, {
    headers: githubHeaders(token),
    redirect: 'follow'
  });

  if (!response.ok) {
    throw new Error(await responseError(response));
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
    scanRepositoryFiles: stored.scanRepositoryFiles !== false
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
      appDir: record.appDir,
      dataDir: record.dataDir,
      installMode: record.installMode || 'managed',
      installedAt: record.installedAt,
      iconUrl
    }];
  }));
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

async function scanRepo(repo, settings) {
  const token = settings.token;
  const releases = await fetchAllPages(`${repo.url}/releases?per_page=100`, token, 3);
  const visibleReleases = releases.filter((release) => !release.draft);
  const releaseAssets = visibleReleases.flatMap((release) => release.assets || []);
  const releaseVersions = visibleReleases.flatMap((release) => {
    return (release.assets || [])
      .filter((asset) => isExe(asset.name))
      .map((asset) => releaseAssetToVersion(repo, release, asset));
  });

  let tree = [];
  let treeIconUrl = '';
  let treeVersions = [];

  if (settings.scanRepositoryFiles || releaseVersions.length > 0) {
    try {
      tree = await fetchRepoTree(repo, token);
      treeIconUrl = await iconFromTree(repo, token, tree);

      if (settings.scanRepositoryFiles && releaseVersions.length === 0) {
        treeVersions = tree
          .filter((item) => item.type === 'blob' && isExe(item.path))
          .map((item) => treeFileToVersion(repo, item));
      }
    } catch (error) {
      if (releaseVersions.length === 0) {
        throw error;
      }
    }
  }

  const versions = [...releaseVersions, ...treeVersions].sort(compareVersions);
  if (!versions.length) return null;

  const iconUrl = treeIconUrl || iconFromReleaseAssets(releaseAssets) || repo.owner.avatar_url || resourcePath('assets', 'logo-madiaznx.png');
  const latest = versions[0];

  return {
    id: `${repo.owner.login}/${repo.name}`,
    owner: repo.owner.login,
    repo: repo.name,
    name: cleanRepoName(repo.name),
    description: repo.description || '',
    repoUrl: repo.html_url,
    iconUrl,
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

async function refreshCatalog() {
  const settings = await getSettings();
  const repos = await loadRepos(settings.owner, settings.token);
  const scanned = await mapLimit(repos, 4, (repo) => scanRepo(repo, settings));
  const apps = [];
  const errors = [];

  for (const result of scanned) {
    if (!result) continue;
    if (result.error) {
      errors.push({
        repo: result.item ? `${result.item.owner.login}/${result.item.name}` : 'repositorio',
        message: result.error.message
      });
      continue;
    }
    apps.push(result);
  }

  apps.sort((a, b) => compareVersions(a.latest, b.latest));

  return {
    owner: settings.owner,
    scannedAt: new Date().toISOString(),
    apps,
    errors,
    installed: installedForRenderer(await getInstalledRecords()),
    installerPreferences: await getInstallerPreferences()
  };
}

async function downloadToFile(version, destinationPath, token, onProgress) {
  const useApiUrl = Boolean(token && version.downloadApiUrl);
  const url = useApiUrl ? version.downloadApiUrl : version.downloadUrl;
  const accept = version.source === 'repository'
    ? 'application/vnd.github.raw'
    : (useApiUrl ? 'application/octet-stream' : '*/*');
  const headers = useApiUrl ? githubHeaders(token, accept) : { 'User-Agent': USER_AGENT };
  const response = await fetch(url, { headers, redirect: 'follow' });

  if (!response.ok) {
    throw new Error(await responseError(response));
  }

  await fs.mkdir(path.dirname(destinationPath), { recursive: true });
  const tempPath = `${destinationPath}.download`;
  const total = Number(response.headers.get('content-length')) || version.size || 0;
  let transferred = 0;

  const stream = Readable.fromWeb(response.body);
  stream.on('data', (chunk) => {
    transferred += chunk.length;
    if (typeof onProgress === 'function') {
      onProgress({
        transferred,
        total,
        percent: total ? Math.round((transferred / total) * 100) : 0
      });
    }
  });

  await pipeline(stream, createWriteStream(tempPath));
  await fs.rename(tempPath, destinationPath);
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
  const exePath = path.join(versionDir, fileName);
  const iconPath = path.join(appDir, 'icon.png');

  assertInside(paths.installRoot, appDir);
  assertInside(paths.appDataRoot, dataDir);

  await fs.rm(appDir, { recursive: true, force: true });
  await fs.mkdir(versionDir, { recursive: true });
  await fs.mkdir(dataDir, { recursive: true });

  onProgress({ appId: appInfo.id, status: 'downloading', percent: 0, message: 'Baixando' });
  await downloadToFile(version, exePath, settings.token, (progress) => {
    onProgress({
      appId: appInfo.id,
      status: 'downloading',
      percent: progress.percent,
      message: progress.total ? `${progress.percent}%` : 'Baixando'
    });
  });

  onProgress({ appId: appInfo.id, status: 'installing', percent: 100, message: 'Preparando' });
  const extractedIconPath = await extractExeIcon(exePath, iconPath);

  if (installPreference.mode === 'run') {
    onProgress({ appId: appInfo.id, status: 'installing', percent: 100, message: 'Executando instalador' });
    await runDownloadedInstaller(exePath, installPreference);
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
    exePath,
    appDir,
    dataDir,
    installMode: installPreference.mode,
    installerArgs: installPreference.args,
    installerWaitForExit: installPreference.waitForExit,
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

async function openManagedApp(appId) {
  const installed = await getInstalledRecords();
  const record = installed[appId];

  if (!record || !existsSync(record.exePath)) {
    throw new Error('Aplicativo instalado nao encontrado.');
  }

  const child = spawn(record.exePath, [], {
    cwd: path.dirname(record.exePath),
    detached: true,
    stdio: 'ignore',
    env: {
      ...process.env,
      MADIAZNX_APP_DATA_DIR: record.dataDir
    }
  });

  child.unref();
  return { opened: true };
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

  onProgress({ appId: appInfo.id, status: 'downloading', percent: 0, message: 'Baixando versao' });
  await downloadToFile(version, result.filePath, settings.token, (progress) => {
    onProgress({
      appId: appInfo.id,
      status: 'downloading',
      percent: progress.percent,
      message: progress.total ? `${progress.percent}%` : 'Baixando versao'
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
