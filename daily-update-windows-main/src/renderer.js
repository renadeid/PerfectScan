// Application State
let settings = {};
let allItems = []; // Combined repos + packages
let currentView = 'dashboard';
let currentFilter = null;
let searchQuery = '';
let logLines = [];
let history = [];

// DOM Elements
const navItems = document.querySelectorAll('.nav-item');
const viewDashboard = document.getElementById('view-dashboard');
const viewItems = document.getElementById('view-items');
const viewHistory = document.getElementById('view-history');
const setupModal = document.getElementById('setup-modal');

const btnAddItem = document.getElementById('btn-add-item');
const btnRefreshApps = document.getElementById('btn-refresh-apps');
const btnCheckUpdates = document.getElementById('btn-check-updates');
const btnUpdateSelected = document.getElementById('btn-update-selected');
const btnSelectAllUpdates = document.getElementById('btn-select-all-updates');
const btnDeselectAll = document.getElementById('btn-deselect-all');
const btnToggleLog = document.getElementById('btn-toggle-log');
const btnClearHistory = document.getElementById('btn-clear-history');

const searchInput = document.getElementById('search-input');
const checkboxSelectAll = document.getElementById('checkbox-select-all');
const itemTableBody = document.getElementById('item-table-body');
const itemsTitle = document.getElementById('items-title');
const itemsSubtitle = document.getElementById('items-subtitle');
const logPanel = document.getElementById('log-panel');
const logContent = document.getElementById('log-content');
const bottomStatus = document.getElementById('bottom-status');

const rootFolderInput = document.getElementById('root-folder');
const maxDepthInput = document.getElementById('max-depth');
const selectFolderBtn = document.getElementById('select-folder-btn');
const finishSetupBtn = document.getElementById('finish-setup-btn');
const addAppFolderBtn = document.getElementById('add-app-folder-btn');
const appFoldersList = document.getElementById('app-folders-list');
const onboardingPreview = document.getElementById('onboarding-preview');
const loadingScreen = document.getElementById('loading-screen');
const loadingMessage = document.getElementById('loading-message');

let applicationFolders = [];

function isLoadingVisible() {
  return loadingScreen && !loadingScreen.classList.contains('hidden');
}

function showLoadingScreen(message = 'Loading…') {
  if (!loadingScreen) return;
  if (loadingMessage) loadingMessage.textContent = message;
  loadingScreen.classList.remove('hidden');
  loadingScreen.setAttribute('aria-busy', 'true');
}

function hideLoadingScreen() {
  if (!loadingScreen) return;
  loadingScreen.classList.add('hidden');
  loadingScreen.setAttribute('aria-busy', 'false');
}

function setLoadingMessage(message) {
  if (loadingMessage) loadingMessage.textContent = message;
}

// Initialize
async function init() {
  showLoadingScreen('Starting up…');

  try {
    settings = await window.api.loadSettings();
    const defaults = await window.api.getDefaultPaths();

    if (!settings.rootFolder) {
      settings.rootFolder = defaults.homeFolder;
    }
    rootFolderInput.value = settings.rootFolder;

    applicationFolders = (settings.applicationFolders && settings.applicationFolders.length)
      ? [...settings.applicationFolders]
      : [...defaults.applicationFolders];

    if (settings.maxDepth) {
      maxDepthInput.value = settings.maxDepth;
    }

    history = settings.history || [];

    setupEventListeners();
    renderApplicationFolders();

    if (!settings.hasCompletedSetup) {
      setLoadingMessage('Scanning apps and repositories…');
      await reloadAllConfigs(false);
      hideLoadingScreen();
      setupModal.classList.remove('hidden');
      updateOnboardingPreview();
    } else {
      allItems = [
        ...(settings.detectors || []).map(d => ({ ...d, type: d.type || 'detector', selected: false })),
        ...(settings.repositories || []).map(r => ({ ...r, type: 'repo', selected: false }))
      ];
      renderCurrentView();
      updateBadges();
      hideLoadingScreen();

      // Let the window become interactive immediately, then refresh in the background.
      setTimeout(() => refreshOnLaunch(), 0);
    }

    updateBadges();
  } catch (err) {
    hideLoadingScreen();
    addLog(`Startup error: ${err.message}`);
  }
}

async function reloadAllConfigs(persist = true, showLoader = true) {
  const wasLoading = isLoadingVisible();
  if (showLoader) {
    if (!wasLoading) showLoadingScreen('Scanning apps and repositories…');
    else setLoadingMessage('Scanning apps and repositories…');
  }

  try {
    const rootFolder = settings.rootFolder || rootFolderInput.value || '';
    const maxDepth = parseInt(maxDepthInput.value, 10) || settings.maxDepth || 4;
    const folders = applicationFolders.length ? applicationFolders : settings.applicationFolders || [];

    addLog('Loading catalog...');
    const { detectors, repos } = await window.api.reloadConfigs(rootFolder, maxDepth, folders);

    allItems = [
      ...detectors.map(d => ({ ...d, type: d.type || 'detector', selected: false })),
      ...repos.map(r => ({ ...r, type: 'repo', selected: false }))
    ];

    if (persist) {
      settings.rootFolder = rootFolder;
      settings.applicationFolders = folders;
      settings.detectors = detectors;
      settings.repositories = repos;
      settings.lastScan = new Date().toISOString();
      await window.api.saveSettings(settings);
    }

    updateBadges();
    if (!setupModal.classList.contains('hidden')) {
      updateOnboardingPreview();
    } else {
      renderCurrentView();
    }
    addLog(`Loaded ${allItems.length} items (${detectors.length} catalog, ${repos.length} repos)`);
  } finally {
    if (showLoader && !wasLoading) hideLoadingScreen();
  }
}

function renderApplicationFolders() {
  appFoldersList.innerHTML = applicationFolders.map((folder, index) => `
    <li>
      <span class="folder-path" title="${escapeHtml(folder)}">${escapeHtml(folder)}</span>
      ${applicationFolders.length > 1 ? `<button type="button" data-index="${index}">Remove</button>` : ''}
    </li>
  `).join('');

  appFoldersList.querySelectorAll('button[data-index]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const index = parseInt(btn.dataset.index, 10);
      applicationFolders.splice(index, 1);
      renderApplicationFolders();
      await reloadAllConfigs(false);
    });
  });
}

async function updateOnboardingPreview() {
  const apps = allItems.filter(i => i.category === 'app');
  const installedApps = apps.filter(i => i.installed !== false && i.status !== 'not-installed');
  const repos = allItems.filter(i => i.category === 'repo');

  onboardingPreview.textContent =
    `Found ${installedApps.length} apps and ${repos.length} repositories in the selected folders.`;
}

async function completeSetup() {
  showLoadingScreen('Saving configuration…');
  settings.rootFolder = rootFolderInput.value;
  settings.applicationFolders = [...applicationFolders];
  settings.maxDepth = parseInt(maxDepthInput.value, 10) || 4;
  settings.hasCompletedSetup = true;

  finishSetupBtn.disabled = true;
  try {
    setLoadingMessage('Scanning apps and repositories…');
    await reloadAllConfigs();
    setupModal.classList.add('hidden');
    renderCurrentView();
    await handleCheckUpdates();
  } finally {
    hideLoadingScreen();
    finishSetupBtn.disabled = false;
  }
}

// Event Listeners
function setupEventListeners() {
  // Navigation
  navItems.forEach(nav => {
    nav.addEventListener('click', () => {
      const view = nav.dataset.view;
      const filter = nav.dataset.filter;
      handleNavigation(view, filter);
    });
  });

  // Toolbar
  btnAddItem.addEventListener('click', () => {
    setupModal.classList.remove('hidden');
  });

  btnCheckUpdates.addEventListener('click', () => handleCheckUpdates());
  btnRefreshApps.addEventListener('click', handleRefreshApps);
  btnUpdateSelected.addEventListener('click', handleUpdateSelected);

  // List controls
  searchInput.addEventListener('input', (e) => {
    searchQuery = e.target.value.toLowerCase();
    renderItemList();
  });

  btnSelectAllUpdates.addEventListener('click', () => {
    getFilteredItems().forEach(item => {
      if (
        item.status === 'update-available' ||
        (currentView === 'discover-apps' && item.status === 'not-installed' && item.wingetId)
      ) {
        item.selected = true;
      }
    });
    renderItemList();
    updateSelectedButton();
  });

  btnDeselectAll.addEventListener('click', () => {
    allItems.forEach(item => item.selected = false);
    renderItemList();
    updateSelectedButton();
  });

  btnToggleLog.addEventListener('click', () => {
    logPanel.classList.toggle('hidden');
    btnToggleLog.querySelector('.btn-label').textContent =
      logPanel.classList.contains('hidden') ? 'Show Log' : 'Hide Log';
  });

  checkboxSelectAll.addEventListener('change', (e) => {
    const filtered = getFilteredItems();
    filtered.filter(isItemSelectable).forEach(item => item.selected = e.target.checked);
    renderItemList();
    updateSelectedButton();
  });

  // History
  btnClearHistory.addEventListener('click', async () => {
    history = [];
    settings.history = history;
    await window.api.saveSettings(settings);
    renderHistory();
    updateBadges();
  });

  // Setup modal
  selectFolderBtn.addEventListener('click', async () => {
    const folder = await window.api.selectFolder();
    if (folder) {
      rootFolderInput.value = folder;
      settings.rootFolder = folder;
      await reloadAllConfigs(false);
    }
  });

  addAppFolderBtn.addEventListener('click', async () => {
    const folder = await window.api.selectFolder();
    if (folder && !applicationFolders.includes(folder)) {
      applicationFolders.push(folder);
      renderApplicationFolders();
      await reloadAllConfigs(false);
    }
  });

  finishSetupBtn.addEventListener('click', completeSetup);

  rootFolderInput.addEventListener('change', () => updateOnboardingPreview());

  // Keyboard shortcuts
  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.key === 'r') {
      e.preventDefault();
      handleCheckUpdates();
    }
    if (e.ctrlKey && e.key === 'u') {
      e.preventDefault();
      handleUpdateSelected();
    }
  });
}

// Navigation
function handleNavigation(view, filter = null) {
  currentView = view;
  currentFilter = filter;

  // Update nav active state
  navItems.forEach(nav => nav.classList.remove('active'));
  const activeNav = Array.from(navItems).find(nav =>
    nav.dataset.view === view && (nav.dataset.filter || null) === filter
  );
  if (activeNav) activeNav.classList.add('active');

  btnSelectAllUpdates.textContent = view === 'discover-apps'
    ? 'Select All Apps'
    : 'Select All Updates';
  btnUpdateSelected.querySelector('.btn-label').textContent = view === 'discover-apps'
    ? 'Install Selected'
    : 'Update Selected';

  renderCurrentView();
}

function renderCurrentView() {
  // Hide all views
  viewDashboard.classList.add('hidden');
  viewItems.classList.add('hidden');
  viewHistory.classList.add('hidden');

  // Show current view
  switch (currentView) {
    case 'dashboard':
      viewDashboard.classList.remove('hidden');
      renderDashboard();
      break;
    case 'all-items':
      viewItems.classList.remove('hidden');
      itemsTitle.textContent = 'All Items';
      itemsSubtitle.textContent = 'Manage and update your installed software';
      renderItemList();
      break;
    case 'category':
      viewItems.classList.remove('hidden');
      const categoryLabels = {
        app: 'Apps',
        cli: 'CLIs',
        repo: 'Repos',
        runtime: 'Runtime/Library'
      };
      itemsTitle.textContent = categoryLabels[currentFilter] || 'Items';
      itemsSubtitle.textContent = 'Manage and update your installed software';
      renderItemList();
      break;
    case 'updates-available':
      viewItems.classList.remove('hidden');
      itemsTitle.textContent = 'Updates Available';
      itemsSubtitle.textContent = 'Updates ready for your installed software';
      renderItemList();
      break;
    case 'discover-apps':
      viewItems.classList.remove('hidden');
      itemsTitle.textContent = 'Discover Apps';
      itemsSubtitle.textContent = 'Apps from the catalog that are not installed on this device';
      renderItemList();
      break;
    case 'history':
      viewHistory.classList.remove('hidden');
      renderHistory();
      break;
  }
}

// Dashboard
function renderDashboard() {
  const installedItems = allItems.filter(i => i.status !== 'not-installed' && i.installed !== false);
  const totalItems = installedItems.length;
  const installedCount = installedItems.length;
  const updatesCount = allItems.filter(i => i.status === 'update-available').length;
  const reposCount = installedItems.filter(i => i.category === 'repo').length;

  document.getElementById('stat-total').textContent = totalItems;
  document.getElementById('stat-installed').textContent = installedCount;
  document.getElementById('stat-updates').textContent = updatesCount;
  document.getElementById('stat-repos').textContent = reposCount;

  // Category breakdown
  const categories = {
    app: { label: 'Apps', dot: 'app' },
    cli: { label: 'CLIs', dot: 'cli' },
    repo: { label: 'Repos', dot: 'repo' },
    runtime: { label: 'Runtime/Library', dot: 'runtime' }
  };

  const categoryBreakdown = document.getElementById('category-breakdown');
  categoryBreakdown.innerHTML = '';

  Object.entries(categories).forEach(([key, { label, dot }]) => {
    const count = key === 'runtime'
      ? installedItems.filter(i => i.category === 'runtime' || i.category === 'library').length
      : installedItems.filter(i => i.category === key).length;
    const row = document.createElement('div');
    row.className = 'category-row';
    row.innerHTML = `
      <div class="category-row-label">
        <span class="category-dot ${dot}"></span>
        <span>${label}</span>
      </div>
      <div class="category-row-count">${count}</div>
    `;
    categoryBreakdown.appendChild(row);
  });
}

// Item List
function getFilteredItems() {
  let filtered = allItems;

  // Apply view filter
  if (currentView === 'discover-apps') {
    filtered = filtered.filter(item => item.status === 'not-installed' || item.installed === false);
  } else {
    // Keep catalog suggestions out of the normal update-management views.
    filtered = filtered.filter(item => item.status !== 'not-installed' && item.installed !== false);
  }

  if (currentView === 'category' && currentFilter) {
    if (currentFilter === 'runtime') {
      filtered = filtered.filter(item => item.category === 'runtime' || item.category === 'library');
    } else {
      filtered = filtered.filter(item => item.category === currentFilter);
    }
  } else if (currentView === 'updates-available') {
    filtered = filtered.filter(item => item.status === 'update-available');
  }

  // Apply search
  if (searchQuery) {
    filtered = filtered.filter(item =>
      item.name.toLowerCase().includes(searchQuery) ||
      (item.path && item.path.toLowerCase().includes(searchQuery)) ||
      (item.id && item.id.toLowerCase().includes(searchQuery))
    );
  }

  return filtered;
}

function renderItemList() {
  const filtered = getFilteredItems();

  if (filtered.length === 0) {
    itemTableBody.innerHTML = `
      <tr>
        <td colspan="5" class="empty-state">
          <div class="empty-icon">
            <svg viewBox="0 0 48 48" fill="none"><rect x="8" y="12" width="32" height="28" rx="4" stroke="currentColor" stroke-width="2"/><path d="M16 20h16M16 28h10" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
          </div>
          <div class="empty-title">No Items</div>
          <div class="empty-subtitle">No items match the current filter.</div>
        </td>
      </tr>
    `;
    updateSelectedButton();
    return;
  }

  itemTableBody.innerHTML = filtered.map((item) => `
    <tr>
      <td class="col-checkbox">
        ${isItemSelectable(item) ? `
          <input type="checkbox"
            data-index="${allItems.indexOf(item)}"
            ${item.selected ? 'checked' : ''}>
        ` : ''}
      </td>
      <td class="col-name">
        <div class="item-name">${escapeHtml(item.name)}</div>
        <div class="item-description">${escapeHtml(item.description || item.path || item.id || '')}</div>
        ${item.source === 'discovered' ? '<div class="item-meta"><span class="source-pill discovered">Discovered</span></div>' : ''}
      </td>
      <td class="col-category">
        <div class="item-category-label">
          <span class="category-dot ${getCategoryDot(item.category)}"></span>
          <span>${getCategoryLabel(item.category)}</span>
        </div>
      </td>
      <td class="col-version">${escapeHtml(getVersionDisplay(item))}</td>
      <td class="col-status">${renderStatusBadge(item)}</td>
    </tr>
  `).join('');

  // Add checkbox listeners
  itemTableBody.querySelectorAll('input[type="checkbox"]').forEach(checkbox => {
    checkbox.addEventListener('change', (e) => {
      const index = parseInt(e.target.dataset.index);
      allItems[index].selected = e.target.checked;
      updateSelectedButton();
    });
  });

  updateSelectedButton();
}

function isItemSelectable(item) {
  if (item.status === 'update-available') return true;
  return (item.status === 'not-installed' || item.installed === false) && Boolean(item.wingetId);
}

function renderStatusBadge(item) {
  const statusMap = {
    'unchecked': { label: 'Checking…', class: 'status-checking' },
    'checking': { label: 'Checking…', class: 'status-checking' },
    'up-to-date': { label: 'Up to date', class: 'status-up-to-date' },
    'update-available': { label: 'Update available', class: 'status-update-available' },
    'not-installed': { label: 'Not installed', class: 'status-not-installed' },
    'updating': { label: 'Updating…', class: 'status-updating' },
    'error': { label: 'Error', class: 'status-error' }
  };

  const status = statusMap[item.status] || statusMap['unchecked'];
  return `
    <div class="status-badge ${status.class}">
      <span class="status-dot"></span>
      <span>${status.label}</span>
    </div>
  `;
}

function getVersionDisplay(item) {
  if (item.latestVersion && item.version && item.version !== item.latestVersion) {
    return `${item.version} → ${item.latestVersion}`;
  }
  if (item.latestVersion && !item.version) {
    return `— → ${item.latestVersion}`;
  }
  return item.version || '—';
}

function getCategoryDot(category) {
  const dots = { app: 'app', cli: 'cli', repo: 'repo', runtime: 'runtime', library: 'runtime' };
  return dots[category] || 'app';
}

function getCategoryLabel(category) {
  const labels = {
    app: 'App',
    cli: 'CLI',
    repo: 'Repo',
    runtime: 'Runtime'
  };
  return labels[category] || category;
}

// History
function renderHistory() {
  const historyContent = document.getElementById('history-content');

  if (history.length === 0) {
    historyContent.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">
          <svg viewBox="0 0 48 48" fill="none"><circle cx="24" cy="24" r="16" stroke="currentColor" stroke-width="2"/><path d="M24 14v10l6 4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
        </div>
        <div class="empty-title">No updates yet</div>
      </div>
    `;
    return;
  }

  historyContent.innerHTML = history.map(entry => `
    <div class="history-item">
      <div class="history-time">${new Date(entry.date).toLocaleString()}</div>
      <div class="history-name">${escapeHtml(entry.itemName)}</div>
      <div class="history-version">${entry.fromVersion || '—'} → ${entry.toVersion || '—'}</div>
      <div class="history-result ${entry.success ? 'success' : 'failed'}">
        ${entry.success ? 'Success' : 'Failed'}
      </div>
    </div>
  `).join('');
}

// Badges
function updateBadges() {
  const installedItems = allItems.filter(i => i.status !== 'not-installed' && i.installed !== false);
  const totalCount = installedItems.length;
  const updatesCount = allItems.filter(i => i.status === 'update-available').length;
  const discoverCount = allItems.filter(i => i.status === 'not-installed' || i.installed === false).length;
  const appsCount = installedItems.filter(i => i.category === 'app').length;
  const clisCount = installedItems.filter(i => i.category === 'cli').length;
  const reposCount = installedItems.filter(i => i.category === 'repo').length;
  const runtimesCount = installedItems.filter(i => i.category === 'runtime' || i.category === 'library').length;

  document.getElementById('badge-total').textContent = totalCount;
  document.getElementById('badge-updates').textContent = updatesCount;
  document.getElementById('badge-available').textContent = updatesCount;
  document.getElementById('badge-discover').textContent = discoverCount;
  document.getElementById('badge-apps').textContent = appsCount;
  document.getElementById('badge-clis').textContent = clisCount;
  document.getElementById('badge-repos').textContent = reposCount;
  document.getElementById('badge-runtimes').textContent = runtimesCount;
  document.getElementById('badge-history').textContent = history.length;

  // Update last check
  if (settings.lastCheckDate) {
    const lastCheck = document.getElementById('last-check');
    lastCheck.textContent = `Last: ${new Date(settings.lastCheckDate).toLocaleTimeString()}`;
  }
}

function updateBottomBar() {
  const updatesCount = allItems.filter(i => i.status === 'update-available').length;
  const missingCount = allItems.filter(i => i.status === 'not-installed').length;
  const selectedCount = getFilteredItems().filter(i => i.selected).length;
  bottomStatus.textContent = currentView === 'discover-apps'
    ? `${missingCount} apps to discover · ${selectedCount} selected`
    : `${updatesCount} updates · ${selectedCount} selected`;
}

function updateSelectedButton() {
  const selectedCount = getFilteredItems().filter(i => i.selected).length;
  btnUpdateSelected.disabled = selectedCount === 0;
  updateBottomBar();
}

// Actions
async function refreshOnLaunch() {
  btnRefreshApps.disabled = true;
  btnCheckUpdates.disabled = true;
  addLog('Refreshing installed apps in the background...');

  try {
    await reloadAllConfigs(true, false);
    if (settings.autoCheckOnLaunch !== false) {
      await handleCheckUpdates({ background: true });
    }
    addLog('Background refresh complete');
  } catch (err) {
    addLog(`Background refresh error: ${err.message}`);
  } finally {
    btnRefreshApps.disabled = false;
    btnCheckUpdates.disabled = false;
    updateBadges();
    renderCurrentView();
  }
}

async function handleRefreshApps() {
  if (isLoadingVisible()) return;

  showLoadingScreen('Refreshing installed apps…');
  btnRefreshApps.disabled = true;
  btnCheckUpdates.disabled = true;
  addLog('Refreshing installed apps...');

  try {
    await reloadAllConfigs(true);
    await handleCheckUpdates();
    addLog('Installed apps refreshed');
  } catch (err) {
    addLog(`Refresh error: ${err.message}`);
  } finally {
    btnRefreshApps.disabled = false;
    btnCheckUpdates.disabled = false;
    hideLoadingScreen();
    updateBadges();
    renderCurrentView();
  }
}

async function handleCheckUpdates({ background = false } = {}) {
  if (allItems.length === 0) {
    addLog('No items to check');
    return;
  }

  const wasLoading = isLoadingVisible();
  if (!background && !wasLoading) showLoadingScreen('Checking for updates…');

  const checkableItems = allItems.filter(
    item => item.status !== 'not-installed' && item.installed !== false
  );

  checkableItems.forEach(item => {
    item.status = 'checking';
  });
  renderItemList();

  btnCheckUpdates.disabled = true;
  addLog('Checking for updates...');

  try {
    for (let i = 0; i < checkableItems.length; i++) {
      const item = checkableItems[i];
      if (!background) {
        setLoadingMessage(`Checking ${item.name} (${i + 1}/${checkableItems.length})…`);
      }

      try {
        if (item.type === 'repo') {
          const version = await window.api.getRepoVersion(item.path);
          item.version = version;

          const updateInfo = await window.api.checkRepoUpdates(item.path);
          item.status = updateInfo.status;
          item.message = updateInfo.message;
        } else if (item.type === 'detector' && item.wingetId) {
          const updateInfo = await window.api.checkWingetUpdate(item.wingetId);
          if (updateInfo.installed === false) {
            if (item.locallyDetected || item.path) {
              item.installed = true;
              item.status = 'up-to-date';
              item.latestVersion = null;
              item.message = 'Installed locally (not managed by winget)';
            } else {
              item.installed = false;
              item.status = 'not-installed';
              item.latestVersion = null;
              item.message = 'This app is not installed on this device';
            }
          } else {
            item.status = updateInfo.hasUpdate ? 'update-available' : 'up-to-date';
            item.latestVersion = updateInfo.latestVersion;
          }
        } else if (item.type === 'detector') {
          item.status = 'up-to-date';
          item.message = 'Installed locally (manual updates)';
        } else if (item.type === 'package') {
          const updateInfo = await window.api.checkWingetUpdate(item.id);
          if (updateInfo.installed === false) {
            item.installed = false;
            item.status = 'not-installed';
            item.latestVersion = null;
            item.message = 'This app is not installed on this device';
          } else {
            item.status = updateInfo.hasUpdate ? 'update-available' : 'up-to-date';
            item.latestVersion = updateInfo.latestVersion;
          }
        }
      } catch (err) {
        item.status = 'error';
        item.message = err.message;
        addLog(`Error checking ${item.name}: ${err.message}`);
      }

      renderItemList();
    }

    settings.lastCheckDate = new Date().toISOString();
    settings.detectors = allItems.filter(item => item.type !== 'repo');
    settings.repositories = allItems.filter(item => item.type === 'repo');
    await window.api.saveSettings(settings);

    addLog('Check complete');
    updateBadges();
    renderCurrentView();
  } finally {
    btnCheckUpdates.disabled = false;
    if (!background && !wasLoading) hideLoadingScreen();
  }
}

async function handleUpdateSelected() {
  const selected = getFilteredItems().filter(i => i.selected);

  if (selected.length === 0) {
    addLog('No items selected');
    return;
  }

  const actionLabel = currentView === 'discover-apps' ? 'Install' : 'Update';
  const confirmed = await window.api.showConfirmDialog(
    `${actionLabel} ${selected.length} selected item${selected.length > 1 ? 's' : ''}?`
  );

  if (!confirmed) return;

  btnUpdateSelected.disabled = true;
  addLog(`Updating ${selected.length} item(s)...`);

  for (const item of selected) {
    const index = allItems.indexOf(item);
    const wasNotInstalled = item.status === 'not-installed' || item.installed === false;
    allItems[index].status = 'updating';
    renderItemList();

    try {
      let result;
      if (item.type === 'repo') {
        result = await window.api.updateRepo(item.path);
      } else if (wasNotInstalled && item.wingetId) {
        result = await window.api.installWingetPackage(item.wingetId, item.wingetSource || null);
        if (result.success) {
          item.installed = true;
          item.status = 'up-to-date';
        }
      } else if (item.type === 'package') {
        result = await window.api.updateWingetPackage(item.id);
      } else if (item.type === 'detector' && item.wingetId) {
        result = await window.api.updateWingetPackage(item.wingetId, item.wingetSource || null);
      } else {
        result = { success: false, message: 'No automatic update path for this item' };
      }

      allItems[index].status = result.success ? 'up-to-date' : 'error';
      allItems[index].message = result.message;
      allItems[index].selected = false;

      // Add to history
      history.unshift({
        date: new Date().toISOString(),
        itemName: item.name,
        fromVersion: item.version,
        toVersion: result.newVersion || item.latestVersion,
        success: result.success
      });

      addLog(`${item.name}: ${result.success ? 'Success' : 'Failed'}`);
    } catch (err) {
      allItems[index].status = 'error';
      allItems[index].message = err.message;
      addLog(`Error updating ${item.name}: ${err.message}`);
    }

    renderItemList();
  }

  settings.history = history;
  await window.api.saveSettings(settings);

  btnUpdateSelected.disabled = false;
  addLog('Update complete');
  updateBadges();
  renderCurrentView();
}

// Log
function addLog(message) {
  const timestamp = new Date().toLocaleTimeString();
  const line = `[${timestamp}] ${message}`;
  logLines.push(line);
  if (logLines.length > 100) logLines.shift();
  logContent.textContent = logLines.join('\n');
  logContent.scrollTop = logContent.scrollHeight;
}

// Utilities
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Start
init();
