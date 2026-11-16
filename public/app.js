'use strict';

const state = {
  games: [],
  filteredGames: [],
  sourceName: '',
  importedAt: null,
  page: 1,
  pageSize: 50,
  filters: { search: '', play: 'all', genre: 'all', sort: 'name-asc', view: 'grid' }
};

const elements = {
  fileInput: document.querySelector('#fileInput'),
  clearButton: document.querySelector('#clearButton'),
  importStatus: document.querySelector('#importStatus'),
  statImported: document.querySelector('#statImported'),
  statUnplayed: document.querySelector('#statUnplayed'),
  statHours: document.querySelector('#statHours'),
  statResults: document.querySelector('#statResults'),
  appidForm: document.querySelector('#appidForm'),
  appidInput: document.querySelector('#appidInput'),
  enrichButton: document.querySelector('#enrichButton'),
  enrichLog: document.querySelector('#enrichLog'),
  searchInput: document.querySelector('#searchInput'),
  playFilter: document.querySelector('#playFilter'),
  genreFilter: document.querySelector('#genreFilter'),
  sortSelect: document.querySelector('#sortSelect'),
  viewSelect: document.querySelector('#viewSelect'),
  emptyState: document.querySelector('#emptyState'),
  emptyTitle: document.querySelector('#emptyTitle'),
  emptyText: document.querySelector('#emptyText'),
  gameGrid: document.querySelector('#gameGrid'),
  pagination: document.querySelector('#pagination'),
  previousPage: document.querySelector('#previousPage'),
  nextPage: document.querySelector('#nextPage'),
  pageLabel: document.querySelector('#pageLabel')
};

const numberFormatter = new Intl.NumberFormat('fr-FR');
const collator = new Intl.Collator('fr', { sensitivity: 'base', numeric: true });

function formatInteger(value) { return numberFormatter.format(Math.round(value || 0)); }
function formatPlaytime(minutes) {
  if (!minutes) return 'Jamais lancé';
  if (minutes < 60) return `${minutes} min`;
  const hours = minutes / 60;
  return `${hours < 10 ? hours.toFixed(1).replace('.', ',') : Math.round(hours)} h`;
}
function coverUrl(appid) { return `https://cdn.akamai.steamstatic.com/steam/apps/${appid}/header.jpg`; }
function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character]);
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: options.body ? { 'Content-Type': 'application/json', ...(options.headers || {}) } : options.headers
  });
  let payload;
  try { payload = await response.json(); } catch { payload = {}; }
  if (!response.ok) throw new Error(payload.error || `Erreur HTTP ${response.status}`);
  return payload;
}

function extractGames(payload) {
  const candidates = [payload?.response?.games, payload?.games, Array.isArray(payload) ? payload : null];
  const games = candidates.find(Array.isArray);
  if (!games) throw new Error('Format non reconnu : liste response.games introuvable.');
  return games;
}

function normalizeServerGame(game) {
  return {
    ...game,
    appid: Number(game.appid),
    playtime_forever: Number(game.playtime_forever || 0),
    genres: Array.isArray(game.genres) ? game.genres : []
  };
}

function setImportStatus(message, isError = false) {
  elements.importStatus.textContent = message;
  elements.importStatus.className = `status ${isError ? 'error' : 'success'}`;
}

async function loadLibrary({ announce = true } = {}) {
  const payload = await api('/api/library');
  state.games = (payload.games || []).map(normalizeServerGame);
  state.sourceName = payload.state?.source_name || '';
  state.importedAt = payload.state?.imported_at || null;
  if (announce) {
    if (state.games.length) {
      const source = state.sourceName ? ` depuis ${state.sourceName}` : '';
      setImportStatus(`Bibliothèque restaurée : ${formatInteger(state.games.length)} jeux chargés${source}.`);
    } else {
      setImportStatus('La bibliothèque enregistrée sera restaurée automatiquement.');
    }
  }
  rebuildGenreFilter();
  applyFilters();
}

async function importFile(file) {
  setImportStatus(`Lecture de ${file.name}…`);
  let payload;
  try { payload = JSON.parse(await file.text()); }
  catch { throw new Error('Le fichier ne contient pas un JSON valide.'); }
  const games = extractGames(payload);
  setImportStatus(`Import de ${formatInteger(games.length)} jeux vers SQLite…`);
  const result = await api('/api/library/import', {
    method: 'POST',
    body: JSON.stringify({ games, sourceName: file.name })
  });
  await loadLibrary({ announce: false });
  setImportStatus(`Import réussi : ${formatInteger(result.imported)} jeux enregistrés depuis ${file.name}.`);
}

function rebuildGenreFilter() {
  const selected = state.filters.genre;
  const genres = [...new Set(state.games.flatMap((game) => game.genres || []))].sort(collator.compare);
  elements.genreFilter.innerHTML = '<option value="all">Tous les genres enrichis</option>' + genres.map((genre) => `<option value="${escapeHtml(genre)}">${escapeHtml(genre)}</option>`).join('');
  if (genres.includes(selected)) elements.genreFilter.value = selected;
  else state.filters.genre = 'all';
}

function applyFilters({ resetPage = false } = {}) {
  if (resetPage) state.page = 1;
  const query = state.filters.search.trim().toLocaleLowerCase('fr');
  let games = state.games.filter((game) => {
    if (query && !game.name.toLocaleLowerCase('fr').includes(query)) return false;
    if (state.filters.play === 'played' && game.playtime_forever <= 0) return false;
    if (state.filters.play === 'unplayed' && game.playtime_forever > 0) return false;
    if (state.filters.genre !== 'all' && !game.genres.includes(state.filters.genre)) return false;
    return true;
  });
  games.sort((a, b) => {
    if (state.filters.sort === 'name-desc') return collator.compare(b.name, a.name);
    if (state.filters.sort === 'time-desc') return b.playtime_forever - a.playtime_forever || collator.compare(a.name, b.name);
    if (state.filters.sort === 'time-asc') return a.playtime_forever - b.playtime_forever || collator.compare(a.name, b.name);
    return collator.compare(a.name, b.name);
  });
  state.filteredGames = games;
  const maxPage = Math.max(1, Math.ceil(games.length / state.pageSize));
  state.page = Math.min(state.page, maxPage);
  render();
}

function renderStats() {
  const unplayed = state.games.filter((game) => game.playtime_forever === 0).length;
  const minutes = state.games.reduce((sum, game) => sum + game.playtime_forever, 0);
  elements.statImported.textContent = formatInteger(state.games.length);
  elements.statUnplayed.textContent = formatInteger(unplayed);
  elements.statHours.textContent = formatInteger(minutes / 60);
  elements.statResults.textContent = formatInteger(state.filteredGames.length);
}

function updateEmptyState() {
  const libraryIsEmpty = state.games.length === 0;
  const noResults = state.filteredGames.length === 0;
  if (libraryIsEmpty) {
    elements.emptyState.hidden = false;
    elements.emptyTitle.textContent = 'La bibliothèque est vide';
    elements.emptyText.textContent = 'Importe ton export Steam pour afficher les jeux.';
  } else if (noResults) {
    elements.emptyState.hidden = false;
    elements.emptyTitle.textContent = 'Aucun jeu ne correspond à vos critères';
    elements.emptyText.textContent = 'Modifie la recherche ou les filtres pour retrouver tes jeux.';
  } else {
    elements.emptyState.hidden = true;
  }
  elements.gameGrid.hidden = noResults;
}

function gameCard(game) {
  const genres = game.genres.length
    ? game.genres.map((genre) => `<span class="genre">${escapeHtml(genre)}</span>`).join('')
    : '<span class="genre pending">Genres non enrichis</span>';
  return `<article class="game-card" data-appid="${game.appid}">
    <img src="${coverUrl(game.appid)}" alt="" loading="lazy" decoding="async">
    <div class="game-card-body">
      <h3>${escapeHtml(game.name)}</h3>
      <p class="game-meta">${formatPlaytime(game.playtime_forever)} · AppID ${game.appid}</p>
      <div class="genre-list">${genres}</div>
    </div>
  </article>`;
}

function renderGames() {
  const start = (state.page - 1) * state.pageSize;
  const pageGames = state.filteredGames.slice(start, start + state.pageSize);
  elements.gameGrid.className = `game-grid${state.filters.view === 'list' ? ' list-view' : ''}`;
  elements.gameGrid.innerHTML = pageGames.map(gameCard).join('');
  const totalPages = Math.max(1, Math.ceil(state.filteredGames.length / state.pageSize));
  elements.pagination.hidden = state.filteredGames.length <= state.pageSize;
  elements.pageLabel.textContent = `Page ${state.page} sur ${totalPages}`;
  elements.previousPage.disabled = state.page <= 1;
  elements.nextPage.disabled = state.page >= totalPages;
}

function render() {
  renderStats();
  updateEmptyState();
  renderGames();
}

function visibleUnenrichedAppids() {
  const start = (state.page - 1) * state.pageSize;
  return state.filteredGames.slice(start, start + state.pageSize).filter((game) => !game.enriched).slice(0, 10).map((game) => game.appid);
}

async function enrichBatch() {
  const appids = visibleUnenrichedAppids();
  if (!appids.length) {
    elements.enrichLog.textContent = state.games.length ? 'Aucun jeu non enrichi parmi les résultats visibles.' : 'Importe d’abord une bibliothèque.';
    return;
  }
  elements.enrichButton.disabled = true;
  elements.enrichLog.textContent = `Enrichissement de ${appids.length}/10 jeu(x)…`;
  try {
    const payload = await api('/api/library/enrich', { method: 'POST', body: JSON.stringify({ appids }) });
    const succeeded = payload.results.filter((result) => result.ok);
    const failed = payload.results.filter((result) => !result.ok);
    await loadLibrary({ announce: false });
    const lines = [`${succeeded.length}/${appids.length} jeu(x) enrichi(s).`];
    for (const item of succeeded) lines.push(`✓ ${item.name || `AppID ${item.appid}`} : ${item.genres.join(', ') || 'aucun genre'}`);
    for (const item of failed) lines.push(`✗ AppID ${item.appid} : ${item.error}`);
    lines.push('Les genres sont enregistrés dans SQLite.');
    elements.enrichLog.textContent = lines.join('\n');
  } catch (error) {
    elements.enrichLog.textContent = `Erreur : ${error.message}`;
  } finally {
    elements.enrichButton.disabled = false;
  }
}

async function testAppid(event) {
  event.preventDefault();
  const appid = elements.appidInput.value.trim();
  if (!/^\d+$/.test(appid)) {
    elements.enrichLog.textContent = 'Erreur : saisis un AppID numérique.';
    return;
  }
  elements.enrichLog.textContent = `Récupération de l’AppID ${appid}…`;
  try {
    const result = await api(`/api/steam/${encodeURIComponent(appid)}`);
    elements.enrichLog.textContent = JSON.stringify({ appid: result.appid, name: result.name, genres: result.genres, cached: result.cached }, null, 2);
    if (state.games.some((game) => game.appid === result.appid)) await loadLibrary({ announce: false });
  } catch (error) {
    elements.enrichLog.textContent = `Erreur : ${error.message}`;
  }
}

async function clearLibrary() {
  await api('/api/library', { method: 'DELETE' });
  state.page = 1;
  await loadLibrary({ announce: false });
  setImportStatus('Bibliothèque et métadonnées effacées.');
  elements.enrichLog.textContent = 'Prêt. Aucun enrichissement automatique n’est lancé.';
}

function bindEvents() {
  elements.fileInput.addEventListener('change', async () => {
    const [file] = elements.fileInput.files;
    if (!file) return;
    try { await importFile(file); }
    catch (error) { setImportStatus(`Échec de l’import : ${error.message}`, true); }
    finally { elements.fileInput.value = ''; }
  });
  elements.clearButton.addEventListener('click', () => clearLibrary().catch((error) => setImportStatus(error.message, true)));
  elements.appidForm.addEventListener('submit', testAppid);
  elements.enrichButton.addEventListener('click', enrichBatch);
  elements.searchInput.addEventListener('input', () => { state.filters.search = elements.searchInput.value; applyFilters({ resetPage: true }); });
  elements.playFilter.addEventListener('change', () => { state.filters.play = elements.playFilter.value; applyFilters({ resetPage: true }); });
  elements.genreFilter.addEventListener('change', () => { state.filters.genre = elements.genreFilter.value; applyFilters({ resetPage: true }); });
  elements.sortSelect.addEventListener('change', () => { state.filters.sort = elements.sortSelect.value; applyFilters({ resetPage: true }); });
  elements.viewSelect.addEventListener('change', () => { state.filters.view = elements.viewSelect.value; renderGames(); });
  elements.previousPage.addEventListener('click', () => { if (state.page > 1) { state.page -= 1; render(); window.scrollTo({ top: elements.gameGrid.offsetTop - 20, behavior: 'smooth' }); } });
  elements.nextPage.addEventListener('click', () => { if (state.page * state.pageSize < state.filteredGames.length) { state.page += 1; render(); window.scrollTo({ top: elements.gameGrid.offsetTop - 20, behavior: 'smooth' }); } });
  elements.gameGrid.addEventListener('error', (event) => {
    if (event.target.tagName === 'IMG') {
      event.target.src = 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="460" height="215"><rect width="100%" height="100%" fill="#12243b"/><text x="50%" y="52%" dominant-baseline="middle" text-anchor="middle" fill="#8ca9c4" font-family="sans-serif" font-size="20">Jaquette indisponible</text></svg>');
    }
  }, true);
}

bindEvents();
loadLibrary().catch((error) => {
  setImportStatus(`Impossible de charger la bibliothèque : ${error.message}`, true);
  applyFilters();
});
