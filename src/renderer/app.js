const hub = window.madiaznxHub;
const fallbackLogo = '../../assets/logo-madiaznx.png';

const state = {
  settings: null,
  apps: [],
  installed: {},
  installerPreferences: {},
  errors: [],
  scannedAt: '',
  loading: false,
  selectedApp: null,
  installerApp: null,
  pendingInstallerAction: null,
  progress: {},
  updateStatus: '',
  theme: localStorage.getItem('madiaznx-theme') || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
};

const elements = {};

const icons = {
  refresh: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M21 12a9 9 0 0 1-15.3 6.4"/><path d="M3 12A9 9 0 0 1 18.3 5.6"/><path d="M18 2v4h-4"/><path d="M6 22v-4h4"/></svg>',
  moon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M20.5 14.5A8.5 8.5 0 0 1 9.5 3.5 8.5 8.5 0 1 0 20.5 14.5Z"/></svg>',
  sun: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/></svg>',
  save: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2Z"/><path d="M17 21v-8H7v8"/><path d="M7 3v5h8"/></svg>',
  install: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M5 21h14"/></svg>',
  versions: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M8 6h13"/><path d="M8 12h13"/><path d="M8 18h13"/><path d="M3 6h.01"/><path d="M3 12h.01"/><path d="M3 18h.01"/></svg>',
  update: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M21 12a9 9 0 0 1-9 9 8.8 8.8 0 0 1-6.3-2.6"/><path d="M3 12a9 9 0 0 1 15.3-6.4"/><path d="M18 2v4h-4"/></svg>',
  trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 15H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/></svg>',
  play: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="m8 5 11 7-11 7Z"/></svg>',
  external: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/></svg>',
  close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>',
  check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="m20 6-11 11-5-5"/></svg>',
  download: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M7 10l5 5 5-5"/><path d="M12 15V3"/></svg>',
  gear: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M12 15.5A3.5 3.5 0 1 0 12 8a3.5 3.5 0 0 0 0 7.5Z"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1A2 2 0 1 1 4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.6-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.3 7A2 2 0 1 1 7.1 4.2l.1.1a1.7 1.7 0 0 0 1.9.3h.1a1.7 1.7 0 0 0 1-1.6V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1A2 2 0 1 1 20 7.1l-.1.1a1.7 1.7 0 0 0-.3 1.9v.1a1.7 1.7 0 0 0 1.6 1h.1a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.8.8Z"/></svg>'
};

document.addEventListener('DOMContentLoaded', init);

async function init() {
  cacheElements();
  bindEvents();
  applyTheme();

  try {
    const initial = await hub.getState();
    state.settings = initial.settings;
    state.installed = initial.installed || {};
    state.installerPreferences = initial.installerPreferences || {};
    hydrateSettings();
    await refreshCatalog();
  } catch (error) {
    showToast(error.message, 'error');
    render();
  }
}

function cacheElements() {
  elements.headlineStatus = document.getElementById('headlineStatus');
  elements.refreshButton = document.getElementById('refreshButton');
  elements.themeButton = document.getElementById('themeButton');
  elements.ownerInput = document.getElementById('ownerInput');
  elements.tokenInput = document.getElementById('tokenInput');
  elements.scanRepositoryFilesInput = document.getElementById('scanRepositoryFilesInput');
  elements.saveSettingsButton = document.getElementById('saveSettingsButton');
  elements.appsList = document.getElementById('appsList');
  elements.notice = document.getElementById('notice');
  elements.versionsDialog = document.getElementById('versionsDialog');
  elements.versionsTitle = document.getElementById('versionsTitle');
  elements.versionsSubtitle = document.getElementById('versionsSubtitle');
  elements.versionsList = document.getElementById('versionsList');
  elements.closeVersionsButton = document.getElementById('closeVersionsButton');
  elements.installerDialog = document.getElementById('installerDialog');
  elements.installerTitle = document.getElementById('installerTitle');
  elements.installerSubtitle = document.getElementById('installerSubtitle');
  elements.installerForm = document.getElementById('installerForm');
  elements.installerArgsInput = document.getElementById('installerArgsInput');
  elements.waitForExitInput = document.getElementById('waitForExitInput');
  elements.closeInstallerButton = document.getElementById('closeInstallerButton');
  elements.saveInstallerOptionsButton = document.getElementById('saveInstallerOptionsButton');
  elements.toastStack = document.getElementById('toastStack');
}

function bindEvents() {
  elements.refreshButton.addEventListener('click', refreshCatalog);
  elements.themeButton.addEventListener('click', toggleTheme);
  elements.saveSettingsButton.addEventListener('click', saveSettings);
  elements.appsList.addEventListener('click', handleAppAction);
  elements.versionsList.addEventListener('click', handleVersionAction);
  elements.closeVersionsButton.addEventListener('click', () => elements.versionsDialog.close());
  elements.closeInstallerButton.addEventListener('click', () => elements.installerDialog.close());
  elements.installerForm.addEventListener('submit', saveInstallerOptions);
  elements.versionsDialog.addEventListener('close', () => {
    state.selectedApp = null;
  });
  elements.installerDialog.addEventListener('close', () => {
    state.installerApp = null;
    state.pendingInstallerAction = null;
  });

  hub.onProgress((payload) => {
    state.progress[payload.appId] = payload;
    render();
    if (payload.status === 'done') {
      setTimeout(() => {
        delete state.progress[payload.appId];
        render();
      }, 1200);
    }
  });

  hub.onUpdateStatus((payload) => {
    state.updateStatus = payload.message || '';
    if (['available', 'downloaded', 'error'].includes(payload.type)) {
      showToast(payload.message, payload.type === 'error' ? 'error' : 'success');
    }
    render();
  });
}

function hydrateSettings() {
  const settings = state.settings || {};
  elements.ownerInput.value = settings.owner || 'MadiaznX';
  elements.tokenInput.value = settings.token || '';
  elements.scanRepositoryFilesInput.checked = settings.scanRepositoryFiles !== false;
}

async function saveSettings() {
  setButtonBusy(elements.saveSettingsButton, true);
  try {
    state.settings = await hub.saveSettings({
      owner: elements.ownerInput.value,
      token: elements.tokenInput.value,
      scanRepositoryFiles: elements.scanRepositoryFilesInput.checked
    });
    showToast('Configurações salvas.', 'success');
    await refreshCatalog();
  } catch (error) {
    showToast(error.message, 'error');
  } finally {
    setButtonBusy(elements.saveSettingsButton, false);
    renderTopButtons();
  }
}

async function refreshCatalog() {
  state.loading = true;
  render();

  try {
    const catalog = await hub.refreshCatalog();
    state.apps = catalog.apps || [];
    state.installed = catalog.installed || {};
    state.installerPreferences = catalog.installerPreferences || state.installerPreferences;
    state.errors = catalog.errors || [];
    state.scannedAt = catalog.scannedAt || new Date().toISOString();
  } catch (error) {
    state.errors = [{ repo: 'GitHub', message: error.message }];
    showToast(error.message, 'error');
  } finally {
    state.loading = false;
    render();
  }
}

function render() {
  renderTopButtons();
  renderNotice();
  renderApps();
  if (state.selectedApp && elements.versionsDialog.open) {
    renderVersionsDialog(state.selectedApp);
  }
}

function renderTopButtons() {
  elements.refreshButton.innerHTML = icons.refresh;
  elements.refreshButton.disabled = state.loading;
  elements.themeButton.innerHTML = state.theme === 'dark' ? icons.sun : icons.moon;
  elements.themeButton.title = state.theme === 'dark' ? 'Modo claro' : 'Modo escuro';
  elements.saveSettingsButton.innerHTML = `${icons.save}<span>Salvar</span>`;

  if (state.loading) {
    elements.headlineStatus.textContent = 'Procurando executáveis no GitHub';
    return;
  }

  if (state.updateStatus) {
    elements.headlineStatus.textContent = state.updateStatus;
    return;
  }

  const count = state.apps.length;
  const label = count === 1 ? '1 app encontrado' : `${count} apps encontrados`;
  elements.headlineStatus.textContent = state.scannedAt
    ? `${label} • ${formatDateTime(state.scannedAt)}`
    : label;
}

function renderNotice() {
  if (!state.errors.length) {
    elements.notice.hidden = true;
    elements.notice.textContent = '';
    return;
  }

  const first = state.errors.slice(0, 3).map((item) => `${item.repo}: ${item.message}`).join(' | ');
  elements.notice.hidden = false;
  elements.notice.textContent = state.errors.length > 3 ? `${first} | mais ${state.errors.length - 3}` : first;
}

function renderApps() {
  if (state.loading && state.apps.length === 0) {
    elements.appsList.innerHTML = '<div class="loading-state">Sincronizando...</div>';
    return;
  }

  if (state.apps.length === 0) {
    elements.appsList.innerHTML = '<div class="empty-state">Nenhum .exe encontrado.</div>';
    return;
  }

  elements.appsList.innerHTML = state.apps.map(renderAppCard).join('');
  requestAnimationFrame(() => {
    bindIconFallbacks();
    markMonochromeIcons();
  });
}

function installedLabel(installed) {
  return installed?.installSource === 'system' ? 'Instalado no Windows' : 'Instalado';
}

function normalizedVersion(value) {
  const match = String(value || '').toLowerCase().match(/v?(\d+(?:\.\d+){0,3}(?:[-+][a-z0-9.-]+)?)/);
  return match ? match[1].replace(/^v/, '') : '';
}

function hasUpdateAvailable(installed, latest) {
  if (!installed || !latest) return false;
  if (installed.versionKey === latest.versionKey) return false;

  if (installed.installSource === 'system') {
    const installedVersion = normalizedVersion(installed.versionName);
    const latestVersion = normalizedVersion(latest.versionName);
    return Boolean(installedVersion && latestVersion && installedVersion !== latestVersion);
  }

  return true;
}

function renderAppCard(appInfo) {
  const installed = state.installed[appInfo.id];
  const latest = appInfo.latest;
  const progress = state.progress[appInfo.id];
  const hasUpdate = hasUpdateAvailable(installed, latest);
  const iconUrl = installed?.iconUrl || appInfo.iconUrl || fallbackLogo;
  const description = appInfo.description || appInfo.repoUrl;
  const statusPill = installed
    ? `<span class="state-pill ${hasUpdate ? 'update' : 'installed'}">${hasUpdate ? 'Atualização disponível' : installedLabel(installed)}</span>`
    : '';

  return `
    <article class="app-card" data-app-id="${escapeHtml(appInfo.id)}">
      <div class="app-icon-wrap">
        <img class="app-icon" src="${escapeAttr(iconUrl)}" alt="" crossorigin="anonymous" data-fallback="${escapeAttr(fallbackLogo)}" />
      </div>
      <div class="app-main">
        <div class="app-title-row">
          <h2 class="app-title">${escapeHtml(appInfo.name)}</h2>
          ${statusPill}
        </div>
        <p class="app-description">${escapeHtml(description)}</p>
        <div class="app-meta">
          <span class="meta-chip">${escapeHtml(latest.versionName || 'latest')}</span>
          <span class="meta-chip">${formatSize(latest.size)}</span>
          <span class="meta-chip">${sourceLabel(latest.source)}</span>
          ${installed ? `<span class="meta-chip">Atual: ${escapeHtml(installed.versionName)}</span>` : ''}
          ${installed?.installSource === 'system' ? '<span class="meta-chip">Detectado pelo Windows</span>' : ''}
        </div>
      </div>
      <div class="app-actions">
        ${renderActions(appInfo, installed, hasUpdate)}
      </div>
      ${progress ? renderProgress(progress) : ''}
    </article>
  `;
}

function renderActions(appInfo, installed, hasUpdate) {
  if (!installed) {
    return `
      <button class="btn btn-success" type="button" data-action="install" data-app-id="${escapeAttr(appInfo.id)}">${icons.install}<span>Instalar</span></button>
      <button class="btn btn-neutral" type="button" data-action="versions" data-app-id="${escapeAttr(appInfo.id)}">${icons.versions}<span>Versões</span></button>
      <button class="btn btn-soft" type="button" data-action="installer-options" data-app-id="${escapeAttr(appInfo.id)}" title="Opções do instalador">${icons.gear}</button>
      <button class="btn btn-soft" type="button" data-action="repo" data-app-id="${escapeAttr(appInfo.id)}" title="Abrir repositório">${icons.external}</button>
    `;
  }

  return `
    <button class="btn btn-soft" type="button" data-action="open" data-app-id="${escapeAttr(appInfo.id)}">${icons.play}<span>Abrir</span></button>
    ${hasUpdate ? `<button class="btn btn-primary" type="button" data-action="update" data-app-id="${escapeAttr(appInfo.id)}">${icons.update}<span>Atualizar</span></button>` : `<span class="state-pill installed">${icons.check}<span>Atualizado</span></span>`}
    <button class="btn btn-neutral" type="button" data-action="versions" data-app-id="${escapeAttr(appInfo.id)}">${icons.versions}<span>Versões</span></button>
    <button class="btn btn-soft" type="button" data-action="installer-options" data-app-id="${escapeAttr(appInfo.id)}" title="Opções do instalador">${icons.gear}</button>
    ${installed.installSource === 'system' ? '' : `<button class="btn btn-danger" type="button" data-action="uninstall" data-app-id="${escapeAttr(appInfo.id)}">${icons.trash}<span>Desinstalar</span></button>`}
  `;
}

function renderProgress(progress) {
  const indeterminate = progress.indeterminate || !Number.isFinite(progress.percent);
  const percent = indeterminate ? 42 : Math.max(0, Math.min(100, progress.percent || 0));

  return `
    <div class="progress-block">
      <div class="progress-line ${indeterminate ? 'is-indeterminate' : ''}"><div class="progress-fill" style="width: ${percent}%"></div></div>
      <div class="progress-text">${escapeHtml(progress.message || 'Processando')}</div>
    </div>
  `;
}

async function handleAppAction(event) {
  const button = event.target.closest('button[data-action]');
  if (!button) return;

  const appInfo = state.apps.find((item) => item.id === button.dataset.appId);
  if (!appInfo) return;

  const action = button.dataset.action;

  if (action === 'install') {
    await installVersion(appInfo, appInfo.latest);
  }

  if (action === 'update') {
    await installVersion(appInfo, appInfo.latest);
  }

  if (action === 'versions') {
    state.selectedApp = appInfo;
    renderVersionsDialog(appInfo);
    elements.versionsDialog.showModal();
  }

  if (action === 'uninstall') {
    await uninstallApp(appInfo);
  }

  if (action === 'open') {
    await openApp(appInfo);
  }

  if (action === 'repo') {
    await hub.openExternal(appInfo.repoUrl);
  }

  if (action === 'installer-options') {
    openInstallerDialog(appInfo);
  }
}

async function handleVersionAction(event) {
  const button = event.target.closest('button[data-version-action]');
  if (!button || !state.selectedApp) return;

  const version = state.selectedApp.versions.find((item) => item.versionKey === button.dataset.versionKey);
  if (!version) return;

  if (button.dataset.versionAction === 'install') {
    await installVersion(state.selectedApp, version);
  }

  if (button.dataset.versionAction === 'download') {
    await downloadVersion(state.selectedApp, version);
  }
}

function renderVersionsDialog(appInfo) {
  const installed = state.installed[appInfo.id];
  elements.versionsTitle.textContent = appInfo.name;
  elements.versionsSubtitle.textContent = `${appInfo.versions.length} versões disponíveis`;
  elements.versionsList.innerHTML = appInfo.versions.map((version) => {
    const isInstalled = installed && installed.versionKey === version.versionKey;
    const installButton = isInstalled
      ? `<button class="btn btn-soft" type="button" disabled>${icons.check}<span>Instalada</span></button>`
      : `<button class="btn btn-success" type="button" data-version-action="install" data-version-key="${escapeAttr(version.versionKey)}">${icons.install}<span>Instalar</span></button>`;

    return `
      <div class="version-row">
        <div>
          <p class="version-name">${escapeHtml(version.fileName)}</p>
          <div class="version-detail">
            <span>${escapeHtml(version.versionName || 'latest')}</span>
            <span>${formatSize(version.size)}</span>
            <span>${sourceLabel(version.source)}</span>
            <span>${formatDate(version.createdAt)}</span>
          </div>
        </div>
        <div class="version-actions">
          ${installButton}
          <button class="btn btn-neutral" type="button" data-version-action="download" data-version-key="${escapeAttr(version.versionKey)}">${icons.download}<span>Baixar</span></button>
        </div>
      </div>
    `;
  }).join('');
}

async function installVersion(appInfo, version) {
  if (!state.installerPreferences[appInfo.id]) {
    openInstallerDialog(appInfo, { action: 'install', version });
    return;
  }

  try {
    await hub.installApp(appInfo, version);
    const initial = await hub.getState();
    state.installed = initial.installed || {};
    state.installerPreferences = initial.installerPreferences || state.installerPreferences;
    showToast(`${appInfo.name} instalado.`, 'success');
  } catch (error) {
    showToast(error.message, 'error');
  } finally {
    render();
  }
}

function openInstallerDialog(appInfo, pendingAction = null) {
  const preference = state.installerPreferences[appInfo.id] || { mode: 'managed', args: '', waitForExit: false };
  state.installerApp = appInfo;
  state.pendingInstallerAction = pendingAction;
  elements.installerTitle.textContent = 'Opções do instalador';
  elements.installerSubtitle.textContent = appInfo.name;
  elements.installerForm.elements.installerMode.value = preference.mode || 'managed';
  elements.installerArgsInput.value = preference.args || '';
  elements.waitForExitInput.checked = Boolean(preference.waitForExit);
  elements.saveInstallerOptionsButton.innerHTML = pendingAction
    ? `${icons.save}<span>Salvar e instalar</span>`
    : `${icons.save}<span>Salvar</span>`;
  elements.installerDialog.showModal();
}

async function saveInstallerOptions(event) {
  event.preventDefault();
  if (!state.installerApp) return;

  const appInfo = state.installerApp;
  const pending = state.pendingInstallerAction;
  const preference = {
    mode: elements.installerForm.elements.installerMode.value,
    args: elements.installerArgsInput.value,
    waitForExit: elements.waitForExitInput.checked
  };

  try {
    state.installerPreferences[appInfo.id] = await hub.saveInstallerPreference(appInfo.id, preference);
    elements.installerDialog.close();
    showToast('Opções salvas.', 'success');

    if (pending?.action === 'install') {
      await installVersion(appInfo, pending.version);
    }
  } catch (error) {
    showToast(error.message, 'error');
  }
}

async function uninstallApp(appInfo) {
  const confirmed = confirm(`Desinstalar ${appInfo.name}?`);
  if (!confirmed) return;

  try {
    await hub.uninstallApp(appInfo.id);
    delete state.installed[appInfo.id];
    showToast(`${appInfo.name} removido.`, 'success');
  } catch (error) {
    showToast(error.message, 'error');
  } finally {
    render();
  }
}

async function openApp(appInfo) {
  try {
    await hub.openApp(appInfo.id);
  } catch (error) {
    showToast(error.message, 'error');
  }
}

async function downloadVersion(appInfo, version) {
  try {
    const result = await hub.downloadVersion(appInfo, version);
    if (!result.canceled) {
      showToast(`${version.fileName} baixado.`, 'success');
    }
  } catch (error) {
    showToast(error.message, 'error');
  }
}

function toggleTheme() {
  state.theme = state.theme === 'dark' ? 'light' : 'dark';
  localStorage.setItem('madiaznx-theme', state.theme);
  applyTheme();
  render();
}

function applyTheme() {
  document.documentElement.dataset.theme = state.theme;
}

function bindIconFallbacks() {
  document.querySelectorAll('.app-icon').forEach((img) => {
    img.addEventListener('error', () => {
      if (!img.dataset.failed) {
        img.dataset.failed = 'true';
        img.src = img.dataset.fallback || fallbackLogo;
      }
    }, { once: true });
  });
}

function markMonochromeIcons() {
  document.querySelectorAll('.app-icon:not([data-checked-mono])').forEach((img) => {
    if (!img.complete) {
      img.addEventListener('load', () => markIcon(img), { once: true });
      return;
    }
    markIcon(img);
  });
}

function markIcon(img) {
  img.dataset.checkedMono = 'true';

  try {
    const canvas = document.createElement('canvas');
    const size = 32;
    canvas.width = size;
    canvas.height = size;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    context.drawImage(img, 0, 0, size, size);
    const pixels = context.getImageData(0, 0, size, size).data;
    let samples = 0;
    let saturated = 0;
    let brightness = 0;

    for (let index = 0; index < pixels.length; index += 4) {
      const alpha = pixels[index + 3];
      if (alpha < 48) continue;

      const red = pixels[index];
      const green = pixels[index + 1];
      const blue = pixels[index + 2];
      const max = Math.max(red, green, blue);
      const min = Math.min(red, green, blue);

      samples += 1;
      brightness += (red * 0.299) + (green * 0.587) + (blue * 0.114);
      if (max - min > 20) {
        saturated += 1;
      }
    }

    if (!samples || saturated / samples > 0.07) return;

    const averageBrightness = brightness / samples;
    img.classList.add('is-monochrome');
    img.classList.toggle('is-light-mono', averageBrightness > 176);
    img.classList.toggle('is-dark-mono', averageBrightness <= 176);
  } catch {
    // Cross-origin images without canvas access keep their original colors.
  }
}

function setButtonBusy(button, isBusy) {
  button.disabled = isBusy;
}

function showToast(message, type = 'success') {
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  elements.toastStack.appendChild(toast);
  setTimeout(() => {
    toast.remove();
  }, 4200);
}

function sourceLabel(source) {
  return source === 'release' ? 'Release' : 'Repositório';
}

function formatSize(bytes) {
  const value = Number(bytes || 0);
  if (!value) return 'Tamanho desconhecido';
  const units = ['B', 'KB', 'MB', 'GB'];
  let amount = value;
  let unit = 0;
  while (amount >= 1024 && unit < units.length - 1) {
    amount /= 1024;
    unit += 1;
  }
  return `${amount.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
}

function formatDate(value) {
  if (!value) return 'Data desconhecida';
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric'
  }).format(new Date(value));
}

function formatDateTime(value) {
  if (!value) return '';
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  }).format(new Date(value));
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function escapeAttr(value) {
  return escapeHtml(value).replace(/`/g, '&#096;');
}
