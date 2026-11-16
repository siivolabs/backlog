'use strict';

const state = {
  config: null,
  games: [],
  stats: { total: 0, neverPlayed: 0, played: 0, totalHours: 0 },
  filtered: [],
  page: 1,
  pageSize: 48,
  statusPoll: null,
  libraryRefreshTick: 0,
  adminToken: ''
};

const elements = Object.fromEntries([
  'serviceState', 'apiBadge', 'profileInput', 'adminToken', 'syncButton', 'syncSummary',
  'totalGames', 'neverPlayed', 'totalHours', 'playedGames', 'startButton', 'pauseButton',
  'retryButton', 'progressMessage', 'progressPercent', 'progressBar', 'countPending',
  'countSyncing', 'countSynced', 'countErrors', 'countUnavailable', 'searchInput',
  'playFilter', 'statusFilter', 'genreFilter', 'sortSelect', 'viewSelect', 'gameGrid',
  'emptyState', 'emptyTitle', 'emptyText', 'pagination', 'previousPage', 'nextPage',
  'pageInfo', 'openResetButton', 'resetDialog', 'resetScope', 'resetConfirmation',
  'confirmResetButton', 'toast'
].map((id) => [id, document.getElementById(id)]));

const statusLabels = {
  pending: '⏳ En attente',
  syncing: '↻ En cours',
  synced: '✓ Synchronisé',
  temporary_error: '⚠ Erreur temporaire',
  unavailable: '× Indisponible'
};

const numberFormatter = new Intl.NumberFormat('fr-FR');

async function request(url, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (options.body) headers['content-type'] = 'application/json';
  if (options.admin) {
    state.adminToken = elements.adminToken.value;
    headers['x-admin-token'] = state.adminToken;
  }
  const response = await fetch(url, { ...options, headers });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload.error || `Erreur HTTP ${response.status}`);
    error.status = response.status;
    error.code = payload.code;
    throw error;
  }
  return payload;
}

function setBusy(button, busy, busyText = 'Traitement…') {
  if (!button) return;
  if (busy) {
    button.dataset.label = button.textContent;
    button.textContent = busyText;
    button.disabled = true;
  } else {
    button.textContent = button.dataset.label || button.textContent;
    button.disabled = false;
  }
}

let toastTimer;
function showToast(message, type = 'success') {
  clearTimeout(toastTimer);
  elements.toast.textContent = message;
  elements.toast.className = `toast ${type}`;
  elements.toast.hidden = false;
  toastTimer = setTimeout(() => { elements.toast.hidden = true; }, 5000);
}

function formatDate(value) {
  if (!value) return 'jamais';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'inconnue';
  return new Intl.DateTimeFormat('fr-FR', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

function formatPlaytime(minutes) {
  if (!minutes) return 'Jamais lancé';
  if (minutes < 60) return `${minutes} min`;
  return `${(minutes / 60).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} h`;
}

async function loadConfig() {
  const config = await request('/api/config');
  state.config = config;
  elements.serviceState.textContent = `Backlog v${config.version}`;
  elements.serviceState.className = 'service-state online';
  elements.apiBadge.textContent = config.steamApiConfigured ? 'Clé API configurée' : 'Clé API absente';
  elements.apiBadge.className = `pill ${config.steamApiConfigured ? 'pill-success' : 'pill-danger'}`;
  if (config.activeSteamId && !elements.profileInput.value) elements.profileInput.value = config.activeSteamId;
  elements.syncSummary.textContent = config.activeProfileName
    ? `${config.activeProfileName} — ${numberFormatter.format(config.lastLibrarySyncCount)} jeu(x), synchronisation ${formatDate(config.lastLibrarySyncAt)}.`
    : 'Aucun profil Steam synchronisé.';
  if (!config.adminConfigured) {
    elements.syncSummary.textContent += ' Administration désactivée : configure ADMIN_TOKEN.';
  }
}

async function loadLibrary({ preservePage = true } = {}) {
  const payload = await request('/api/library');
  state.games = payload.games || [];
  state.stats = payload.stats || state.stats;
  if (!preservePage) state.page = 1;
  renderStats();
  rebuildGenreOptions();
  applyFilters();
}

function renderStats() {
  elements.totalGames.textContent = numberFormatter.format(state.stats.total || 0);
  elements.neverPlayed.textContent = numberFormatter.format(state.stats.neverPlayed || 0);
  elements.playedGames.textContent = numberFormatter.format(state.stats.played || 0);
  elements.totalHours.textContent = Number(state.stats.totalHours || 0).toLocaleString('fr-FR', { maximumFractionDigits: 1 });
}

function rebuildGenreOptions() {
  const current = elements.genreFilter.value;
  const genres = [...new Set(state.games.flatMap((game) => game.genres || []))]
    .sort((a, b) => a.localeCompare(b, 'fr'));
  elements.genreFilter.replaceChildren(new Option('Tous les genres', 'all'));
  for (const genre of genres) elements.genreFilter.add(new Option(genre, genre));
  elements.genreFilter.value = genres.includes(current) ? current : 'all';
}

function applyFilters() {
  const query = elements.searchInput.value.trim().toLocaleLowerCase('fr');
  const play = elements.playFilter.value;
  const status = elements.statusFilter.value;
  const genre = elements.genreFilter.value;
  const sort = elements.sortSelect.value;

  state.filtered = state.games.filter((game) => {
    if (query && !game.name.toLocaleLowerCase('fr').includes(query)) return false;
    if (play === 'unplayed' && game.playtime_forever !== 0) return false;
    if (play === 'played' && game.playtime_forever === 0) return false;
    if (status !== 'all' && game.metadata_status !== status) return false;
    if (genre !== 'all' && !(game.genres || []).includes(genre)) return false;
    return true;
  });

  const collator = new Intl.Collator('fr', { numeric: true, sensitivity: 'base' });
  state.filtered.sort((a, b) => {
    if (sort === 'name-desc') return collator.compare(b.name, a.name);
    if (sort === 'time-desc') return b.playtime_forever - a.playtime_forever || collator.compare(a.name, b.name);
    if (sort === 'time-asc') return a.playtime_forever - b.playtime_forever || collator.compare(a.name, b.name);
    if (sort === 'recent-desc') return b.rtime_last_played - a.rtime_last_played || collator.compare(a.name, b.name);
    return collator.compare(a.name, b.name);
  });

  const totalPages = Math.max(1, Math.ceil(state.filtered.length / state.pageSize));
  if (state.page > totalPages) state.page = totalPages;
  renderGames();
}

function renderGames() {
  const libraryEmpty = state.games.length === 0;
  const noResults = !libraryEmpty && state.filtered.length === 0;
  elements.emptyState.hidden = !(libraryEmpty || noResults);
  if (libraryEmpty) {
    elements.emptyTitle.textContent = 'La bibliothèque est vide';
    elements.emptyText.textContent = 'Synchronise un profil Steam public pour afficher ses jeux.';
  } else if (noResults) {
    elements.emptyTitle.textContent = 'Aucun jeu ne correspond à tes critères';
    elements.emptyText.textContent = 'Modifie la recherche ou les filtres pour retrouver des jeux.';
  }

  const start = (state.page - 1) * state.pageSize;
  const games = state.filtered.slice(start, start + state.pageSize);
  const fragment = document.createDocumentFragment();
  for (const game of games) fragment.appendChild(createGameCard(game));
  elements.gameGrid.replaceChildren(fragment);
  elements.gameGrid.classList.toggle('list-view', elements.viewSelect.value === 'list');

  const totalPages = Math.ceil(state.filtered.length / state.pageSize);
  elements.pagination.hidden = totalPages <= 1;
  elements.pageInfo.textContent = `Page ${state.page} sur ${Math.max(totalPages, 1)} · ${numberFormatter.format(state.filtered.length)} résultat(s)`;
  elements.previousPage.disabled = state.page <= 1;
  elements.nextPage.disabled = state.page >= totalPages;
}

function createGameCard(game) {
  const article = document.createElement('article');
  article.className = 'game-card';

  const cover = document.createElement('div');
  cover.className = 'cover';
  const image = document.createElement('img');
  image.src = game.header_image;
  image.alt = '';
  image.loading = 'lazy';
  image.addEventListener('error', () => image.classList.add('failed'), { once: true });
  const badge = document.createElement('span');
  badge.className = 'status-badge';
  badge.dataset.status = game.metadata_status;
  badge.textContent = statusLabels[game.metadata_status] || statusLabels.pending;
  if (game.metadata_error) badge.title = game.metadata_error;
  cover.append(image, badge);

  const body = document.createElement('div');
  body.className = 'card-body';
  const title = document.createElement('h3');
  title.textContent = game.name;
  const meta = document.createElement('div');
  meta.className = 'card-meta';
  const playtime = document.createElement('span');
  playtime.textContent = formatPlaytime(game.playtime_forever);
  const appid = document.createElement('span');
  appid.textContent = `AppID ${game.appid}`;
  meta.append(playtime, appid);
  const genres = document.createElement('div');
  genres.className = 'genre-list';
  for (const genre of (game.genres || []).slice(0, 3)) {
    const chip = document.createElement('span');
    chip.className = 'genre';
    chip.textContent = genre;
    genres.appendChild(chip);
  }
  body.append(title, meta, genres);
  article.append(cover, body);
  return article;
}

function renderEnrichment(status) {
  const counts = status.counts || {};
  const percent = Number(status.percent || 0);
  elements.progressMessage.textContent = status.currentAppid
    ? `Enrichissement de l’AppID ${status.currentAppid}…`
    : status.lastMessage || 'En attente d’un lancement manuel.';
  elements.progressPercent.textContent = `${percent.toLocaleString('fr-FR')} %`;
  elements.progressBar.style.width = `${Math.min(100, Math.max(0, percent))}%`;
  elements.progressBar.parentElement.setAttribute('aria-valuenow', String(percent));
  elements.countPending.textContent = numberFormatter.format(counts.pending || 0);
  elements.countSyncing.textContent = numberFormatter.format(counts.syncing || 0);
  elements.countSynced.textContent = numberFormatter.format(counts.synced || 0);
  elements.countErrors.textContent = numberFormatter.format(counts.temporary_error || 0);
  elements.countUnavailable.textContent = numberFormatter.format(counts.unavailable || 0);
  elements.startButton.disabled = Boolean(status.running) || status.total === 0;
  elements.pauseButton.disabled = !status.running;
  elements.retryButton.disabled = Boolean(status.running) || ((counts.temporary_error || 0) + (counts.unavailable || 0) === 0);
}

async function pollStatus() {
  try {
    const status = await request('/api/enrichment/status');
    renderEnrichment(status);
    if (status.running) {
      state.libraryRefreshTick += 1;
      if (state.libraryRefreshTick % 5 === 0) await loadLibrary();
    } else if (state.libraryRefreshTick) {
      state.libraryRefreshTick = 0;
      await loadLibrary();
    }
  } catch (error) {
    elements.serviceState.textContent = 'Serveur indisponible';
    elements.serviceState.className = 'service-state offline';
  }
}

async function synchronizeProfile() {
  const profile = elements.profileInput.value.trim();
  if (!profile) return showToast('Saisis un profil Steam.', 'error');
  setBusy(elements.syncButton, true, 'Synchronisation…');
  try {
    const result = await request('/api/import/steam', {
      method: 'POST', admin: true, body: JSON.stringify({ profile })
    });
    showToast(`${result.gameCount.toLocaleString('fr-FR')} jeu(x) synchronisé(s) pour ${result.profileName}.`);
    await Promise.all([loadConfig(), loadLibrary({ preservePage: false }), pollStatus()]);
  } catch (error) {
    showToast(error.message, 'error');
  } finally {
    setBusy(elements.syncButton, false);
  }
}

async function startEnrichment() {
  setBusy(elements.startButton, true, 'Lancement…');
  try {
    const payload = await request('/api/enrichment/start', { method: 'POST', admin: true });
    renderEnrichment(payload.status);
    showToast(payload.message);
  } catch (error) {
    showToast(error.message, 'error');
  } finally {
    setBusy(elements.startButton, false);
  }
}

async function pauseEnrichment() {
  setBusy(elements.pauseButton, true, 'Suspension…');
  try {
    const payload = await request('/api/enrichment/pause', { method: 'POST', admin: true });
    renderEnrichment(payload.status);
    showToast(payload.message);
  } catch (error) {
    showToast(error.message, 'error');
  } finally {
    setBusy(elements.pauseButton, false);
  }
}

async function retryErrors() {
  setBusy(elements.retryButton, true, 'Préparation…');
  try {
    const payload = await request('/api/enrichment/retry-errors', { method: 'POST', admin: true });
    showToast(`${payload.reset.toLocaleString('fr-FR')} jeu(x) replacé(s) en attente.`);
    await Promise.all([loadLibrary(), pollStatus()]);
  } catch (error) {
    showToast(error.message, 'error');
  } finally {
    setBusy(elements.retryButton, false);
  }
}

async function resetData() {
  const confirmation = elements.resetConfirmation.value;
  if (confirmation !== 'REINITIALISER') return showToast('Saisis exactement REINITIALISER.', 'error');
  setBusy(elements.confirmResetButton, true, 'Réinitialisation…');
  try {
    const payload = await request('/api/admin/reset', {
      method: 'POST', admin: true,
      body: JSON.stringify({ scope: elements.resetScope.value, confirmation })
    });
    elements.resetDialog.close();
    elements.resetConfirmation.value = '';
    showToast(`Réinitialisation terminée. Sauvegarde : ${payload.backup || 'non applicable'}.`);
    await Promise.all([loadConfig(), loadLibrary({ preservePage: false }), pollStatus()]);
  } catch (error) {
    showToast(error.message, 'error');
  } finally {
    setBusy(elements.confirmResetButton, false);
  }
}

function bindEvents() {
  elements.syncButton.addEventListener('click', synchronizeProfile);
  elements.profileInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') synchronizeProfile();
  });
  elements.startButton.addEventListener('click', startEnrichment);
  elements.pauseButton.addEventListener('click', pauseEnrichment);
  elements.retryButton.addEventListener('click', retryErrors);
  elements.searchInput.addEventListener('input', () => { state.page = 1; applyFilters(); });
  for (const control of [elements.playFilter, elements.statusFilter, elements.genreFilter, elements.sortSelect]) {
    control.addEventListener('change', () => { state.page = 1; applyFilters(); });
  }
  elements.viewSelect.addEventListener('change', renderGames);
  elements.previousPage.addEventListener('click', () => { state.page -= 1; renderGames(); window.scrollTo({ top: elements.gameGrid.offsetTop - 30, behavior: 'smooth' }); });
  elements.nextPage.addEventListener('click', () => { state.page += 1; renderGames(); window.scrollTo({ top: elements.gameGrid.offsetTop - 30, behavior: 'smooth' }); });
  elements.openResetButton.addEventListener('click', () => elements.resetDialog.showModal());
  elements.confirmResetButton.addEventListener('click', resetData);
}

async function initialize() {
  bindEvents();
  try {
    await Promise.all([loadConfig(), loadLibrary({ preservePage: false }), pollStatus()]);
    state.statusPoll = setInterval(pollStatus, 2000);
  } catch (error) {
    elements.serviceState.textContent = 'Serveur indisponible';
    elements.serviceState.className = 'service-state offline';
    showToast(error.message, 'error');
  }
}

initialize();
