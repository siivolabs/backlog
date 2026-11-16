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
  adminToken: '',
  selectedAppid: null,
  aiSelection: new Set(),
  aiSelectionConfirmed: false,
  aiSelectionConfirmedAt: null,
  aiStatus: null,
  aiPoll: null
};

const elements = Object.fromEntries([
  'serviceState', 'apiBadge', 'profileInput', 'adminToken', 'syncButton', 'syncSummary',
  'totalGames', 'neverPlayed', 'totalHours', 'playedGames', 'startButton', 'pauseButton',
  'retryButton', 'progressMessage', 'progressPercent', 'progressBar', 'countPending',
  'countSyncing', 'countSynced', 'countErrors', 'countUnavailable', 'searchInput',
  'playFilter', 'statusFilter', 'appTypeFilter', 'genreFilter', 'sortSelect', 'viewSelect', 'gameGrid',
  'emptyState', 'emptyTitle', 'emptyText', 'pagination', 'previousPage', 'nextPage',
  'pageInfo', 'openResetButton', 'resetDialog', 'resetScope', 'resetConfirmation',
  'confirmResetButton', 'includePlayedRecommendations', 'includeTechnicalRecommendations',
  'refreshRecommendations', 'recommendationSummary', 'recommendationGrid', 'gameDialog',
  'detailTitle', 'detailCover', 'detailOrigin', 'detailFacts', 'detailClassification',
  'detailIgdbFuture', 'editDisplayName', 'editApplicationType', 'editGenres', 'editThemes',
  'editPlatforms', 'saveGameButton', 'restoreSourceButton', 'aiSelectionCount', 'aiGameSearch',
  'proposeAiSample', 'clearAiSelection', 'confirmAiSelection', 'aiSearchSummary', 'aiGameResults',
  'aiSelectedGames', 'aiSelectionStatus', 'testAiConnection', 'startAiAnalysis', 'pauseAiAnalysis',
  'resumeAiAnalysis', 'aiProgressMessage', 'aiProgressPercent', 'aiProgressBar', 'aiCountQueued',
  'aiCountAnalyzing', 'aiCountCompleted', 'aiCountErrors', 'aiEngineDetails', 'playSteamButton',
  'installSteamButton', 'viewSteamButton', 'detailAiProfileStatus', 'similarGamesSummary',
  'similarGamesGrid', 'toast'
].map((id) => [id, document.getElementById(id)]));

const statusLabels = {
  pending: 'En attente',
  syncing: 'En cours',
  synced: 'Synchronisé',
  temporary_error: 'Erreur temporaire',
  unavailable: 'Métadonnées introuvables'
};

const statusIcons = { pending: '…', syncing: '↻', synced: '✓', temporary_error: '!', unavailable: '⚠' };

const sourceLabels = {
  steam_store: 'Steam Store',
  igdb: 'IGDB'
};

const applicationTypeLabels = {
  full_game: 'Jeu complet', demo: 'Démo', beta: 'Bêta', prototype: 'Prototype',
  public_test: 'Test public', dedicated_server: 'Serveur dédié', software_tool: 'Logiciel / outil',
  dlc: 'DLC', multiplayer_component: 'Composant multijoueur', unknown: 'Type inconnu'
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
  elements.apiBadge.textContent = config.steamApiConfigured
    ? `Steam configuré · IGDB ${config.igdbConfigured ? 'configuré' : 'absent'}`
    : 'Clé API Steam absente';
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
  renderAiSelection();
}

function aiPilotLimit() {
  return Number(state.config?.aiPilot?.pocLimit || 50);
}

function selectedAiGames() {
  const byId = new Map(state.games.map((game) => [game.appid, game]));
  return [...state.aiSelection].map((appid) => byId.get(appid)).filter(Boolean)
    .sort((a, b) => a.name.localeCompare(b.name, 'fr', { numeric: true, sensitivity: 'base' }));
}

function markAiSelectionChanged() {
  state.aiSelectionConfirmed = false;
  state.aiSelectionConfirmedAt = null;
  renderAiSelection();
}

function toggleAiGame(appid, checked) {
  const limit = aiPilotLimit();
  if (checked && state.aiSelection.size >= limit && !state.aiSelection.has(appid)) {
    showToast(`Le POC est limité temporairement à ${limit} jeux. Retire un jeu avant d’en ajouter un autre.`, 'error');
    return;
  }
  if (checked) state.aiSelection.add(appid);
  else state.aiSelection.delete(appid);
  markAiSelectionChanged();
}

function createAiGameChoice(game) {
  const label = document.createElement('label');
  label.className = 'ai-game-choice';
  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.checked = state.aiSelection.has(game.appid);
  checkbox.addEventListener('change', () => toggleAiGame(game.appid, checkbox.checked));
  const copy = document.createElement('span');
  const title = document.createElement('strong');
  title.textContent = game.name;
  const metadata = document.createElement('small');
  metadata.textContent = `${applicationTypeLabels[game.application_type] || applicationTypeLabels.unknown} · ${formatPlaytime(game.playtime_forever)} · AppID ${game.appid}`;
  copy.append(title, metadata);
  label.append(checkbox, copy);
  return label;
}

function renderAiSelection() {
  if (!elements.aiGameResults || !elements.aiSelectedGames) return;
  const limit = aiPilotLimit();
  const count = state.aiSelection.size;
  elements.aiSelectionCount.textContent = `${count} / ${limit} sélectionné${count > 1 ? 's' : ''}`;
  elements.aiSelectionCount.className = `pill ${count > limit ? 'pill-danger' : count > 0 ? 'pill-success' : 'pill-neutral'}`;
  elements.confirmAiSelection.disabled = count < 1 || count > limit || state.aiSelectionConfirmed;

  const query = elements.aiGameSearch.value.trim().toLocaleLowerCase('fr');
  const matches = state.games.filter((game) => !query || game.name.toLocaleLowerCase('fr').includes(query));
  matches.sort((a, b) => Number(state.aiSelection.has(b.appid)) - Number(state.aiSelection.has(a.appid))
    || a.name.localeCompare(b.name, 'fr', { numeric: true, sensitivity: 'base' }));
  const visible = matches.slice(0, 120);
  elements.aiGameResults.replaceChildren(...visible.map(createAiGameChoice));
  elements.aiSearchSummary.textContent = matches.length > visible.length
    ? `${numberFormatter.format(matches.length)} résultat(s), ${visible.length} affichés. Affine la recherche.`
    : `${numberFormatter.format(matches.length)} résultat(s).`;

  const selected = selectedAiGames();
  if (!selected.length) {
    const empty = document.createElement('p');
    empty.className = 'ai-selection-empty';
    empty.textContent = 'Aucun jeu sélectionné.';
    elements.aiSelectedGames.replaceChildren(empty);
  } else {
    elements.aiSelectedGames.replaceChildren(...selected.map((game) => {
      const row = document.createElement('div');
      row.className = 'ai-selected-row';
      const name = document.createElement('span');
      name.textContent = game.name;
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'icon-button ai-remove-button';
      remove.setAttribute('aria-label', `Retirer ${game.name}`);
      remove.textContent = '×';
      remove.addEventListener('click', () => toggleAiGame(game.appid, false));
      row.append(name, remove);
      return row;
    }));
  }

  if (state.aiSelectionConfirmed) {
    elements.aiSelectionStatus.textContent = `Sélection validée (${count} jeu(x))${state.aiSelectionConfirmedAt ? ` le ${formatDate(state.aiSelectionConfirmedAt)}` : ''}. Elle est prête pour une future analyse, mais aucune analyse n’a été lancée.`;
    elements.aiSelectionStatus.className = 'help ai-status-confirmed';
  } else if (count) {
    elements.aiSelectionStatus.textContent = 'Sélection modifiable non validée. L’analyse reste bloquée jusqu’à la validation explicite.';
    elements.aiSelectionStatus.className = 'help ai-status-pending';
  } else {
    elements.aiSelectionStatus.textContent = 'Aucune sélection validée. L’analyse reste bloquée.';
    elements.aiSelectionStatus.className = 'help';
  }
}

async function loadAiPilotSelection() {
  const payload = await request('/api/ai-pilot/selection');
  state.aiSelection = new Set(payload.appids || []);
  state.aiSelectionConfirmed = Boolean(payload.confirmed);
  state.aiSelectionConfirmedAt = payload.confirmedAt || null;
  renderAiSelection();
}

async function proposeAiSample() {
  setBusy(elements.proposeAiSample, true, 'Création de la proposition…');
  try {
    const payload = await request(`/api/ai-pilot/sample?limit=${aiPilotLimit()}`);
    state.aiSelection = new Set(payload.appids || []);
    state.aiSelectionConfirmed = false;
    state.aiSelectionConfirmedAt = null;
    renderAiSelection();
    showToast(`${payload.count} jeu(x) proposé(s). Modifie la liste puis valide-la : rien n’a été imposé ni analysé.`);
  } catch (error) {
    showToast(error.message, 'error');
  } finally {
    setBusy(elements.proposeAiSample, false);
  }
}

async function confirmAiSelection() {
  const appids = [...state.aiSelection];
  if (!appids.length) return showToast('Sélectionne au moins un jeu.', 'error');
  setBusy(elements.confirmAiSelection, true, 'Validation…');
  try {
    const payload = await request('/api/ai-pilot/selection/confirm', {
      method: 'POST', admin: true, body: JSON.stringify({ appids })
    });
    state.aiSelection = new Set(payload.appids);
    state.aiSelectionConfirmed = true;
    state.aiSelectionConfirmedAt = payload.confirmedAt;
    renderAiSelection();
    await pollAiStatus();
    showToast(payload.message);
  } catch (error) {
    showToast(error.message, 'error');
  } finally {
    setBusy(elements.confirmAiSelection, false);
    renderAiSelection();
  }
}

function renderAiStatus(status) {
  state.aiStatus = status;
  const counts = status.counts || {};
  const percent = Number(status.percent || 0);
  elements.aiProgressMessage.textContent = status.currentName
    ? `${status.lastMessage || 'Analyse en cours'} (${status.currentName})`
    : status.lastMessage || 'En attente d’un lancement manuel.';
  elements.aiProgressPercent.textContent = `${percent.toLocaleString('fr-FR')} %`;
  elements.aiProgressBar.style.width = `${Math.min(100, Math.max(0, percent))}%`;
  elements.aiProgressBar.parentElement.setAttribute('aria-valuenow', String(percent));
  elements.aiCountQueued.textContent = numberFormatter.format(counts.queued || 0);
  elements.aiCountAnalyzing.textContent = numberFormatter.format(counts.analyzing || 0);
  elements.aiCountCompleted.textContent = numberFormatter.format(counts.completed || 0);
  elements.aiCountErrors.textContent = numberFormatter.format(counts.error || 0);
  const paused = status.run?.status === 'paused' || status.run?.status === 'interrupted';
  const remaining = (counts.queued || 0) + (counts.error || 0) + (counts.analyzing || 0);
  elements.startAiAnalysis.disabled = status.running || !status.selectionConfirmed || paused || !remaining;
  elements.pauseAiAnalysis.disabled = !status.running;
  elements.resumeAiAnalysis.disabled = status.running || !status.selectionConfirmed || !paused || !remaining;
  elements.testAiConnection.disabled = Boolean(status.running);
  elements.aiEngineDetails.textContent = [
    `Analyse : ${status.analysisModel}`,
    `embeddings : ${status.embeddingModel} (${status.embeddingDimensions} dimensions)`,
    status.searxngConfigured ? 'SearXNG configuré (utilisé seulement si nécessaire)' : 'SearXNG non configuré : données locales uniquement'
  ].join(' · ');
}

async function pollAiStatus() {
  try {
    const wasRunning = Boolean(state.aiStatus?.running);
    const status = await request('/api/ai-pilot/analysis/status');
    renderAiStatus(status);
    if (!status.running && wasRunning) await loadLibrary();
  } catch (error) {
    elements.aiProgressMessage.textContent = error.message;
  }
}

async function testAiConnection() {
  setBusy(elements.testAiConnection, true, 'Test…');
  try {
    const payload = await request('/api/ai-pilot/analysis/test', { method: 'POST', admin: true });
    const missing = [];
    if (!payload.analysisModelAvailable) missing.push(payload.analysisModel);
    if (!payload.embeddingModelAvailable) missing.push(payload.embeddingModel);
    if (missing.length) showToast(`Ollama répond, mais modèle(s) absent(s) : ${missing.join(', ')}.`, 'error');
    else showToast(`Ollama répond. ${payload.analysisModel} et ${payload.embeddingModel} sont disponibles.`);
  } catch (error) {
    showToast(error.message, 'error');
  } finally {
    setBusy(elements.testAiConnection, false);
    await pollAiStatus();
  }
}

async function controlAiAnalysis(action) {
  const button = action === 'pause' ? elements.pauseAiAnalysis : action === 'resume' ? elements.resumeAiAnalysis : elements.startAiAnalysis;
  setBusy(button, true, action === 'pause' ? 'Suspension…' : action === 'resume' ? 'Reprise…' : 'Lancement…');
  try {
    const payload = await request(`/api/ai-pilot/analysis/${action}`, { method: 'POST', admin: true });
    renderAiStatus(payload.status);
    showToast(payload.message);
  } catch (error) {
    showToast(error.message, 'error');
  } finally {
    setBusy(button, false);
    await pollAiStatus();
  }
}

function createSimilarGameCard(game) {
  const article = document.createElement('article');
  article.className = 'similar-game-card';
  const heading = document.createElement('div');
  heading.className = 'recommendation-heading';
  const title = document.createElement('h4');
  title.textContent = game.name;
  const score = document.createElement('strong');
  score.textContent = `${game.score.toLocaleString('fr-FR')} %`;
  heading.append(title, score);
  const subscore = document.createElement('p');
  subscore.className = 'help';
  subscore.textContent = `Sémantique ${game.embedding_score.toLocaleString('fr-FR')} % · profil ${game.profile_score.toLocaleString('fr-FR')} %`;
  const columns = document.createElement('div');
  columns.className = 'similar-reasons';
  for (const [label, values, className] of [['Ressemblances', game.similarities, 'similarities'], ['Différences', game.differences, 'differences']]) {
    const block = document.createElement('div');
    block.className = className;
    const headingElement = document.createElement('strong');
    headingElement.textContent = label;
    const list = document.createElement('ul');
    for (const value of values || []) {
      const item = document.createElement('li');
      item.textContent = value;
      list.appendChild(item);
    }
    block.append(headingElement, list);
    columns.appendChild(block);
  }
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'button button-secondary';
  button.textContent = 'Voir la fiche';
  button.addEventListener('click', () => openGameDetail(game.appid));
  article.append(heading, subscore, columns, button);
  return article;
}

async function loadAiGameDetail(appid) {
  elements.detailAiProfileStatus.textContent = 'Chargement du profil…';
  elements.detailAiProfileStatus.className = 'pill pill-neutral';
  elements.similarGamesSummary.textContent = 'Recherche des similarités calculées…';
  elements.similarGamesGrid.replaceChildren();
  try {
    const [profilePayload, similarPayload] = await Promise.all([
      request(`/api/ai-pilot/games/${appid}/profile`),
      request(`/api/ai-pilot/games/${appid}/similar?limit=10`)
    ]);
    const profile = profilePayload.profile;
    if (!profile) {
      elements.detailAiProfileStatus.textContent = 'Profil non analysé';
      elements.similarGamesSummary.textContent = 'Ce jeu ne possède pas encore de profil d’expérience IA.';
      return;
    }
    const labels = { queued: 'En attente', analyzing: 'Analyse en cours', completed: 'Profil prêt', error: 'Erreur' };
    elements.detailAiProfileStatus.textContent = labels[profile.status] || profile.status;
    elements.detailAiProfileStatus.className = `pill ${profile.status === 'completed' ? 'pill-success' : profile.status === 'error' ? 'pill-danger' : 'pill-neutral'}`;
    if (profile.status === 'error') {
      elements.similarGamesSummary.textContent = profile.error || 'L’analyse de ce jeu a échoué.';
      return;
    }
    const suggestions = similarPayload.suggestions || [];
    elements.similarGamesSummary.textContent = suggestions.length
      ? `${suggestions.length} voisin(s) calculé(s) par embeddings et dimensions d’expérience. Le moteur de recommandation historique reste inchangé.`
      : 'Le profil existe, mais les similarités ne sont pas encore disponibles pour ce lot.';
    elements.similarGamesGrid.replaceChildren(...suggestions.map(createSimilarGameCard));
  } catch (error) {
    elements.detailAiProfileStatus.textContent = 'Indisponible';
    elements.detailAiProfileStatus.className = 'pill pill-danger';
    elements.similarGamesSummary.textContent = error.message;
  }
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
  const applicationType = elements.appTypeFilter.value;
  const genre = elements.genreFilter.value;
  const sort = elements.sortSelect.value;

  state.filtered = state.games.filter((game) => {
    if (query && !game.name.toLocaleLowerCase('fr').includes(query)) return false;
    if (play === 'unplayed' && game.playtime_forever !== 0) return false;
    if (play === 'played' && game.playtime_forever === 0) return false;
    if (status !== 'all' && game.metadata_status !== status) return false;
    if (applicationType !== 'all' && game.application_type !== applicationType) return false;
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
  article.tabIndex = 0;
  article.setAttribute('role', 'button');
  article.setAttribute('aria-label', `Ouvrir la fiche de ${game.name}`);
  article.addEventListener('click', () => openGameDetail(game.appid));
  article.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      openGameDetail(game.appid);
    }
  });

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
  const source = sourceLabels[game.metadata_source] || null;
  const statusLabel = statusLabels[game.metadata_status] || statusLabels.pending;
  const statusDetail = [statusLabel, source ? `Source : ${source}` : null, game.metadata_error].filter(Boolean).join(' — ');
  badge.title = statusDetail;
  badge.setAttribute('aria-label', statusDetail);
  const icon = document.createElement('span');
  icon.setAttribute('aria-hidden', 'true');
  icon.textContent = statusIcons[game.metadata_status] || statusIcons.pending;
  const accessible = document.createElement('span');
  accessible.className = 'sr-only';
  accessible.textContent = statusDetail;
  badge.append(icon, accessible);
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
  const type = document.createElement('span');
  type.className = 'application-type';
  type.textContent = applicationTypeLabels[game.application_type] || applicationTypeLabels.unknown;
  if (game.manual_override) type.textContent += ' · corrigé';
  const genres = document.createElement('div');
  genres.className = 'genre-list';
  for (const genre of (game.genres || []).slice(0, 3)) {
    const chip = document.createElement('span');
    chip.className = 'genre';
    chip.textContent = genre;
    genres.appendChild(chip);
  }
  body.append(title, meta, type, genres);
  article.append(cover, body);
  return article;
}

function createRecommendationCard(game) {
  const article = document.createElement('article');
  article.className = 'recommendation-card';
  const heading = document.createElement('div');
  heading.className = 'recommendation-heading';
  const title = document.createElement('h3');
  title.textContent = game.name;
  const score = document.createElement('strong');
  score.textContent = `${game.recommendation_score.toLocaleString('fr-FR')} pts`;
  heading.append(title, score);
  const type = document.createElement('p');
  type.className = 'help';
  type.textContent = `${applicationTypeLabels[game.application_type] || applicationTypeLabels.unknown} · ${sourceLabels[game.metadata_source] || 'Source inconnue'}`;
  const reasons = document.createElement('ul');
  for (const reason of game.recommendation_reasons.slice(0, 3)) {
    const item = document.createElement('li');
    item.textContent = reason;
    reasons.appendChild(item);
  }
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'button button-secondary';
  button.textContent = 'Voir la fiche';
  button.addEventListener('click', () => openGameDetail(game.appid));
  article.append(heading, type, reasons, button);
  return article;
}

async function loadRecommendations() {
  setBusy(elements.refreshRecommendations, true, 'Calcul…');
  try {
    const params = new URLSearchParams({
      limit: '12',
      includePlayed: elements.includePlayedRecommendations.checked ? '1' : '0',
      includeNonGames: elements.includeTechnicalRecommendations.checked ? '1' : '0'
    });
    const payload = await request(`/api/recommendations?${params}`);
    elements.recommendationGrid.replaceChildren(...payload.suggestions.map(createRecommendationCard));
    const profileParts = [`${payload.profile.playedGames} jeu(x) joué(s) analysé(s)`];
    if (payload.profile.topGenres.length) profileParts.push(`genres dominants : ${payload.profile.topGenres.join(', ')}`);
    if (payload.profile.topThemes.length) profileParts.push(`thèmes dominants : ${payload.profile.topThemes.join(', ')}`);
    elements.recommendationSummary.textContent = payload.suggestions.length
      ? `Classement déterministe ${payload.algorithm} — ${profileParts.join(' · ')}.`
      : 'Aucune suggestion ne correspond encore aux critères et aux métadonnées disponibles.';
  } catch (error) {
    elements.recommendationSummary.textContent = error.message;
    elements.recommendationGrid.replaceChildren();
  } finally {
    setBusy(elements.refreshRecommendations, false);
  }
}

function appendFact(label, value) {
  const term = document.createElement('dt');
  term.textContent = label;
  const description = document.createElement('dd');
  description.textContent = value || 'Non renseigné';
  elements.detailFacts.append(term, description);
}

function commaValues(value) {
  return [...new Set(String(value || '').split(',').map((item) => item.trim()).filter(Boolean))];
}

function sameList(left, right) {
  return JSON.stringify([...(left || [])].sort()) === JSON.stringify([...(right || [])].sort());
}

async function openGameDetail(appid) {
  try {
    const payload = await request(`/api/games/${appid}`);
    const game = payload.game;
    state.selectedAppid = game.appid;
    elements.detailTitle.textContent = game.name;
    elements.detailCover.src = game.header_image;
    elements.detailCover.alt = `Jaquette de ${game.name}`;
    elements.detailOrigin.replaceChildren();
    const origin = document.createElement('span');
    origin.className = `origin-badge ${game.manual_override ? 'origin-manual' : 'origin-source'}`;
    origin.textContent = game.manual_override ? `Corrigé manuellement (${game.manual_fields.join(', ')})` : 'Données importées';
    elements.detailOrigin.appendChild(origin);
    elements.detailFacts.replaceChildren();
    appendFact('AppID Steam', String(game.appid));
    appendFact('Temps de jeu', formatPlaytime(game.playtime_forever));
    appendFact('Statut de jeu', game.playtime_forever > 0 ? 'Déjà lancé' : 'Jamais lancé');
    appendFact('Type', applicationTypeLabels[game.application_type] || applicationTypeLabels.unknown);
    appendFact('Genres', game.genres.join(', '));
    appendFact('Thèmes', game.themes.join(', '));
    appendFact('Plateformes', game.platforms.join(', '));
    appendFact('Sources', game.metadata_sources.map((source) => sourceLabels[source] || source).join(', '));
    appendFact('Synchronisation', statusLabels[game.metadata_status] || statusLabels.pending);
    elements.detailClassification.textContent = `Classification : ${game.classification_reason || 'non documentée'} Confiance : ${game.classification_confidence}.`;
    elements.detailIgdbFuture.textContent = game.igdb_manual_match?.status === 'confirmed'
      ? `Rapprochement IGDB manuel confirmé : ${game.igdb_manual_match.igdb_game_id}.`
      : 'Rapprochement IGDB manuel préparé mais inactif : aucune correspondance approximative n’est appliquée automatiquement.';
    elements.playSteamButton.href = `steam://run/${game.appid}`;
    elements.installSteamButton.href = `steam://install/${game.appid}`;
    elements.viewSteamButton.href = `https://store.steampowered.com/app/${game.appid}/`;
    elements.editDisplayName.value = game.name;
    elements.editApplicationType.value = game.application_type;
    elements.editGenres.value = game.genres.join(', ');
    elements.editThemes.value = game.themes.join(', ');
    elements.editPlatforms.value = game.platforms.join(', ');
    if (!elements.gameDialog.open) elements.gameDialog.showModal();
    void loadAiGameDetail(game.appid);
  } catch (error) {
    showToast(error.message, 'error');
  }
}

async function saveGameCorrection() {
  if (!state.selectedAppid) return;
  const current = state.games.find((game) => game.appid === state.selectedAppid);
  if (!current) return showToast('Jeu introuvable dans la bibliothèque chargée.', 'error');
  const source = current.source_values;
  const name = elements.editDisplayName.value.trim();
  const genres = commaValues(elements.editGenres.value);
  const themes = commaValues(elements.editThemes.value);
  const platforms = commaValues(elements.editPlatforms.value);
  const patch = {
    display_name: name === source.name ? null : name,
    application_type: elements.editApplicationType.value === source.application_type ? null : elements.editApplicationType.value,
    genres: sameList(genres, source.genres) ? null : genres,
    themes: sameList(themes, source.themes) ? null : themes,
    platforms: sameList(platforms, source.platforms) ? null : platforms
  };
  setBusy(elements.saveGameButton, true, 'Enregistrement…');
  try {
    const payload = await request(`/api/games/${state.selectedAppid}/manual`, { method: 'PATCH', admin: true, body: JSON.stringify(patch) });
    showToast('Correction manuelle enregistrée dans SQLite.');
    await loadLibrary();
    await loadRecommendations();
    await openGameDetail(payload.game.appid);
  } catch (error) {
    showToast(error.message, 'error');
  } finally {
    setBusy(elements.saveGameButton, false);
  }
}

async function restoreSourceValues() {
  if (!state.selectedAppid) return;
  setBusy(elements.restoreSourceButton, true, 'Restauration…');
  try {
    const payload = await request(`/api/games/${state.selectedAppid}/manual`, { method: 'DELETE', admin: true });
    showToast('Valeurs issues des sources rétablies.');
    await loadLibrary();
    await loadRecommendations();
    await openGameDetail(payload.game.appid);
  } catch (error) {
    showToast(error.message, 'error');
  } finally {
    setBusy(elements.restoreSourceButton, false);
  }
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
      await loadRecommendations();
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
    await loadAiPilotSelection();
    await loadRecommendations();
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
    await loadAiPilotSelection();
    await loadRecommendations();
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
  for (const control of [elements.playFilter, elements.statusFilter, elements.appTypeFilter, elements.genreFilter, elements.sortSelect]) {
    control.addEventListener('change', () => { state.page = 1; applyFilters(); });
  }
  elements.viewSelect.addEventListener('change', renderGames);
  elements.previousPage.addEventListener('click', () => { state.page -= 1; renderGames(); window.scrollTo({ top: elements.gameGrid.offsetTop - 30, behavior: 'smooth' }); });
  elements.nextPage.addEventListener('click', () => { state.page += 1; renderGames(); window.scrollTo({ top: elements.gameGrid.offsetTop - 30, behavior: 'smooth' }); });
  elements.openResetButton.addEventListener('click', () => elements.resetDialog.showModal());
  elements.confirmResetButton.addEventListener('click', resetData);
  elements.refreshRecommendations.addEventListener('click', loadRecommendations);
  elements.includePlayedRecommendations.addEventListener('change', loadRecommendations);
  elements.includeTechnicalRecommendations.addEventListener('change', loadRecommendations);
  elements.aiGameSearch.addEventListener('input', renderAiSelection);
  elements.proposeAiSample.addEventListener('click', proposeAiSample);
  elements.clearAiSelection.addEventListener('click', () => {
    state.aiSelection.clear();
    markAiSelectionChanged();
    showToast('Sélection locale effacée. Aucune analyse ne peut démarrer.');
  });
  elements.confirmAiSelection.addEventListener('click', confirmAiSelection);
  elements.testAiConnection.addEventListener('click', testAiConnection);
  elements.startAiAnalysis.addEventListener('click', () => controlAiAnalysis('start'));
  elements.pauseAiAnalysis.addEventListener('click', () => controlAiAnalysis('pause'));
  elements.resumeAiAnalysis.addEventListener('click', () => controlAiAnalysis('resume'));
  elements.saveGameButton.addEventListener('click', saveGameCorrection);
  elements.restoreSourceButton.addEventListener('click', restoreSourceValues);
}

async function initialize() {
  bindEvents();
  try {
    await Promise.all([loadConfig(), loadLibrary({ preservePage: false }), pollStatus()]);
    await loadAiPilotSelection();
    await pollAiStatus();
    await loadRecommendations();
    state.statusPoll = setInterval(pollStatus, 2000);
    state.aiPoll = setInterval(pollAiStatus, 2000);
  } catch (error) {
    elements.serviceState.textContent = 'Serveur indisponible';
    elements.serviceState.className = 'service-state offline';
    showToast(error.message, 'error');
  }
}

initialize();
