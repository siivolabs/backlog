'use strict';

const PAGE_SIZE = 50;
const ENRICHMENT_LIMIT = 10;
const MAX_FILE_BYTES = 25 * 1024 * 1024;
const numberFormatter = new Intl.NumberFormat('fr-FR');
const collator = new Intl.Collator('fr', { sensitivity: 'base', numeric: true });

const state = {
  games: [],
  filteredGames: [],
  metadata: new Map(),
  page: 1,
  view: 'grid',
  enriching: false,
};

const elements = {
  fileInput: document.querySelector('#file-input'),
  clearButton: document.querySelector('#clear-button'),
  importStatus: document.querySelector('#import-status'),
  searchInput: document.querySelector('#search-input'),
  statusFilter: document.querySelector('#status-filter'),
  genreFilter: document.querySelector('#genre-filter'),
  sortSelect: document.querySelector('#sort-select'),
  viewSelect: document.querySelector('#view-select'),
  catalogue: document.querySelector('#catalogue'),
  emptyState: document.querySelector('#empty-state'),
  pagination: document.querySelector('.pagination'),
  previousPage: document.querySelector('#previous-page'),
  nextPage: document.querySelector('#next-page'),
  pageLabel: document.querySelector('#page-label'),
  statTotal: document.querySelector('#stat-total'),
  statUnplayed: document.querySelector('#stat-unplayed'),
  statHours: document.querySelector('#stat-hours'),
  statResults: document.querySelector('#stat-results'),
  metadataForm: document.querySelector('#metadata-form'),
  appidInput: document.querySelector('#appid-input'),
  metadataOutput: document.querySelector('#metadata-output'),
  enrichButton: document.querySelector('#enrich-button'),
};

function normalizeGame(raw) {
  const appid = Number(raw && raw.appid);
  const name = typeof raw?.name === 'string' ? raw.name.trim() : '';
  if (!Number.isSafeInteger(appid) || appid <= 0 || !name) return null;

  const minutes = Number(raw.playtime_forever);
  return {
    appid,
    name,
    playtime: Number.isFinite(minutes) && minutes > 0 ? Math.floor(minutes) : 0,
  };
}

function extractGames(payload) {
  let records;
  if (Array.isArray(payload)) records = payload;
  else if (Array.isArray(payload?.games)) records = payload.games;
  else if (Array.isArray(payload?.response?.games)) records = payload.response.games;
  else throw new Error('Aucune liste de jeux Steam n’a été trouvée dans ce fichier.');

  const uniqueGames = new Map();
  let rejected = 0;
  for (const raw of records) {
    const game = normalizeGame(raw);
    if (!game) {
      rejected += 1;
      continue;
    }
    uniqueGames.set(game.appid, game);
  }

  if (uniqueGames.size === 0) throw new Error('Le fichier ne contient aucun jeu exploitable.');
  return { games: [...uniqueGames.values()], rejected, duplicates: records.length - rejected - uniqueGames.size };
}

function setImportStatus(message, kind = '') {
  elements.importStatus.textContent = message;
  elements.importStatus.className = `status-message ${kind}`.trim();
}

function setControlsEnabled(enabled) {
  for (const element of [
    elements.clearButton,
    elements.searchInput,
    elements.statusFilter,
    elements.genreFilter,
    elements.sortSelect,
    elements.viewSelect,
    elements.enrichButton,
  ]) element.disabled = !enabled;
}

function formatPlaytime(minutes) {
  if (minutes === 0) return 'Jamais lancé';
  if (minutes < 60) return `${minutes} min`;
  const hours = minutes / 60;
  return `${hours < 10 ? hours.toFixed(1).replace('.', ',') : numberFormatter.format(Math.round(hours))} h`;
}

function getGenres(game) {
  return state.metadata.get(game.appid)?.genres || [];
}

function rebuildGenreFilter() {
  const previous = elements.genreFilter.value;
  const genres = [...new Set([...state.metadata.values()].flatMap((item) => item.genres))]
    .sort((a, b) => collator.compare(a, b));

  elements.genreFilter.replaceChildren();
  const allOption = document.createElement('option');
  allOption.value = 'all';
  allOption.textContent = genres.length ? 'Tous les genres enrichis' : 'Aucun genre enrichi';
  elements.genreFilter.append(allOption);

  for (const genre of genres) {
    const option = document.createElement('option');
    option.value = genre;
    option.textContent = genre;
    elements.genreFilter.append(option);
  }

  elements.genreFilter.value = genres.includes(previous) ? previous : 'all';
}

function applyFilters({ resetPage = true } = {}) {
  const query = elements.searchInput.value.trim().toLocaleLowerCase('fr');
  const status = elements.statusFilter.value;
  const genre = elements.genreFilter.value;
  const sort = elements.sortSelect.value;

  state.filteredGames = state.games.filter((game) => {
    if (query && !game.name.toLocaleLowerCase('fr').includes(query)) return false;
    if (status === 'unplayed' && game.playtime !== 0) return false;
    if (status === 'played' && game.playtime === 0) return false;
    if (genre !== 'all' && !getGenres(game).includes(genre)) return false;
    return true;
  });

  const sorters = {
    'name-asc': (a, b) => collator.compare(a.name, b.name),
    'name-desc': (a, b) => collator.compare(b.name, a.name),
    'time-desc': (a, b) => b.playtime - a.playtime || collator.compare(a.name, b.name),
    'time-asc': (a, b) => a.playtime - b.playtime || collator.compare(a.name, b.name),
    'appid-asc': (a, b) => a.appid - b.appid,
  };
  state.filteredGames.sort(sorters[sort] || sorters['name-asc']);
  if (resetPage) state.page = 1;
  render();
}

function createCover(game) {
  const wrapper = document.createElement('div');
  wrapper.className = 'cover-wrap';
  const image = document.createElement('img');
  image.className = 'cover';
  image.alt = '';
  image.loading = 'lazy';
  image.decoding = 'async';
  image.src = `https://cdn.akamai.steamstatic.com/steam/apps/${game.appid}/header.jpg`;
  image.addEventListener('error', () => {
    image.remove();
    wrapper.classList.add('missing');
  }, { once: true });
  wrapper.append(image);
  return wrapper;
}

function createGameCard(game) {
  const card = document.createElement('article');
  card.className = 'game-card';
  card.dataset.appid = String(game.appid);
  card.append(createCover(game));

  const body = document.createElement('div');
  body.className = 'card-body';

  const title = document.createElement('h3');
  title.className = 'game-title';
  title.textContent = game.name;

  const identifier = document.createElement('p');
  identifier.className = 'game-meta';
  identifier.textContent = `AppID ${game.appid}`;

  const playtime = document.createElement('p');
  playtime.className = 'game-meta';
  playtime.textContent = formatPlaytime(game.playtime);

  const badges = document.createElement('div');
  badges.className = 'badges';
  const genres = getGenres(game);
  if (genres.length) {
    for (const genre of genres.slice(0, 4)) {
      const badge = document.createElement('span');
      badge.className = 'badge';
      badge.textContent = genre;
      badges.append(badge);
    }
  } else {
    const badge = document.createElement('span');
    badge.className = 'badge pending';
    badge.textContent = 'Genre non enrichi';
    badges.append(badge);
  }

  body.append(title, identifier, playtime, badges);
  card.append(body);
  return card;
}

function updateStats() {
  const totalMinutes = state.games.reduce((sum, game) => sum + game.playtime, 0);
  const unplayed = state.games.filter((game) => game.playtime === 0).length;
  elements.statTotal.textContent = state.games.length ? numberFormatter.format(state.games.length) : '—';
  elements.statUnplayed.textContent = state.games.length ? numberFormatter.format(unplayed) : '—';
  elements.statHours.textContent = state.games.length ? numberFormatter.format(Math.round(totalMinutes / 60)) : '—';
  elements.statResults.textContent = state.games.length ? numberFormatter.format(state.filteredGames.length) : '—';
}

function render() {
  updateStats();
  elements.catalogue.className = `catalogue ${state.view}`;
  elements.catalogue.replaceChildren();

  if (state.games.length === 0) {
    elements.emptyState.hidden = false;
    elements.pagination.hidden = true;
    return;
  }

  if (state.filteredGames.length === 0) {
    elements.emptyState.hidden = false;
    elements.emptyState.querySelector('strong').textContent = 'Aucun résultat';
    elements.emptyState.querySelector('p').textContent = 'Modifie la recherche ou les filtres.';
    elements.pagination.hidden = true;
    return;
  }

  elements.emptyState.hidden = true;
  const pageCount = Math.max(1, Math.ceil(state.filteredGames.length / PAGE_SIZE));
  state.page = Math.min(state.page, pageCount);
  const start = (state.page - 1) * PAGE_SIZE;
  const fragment = document.createDocumentFragment();
  for (const game of state.filteredGames.slice(start, start + PAGE_SIZE)) fragment.append(createGameCard(game));
  elements.catalogue.append(fragment);

  elements.pagination.hidden = pageCount <= 1;
  elements.pageLabel.textContent = `Page ${state.page} sur ${pageCount}`;
  elements.previousPage.disabled = state.page <= 1;
  elements.nextPage.disabled = state.page >= pageCount;
}

async function importFile(file) {
  if (!file) return;
  if (file.size > MAX_FILE_BYTES) throw new Error('Ce fichier dépasse la limite de 25 Mo prévue pour ce prototype.');
  const text = await file.text();
  let payload;
  try {
    payload = JSON.parse(text.replace(/^\uFEFF/, ''));
  } catch {
    throw new Error('Le fichier n’est pas un JSON valide.');
  }

  const { games, rejected, duplicates } = extractGames(payload);
  state.games = games;
  state.filteredGames = games.slice();
  state.metadata.clear();
  state.page = 1;
  elements.searchInput.value = '';
  elements.statusFilter.value = 'all';
  elements.sortSelect.value = 'name-asc';
  elements.viewSelect.value = 'grid';
  state.view = 'grid';
  rebuildGenreFilter();
  setControlsEnabled(true);
  applyFilters();

  const notes = [];
  if (rejected) notes.push(`${rejected} entrée(s) ignorée(s)`);
  if (duplicates) notes.push(`${duplicates} doublon(s) fusionné(s)`);
  setImportStatus(
    `Import réussi : ${numberFormatter.format(games.length)} jeux chargés depuis ${file.name}.${notes.length ? ` ${notes.join(' ; ')}.` : ''}`,
    'success',
  );
}

async function fetchMetadata(appid) {
  const response = await fetch(`/api/steam/${encodeURIComponent(appid)}`, {
    headers: { Accept: 'application/json' },
  });
  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new Error(`Réponse illisible du serveur (HTTP ${response.status}).`);
  }
  if (!response.ok) throw new Error(payload.error || `Erreur HTTP ${response.status}.`);
  if (!Number.isInteger(payload.appid) || !Array.isArray(payload.genres)) throw new Error('Réponse de métadonnées inattendue.');
  return payload;
}

function saveMetadata(metadata) {
  state.metadata.set(metadata.appid, {
    name: String(metadata.name || `AppID ${metadata.appid}`),
    genres: metadata.genres.map(String).filter(Boolean),
  });
}

async function testSingleAppid(appid) {
  elements.metadataOutput.textContent = `Interrogation de Steam pour l’AppID ${appid}…`;
  const metadata = await fetchMetadata(appid);
  saveMetadata(metadata);
  rebuildGenreFilter();
  applyFilters({ resetPage: false });
  elements.metadataOutput.textContent = JSON.stringify({
    appid: metadata.appid,
    name: metadata.name,
    genres: metadata.genres,
    cache: metadata.cache,
  }, null, 2);
}

async function enrichVisibleGames() {
  if (state.enriching) return;
  const start = (state.page - 1) * PAGE_SIZE;
  const candidates = state.filteredGames
    .slice(start, start + PAGE_SIZE)
    .filter((game) => !state.metadata.has(game.appid))
    .slice(0, ENRICHMENT_LIMIT);

  if (candidates.length === 0) {
    elements.metadataOutput.textContent = 'Les jeux visibles sélectionnés sont déjà enrichis.';
    return;
  }

  state.enriching = true;
  elements.enrichButton.disabled = true;
  const failures = [];
  let completed = 0;

  try {
    for (const game of candidates) {
      elements.metadataOutput.textContent = `Enrichissement ${completed + 1}/${candidates.length} : ${game.name} (AppID ${game.appid})…`;
      try {
        saveMetadata(await fetchMetadata(game.appid));
      } catch (error) {
        failures.push(`${game.name} : ${error.message}`);
      }
      completed += 1;
    }

    rebuildGenreFilter();
    applyFilters({ resetPage: false });
    elements.metadataOutput.textContent = [
      `${completed - failures.length}/${candidates.length} jeu(x) enrichi(s).`,
      failures.length ? `Échecs :\n- ${failures.join('\n- ')}` : 'Aucune erreur.',
      'Les genres restent uniquement en mémoire pour cette session.',
    ].join('\n');
  } finally {
    state.enriching = false;
    elements.enrichButton.disabled = state.games.length === 0;
  }
}

function clearSession() {
  state.games = [];
  state.filteredGames = [];
  state.metadata.clear();
  state.page = 1;
  state.view = 'grid';
  elements.fileInput.value = '';
  elements.searchInput.value = '';
  elements.statusFilter.value = 'all';
  elements.sortSelect.value = 'name-asc';
  elements.viewSelect.value = 'grid';
  elements.metadataOutput.textContent = 'En attente d’un test.';
  rebuildGenreFilter();
  setControlsEnabled(false);
  setImportStatus('Sélectionne le fichier JSON renvoyé par Steam pour commencer.');
  elements.emptyState.querySelector('strong').textContent = 'La bibliothèque est vide';
  elements.emptyState.querySelector('p').textContent = 'Importe ton export Steam pour afficher les jeux.';
  render();
}

elements.fileInput.addEventListener('change', async () => {
  try {
    setImportStatus('Lecture du fichier…');
    await importFile(elements.fileInput.files?.[0]);
  } catch (error) {
    setImportStatus(error.message, 'error');
  }
});

elements.clearButton.addEventListener('click', clearSession);
elements.searchInput.addEventListener('input', () => applyFilters());
elements.statusFilter.addEventListener('change', () => applyFilters());
elements.genreFilter.addEventListener('change', () => applyFilters());
elements.sortSelect.addEventListener('change', () => applyFilters());
elements.viewSelect.addEventListener('change', () => {
  state.view = elements.viewSelect.value;
  render();
});
elements.previousPage.addEventListener('click', () => {
  state.page -= 1;
  render();
  elements.catalogue.scrollIntoView({ behavior: 'smooth', block: 'start' });
});
elements.nextPage.addEventListener('click', () => {
  state.page += 1;
  render();
  elements.catalogue.scrollIntoView({ behavior: 'smooth', block: 'start' });
});
elements.metadataForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const appid = Number(elements.appidInput.value);
  if (!Number.isSafeInteger(appid) || appid <= 0) {
    elements.metadataOutput.textContent = 'Saisis un AppID entier positif.';
    return;
  }
  const submitButton = elements.metadataForm.querySelector('button');
  submitButton.disabled = true;
  try {
    await testSingleAppid(appid);
  } catch (error) {
    elements.metadataOutput.textContent = `Erreur : ${error.message}`;
  } finally {
    submitButton.disabled = false;
  }
});
elements.enrichButton.addEventListener('click', enrichVisibleGames);

clearSession();
