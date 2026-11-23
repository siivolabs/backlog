const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const state = { page: 1, pages: 1, search: '', status: 'all', token: localStorage.getItem('backlog.adminToken') || '', referenceAppId: '', libraryController: null, suggestionController: null };

function escapeHtml(value) { return String(value ?? '').replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char])); }
function toast(message, error = false) { const el = $('#toast'); el.textContent = message; el.className = error ? 'show error' : 'show'; clearTimeout(toast.timer); toast.timer = setTimeout(() => { el.className = ''; }, 3600); }

async function api(path, options = {}) {
  const headers = { ...(options.body ? { 'content-type': 'application/json' } : {}), ...(options.headers || {}) };
  if (state.token) headers['x-admin-token'] = state.token;
  const response = await fetch(path, { ...options, headers });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(data.error || `Erreur ${response.status}`), { status: response.status });
  return data;
}

function openToken(message = '') { if (message) toast(message, true); $('#tokenInput').value = state.token; $('#tokenDialog').showModal(); }
function requireToken() { if (!state.token) { openToken('Validez le jeton avant cette action.'); return false; } return true; }

function libraryCard(game) {
  const status = game.completed ? '<span class="badge completed">✓ Terminé</span>' : game.enriched ? '<span class="badge">Profil enrichi</span>' : '<span class="badge">En attente</span>';
  return `<article class="game-card ${game.enriched ? 'game-open' : ''}" data-id="${escapeHtml(game.app_id)}" ${game.enriched ? 'tabindex="0" role="button" aria-label="Ouvrir le profil de '+escapeHtml(game.title)+'"' : ''}>
    <div class="cover"><img src="${escapeHtml(game.cover_url || '')}" alt="Couverture de ${escapeHtml(game.title)}" loading="lazy"></div>
    <div class="card-body"><h3 title="${escapeHtml(game.title)}">${escapeHtml(game.title)}</h3><p>${escapeHtml(game.studio || game.genres || 'Métadonnées limitées')}</p>
      <div class="card-meta">${status}</div><div class="card-actions">
        ${game.enriched ? '<button data-action="profile">Voir la fiche</button>' : ''}
        <button data-action="completed" data-completed="${game.completed ? 'false' : 'true'}">${game.completed ? 'Annuler terminé' : 'Terminé'}</button>
      </div></div></article>`;
}

function discoveryCard(game) {
  const score = game.similarity == null ? '<p class="score">Sélection surprise</p>' : `<p class="score">Proximité sémantique ${Math.round(game.similarity * 100)} %</p>`;
  const cls = game.reliability === 'solide' ? 'solid' : game.reliability === 'suffisante' ? 'sufficient' : 'fragile';
  return `<article class="game-card discovery-card" data-id="${escapeHtml(game.app_id)}">
    <div class="cover"><img src="${escapeHtml(game.cover_url || '')}" alt="Couverture de ${escapeHtml(game.title)}" loading="lazy"></div>
    <div class="card-body"><h3 title="${escapeHtml(game.title)}">${escapeHtml(game.title)}</h3><p>${escapeHtml(game.summary || game.genres || '')}</p>${score}
      <div class="card-meta"><span class="badge quality-${cls}">Fiabilité ${escapeHtml(game.reliability)}</span>${game.previously_presented ? `<span class="badge">déjà présenté ${game.previously_presented}×</span>` : ''}</div>
      <div class="feedback-row"><button data-action="feedback" data-verdict="positive">Pertinent</button><button data-action="feedback" data-verdict="negative">Écarter</button><button data-action="completed" data-completed="true">Terminé</button><button data-action="profile">Fiche</button></div>
    </div></article>`;
}

async function loadStatus() {
  const [status, enrichment] = await Promise.all([api('/api/status'), api('/api/enrichment/status')]);
  $('#gameCount').textContent = status.games.toLocaleString('fr-FR'); $('#profileCount').textContent = status.profiles.toLocaleString('fr-FR'); $('#completedCount').textContent = status.completed.toLocaleString('fr-FR');
  $('#queueCount').textContent = (enrichment.queue.pending + enrichment.queue.running + enrichment.queue.error).toLocaleString('fr-FR');
  $('#enrichmentToggle').textContent = enrichment.paused ? 'Reprendre' : 'Pause'; $('#enrichmentToggle').dataset.paused = enrichment.paused ? 'true' : 'false';
}

async function loadLibrary() {
  state.libraryController?.abort(); state.libraryController = new AbortController();
  const query = new URLSearchParams({ page: state.page, pageSize: 48, search: state.search, status: state.status });
  try {
    const data = await api(`/api/library?${query}`, { signal: state.libraryController.signal });
    state.pages = data.pages; $('#gameGrid').innerHTML = data.items.length ? data.items.map(libraryCard).join('') : '<p class="empty">Aucun jeu pour ce filtre.</p>';
    $('#resultCount').textContent = `${data.total.toLocaleString('fr-FR')} jeu${data.total > 1 ? 'x' : ''}`; $('#pageText').textContent = `Page ${data.page} / ${data.pages}`;
    $('#previousPage').disabled = data.page <= 1; $('#nextPage').disabled = data.page >= data.pages;
  } catch (error) { if (error.name !== 'AbortError') toast(error.message, true); }
}

function clearReference(keepText = false) { state.referenceAppId = ''; $('#referenceAppId').value = ''; $('#referenceSelection').hidden = true; if (!keepText) $('#referenceInput').value = ''; }
function selectReference(game) { state.referenceAppId = game.app_id; $('#referenceAppId').value = game.app_id; $('#referenceInput').value = game.title; $('#referenceSelection').textContent = `${game.title} · AppID ${game.app_id}`; $('#referenceSelection').hidden = false; $('#referenceSuggestions').hidden = true; }

async function searchReferences(value) {
  clearReference(true); const query = value.trim(); const list = $('#referenceSuggestions');
  if (!query) { list.hidden = true; list.innerHTML = ''; return; }
  state.suggestionController?.abort(); state.suggestionController = new AbortController();
  try {
    const data = await api(`/api/library/search?q=${encodeURIComponent(query)}&limit=12`, { signal: state.suggestionController.signal });
    list.innerHTML = data.items.length ? data.items.map((game) => `<button type="button" role="option" data-id="${escapeHtml(game.app_id)}" data-title="${escapeHtml(game.title)}"><span>${escapeHtml(game.title)}</span><small>${escapeHtml(game.studio || '')} · ${escapeHtml(game.app_id)}</small></button>`).join('') : '<div class="empty">Aucun jeu trouvé.</div>';
    list.hidden = false;
  } catch (error) { if (error.name !== 'AbortError') toast(error.message, true); }
}

async function runDiscovery(surprise = false) {
  if (surprise) { clearReference(); $('#motivationInput').value = ''; }
  const motivation = $('#motivationInput').value.trim(); const reference = state.referenceAppId;
  if (!surprise && !motivation && !reference) { toast('Choisissez un jeu, décrivez une envie ou utilisez « Surprends-moi ».'); return; }
  $('#discoverButton').disabled = true; $('#surpriseButton').disabled = true; $('#discoveryResults').innerHTML = '<p class="empty">Exploration de la bibliothèque…</p>';
  try {
    const data = await api('/api/discovery', { method: 'POST', body: JSON.stringify({ reference_app_id: reference, motivation_text: motivation }) });
    $('#discoveryResults').innerHTML = data.items.length ? data.items.map(discoveryCard).join('') : '<p class="empty">Aucune proposition suffisamment étayée. Backlog préfère s’abstenir plutôt que recommander sur du vide.</p>';
    $('#discoveryNotice').textContent = data.notice; $('#filteredCount').textContent = data.rejected.insufficient_quality ? `${data.rejected.insufficient_quality} profil(s) insuffisants écarté(s)` : '';
  } catch (error) { $('#discoveryResults').innerHTML = ''; toast(error.message, true); }
  finally { $('#discoverButton').disabled = false; $('#surpriseButton').disabled = false; }
}

async function feedback(card, verdict, button) {
  if (!requireToken()) return;
  try { await api('/api/discovery/feedback', { method: 'POST', body: JSON.stringify({ reference_app_id: state.referenceAppId || '__motivation__', candidate_app_id: card.dataset.id, motivation_key: $('#motivationInput').value.trim(), verdict }) }); button.disabled = true; toast(verdict === 'positive' ? 'Pertinence enregistrée.' : 'Jeu écarté et dépriorisé.'); }
  catch (error) { toast(error.message, true); }
}

async function toggleCompleted(card, value) {
  if (!requireToken()) return;
  try {
    const result = await api(`/api/library/${encodeURIComponent(card.dataset.id)}/completed`, { method: 'PATCH', body: JSON.stringify({ completed: value }) });
    toast(result.completed ? 'Jeu marqué comme terminé.' : 'Statut « Terminé » annulé.');
    if (card.closest('#discoveryResults') && result.completed) card.remove();
    await Promise.all([loadLibrary(), loadStatus()]);
  } catch (error) { toast(error.message, true); }
}

function renderValue(value, depth = 0) {
  if (value == null) return '<span class="muted">Non renseigné</span>';
  if (Array.isArray(value)) {
    if (value.length > 100 && value.every((item) => typeof item === 'number')) return `<details><summary>${value.length} valeurs — afficher l’embedding complet</summary><p>${value.map((item) => escapeHtml(item)).join(', ')}</p></details>`;
    return `<ol class="json-list">${value.map((item) => `<li>${renderValue(item, depth + 1)}</li>`).join('')}</ol>`;
  }
  if (typeof value === 'object') return `<dl class="data-grid">${Object.entries(value).map(([key, item]) => `<dt>${escapeHtml(key)}</dt><dd>${renderValue(item, depth + 1)}</dd>`).join('')}</dl>`;
  if (typeof value === 'boolean') return value ? 'Oui' : 'Non';
  return escapeHtml(value);
}

async function openProfile(appId) {
  const dialog = $('#profileDialog'); $('#profileTitle').textContent = 'Chargement…'; $('#profileContent').innerHTML = '<p class="empty">Lecture du profil…</p>'; dialog.showModal();
  try {
    const data = await api(`/api/library/${encodeURIComponent(appId)}/profile`); $('#profileTitle').textContent = data.title;
    $('#profileContent').innerHTML = `<section class="profile-section"><h3>État</h3>${renderValue({ app_id: data.app_id, schema_version: data.schema_version, completed: data.completed, confidence: data.confidence })}</section>
      <section class="profile-section"><h3>Profil JSON</h3>${renderValue(data.profile)}</section><section class="profile-section"><h3>Source JSON</h3>${renderValue(data.source)}</section>
      <section class="profile-section"><h3>Modèles</h3>${renderValue({ analysis_model: data.analysis_model, embedding_model: data.embedding_model })}</section><section class="profile-section"><h3>Embedding JSON</h3>${renderValue(data.embedding)}</section>`;
  } catch (error) { $('#profileContent').innerHTML = `<p class="empty">${escapeHtml(error.message)}</p>`; }
}

function cardAction(event, root) {
  const button = event.target.closest('button[data-action]'); const card = event.target.closest('.game-card'); if (!card) return;
  if (button) {
    event.stopPropagation(); const action = button.dataset.action;
    if (action === 'profile') openProfile(card.dataset.id);
    if (action === 'completed') toggleCompleted(card, button.dataset.completed === 'true');
    if (action === 'feedback') feedback(card, button.dataset.verdict, button);
    return;
  }
  if (root === 'library' && card.classList.contains('game-open')) openProfile(card.dataset.id);
}

function showView(name) {
  $$('.view').forEach((view) => view.classList.toggle('active', view.id === `${name}View`)); $$('.nav-button').forEach((button) => button.classList.toggle('active', button.dataset.view === name));
  history.replaceState(null, '', `#${name}`);
}

async function initialize() {
  $$('.nav-button').forEach((button) => button.addEventListener('click', () => showView(button.dataset.view)));
  $$('[data-close]').forEach((button) => button.addEventListener('click', () => $(`#${button.dataset.close}`).close()));
  $('#tokenButton').addEventListener('click', () => openToken()); $('#tokenForm').addEventListener('submit', (event) => { event.preventDefault(); state.token = $('#tokenInput').value.trim(); localStorage.setItem('backlog.adminToken', state.token); $('#tokenDialog').close(); toast('Jeton enregistré dans ce navigateur.'); });
  let searchTimer; $('#searchInput').addEventListener('input', (event) => { clearTimeout(searchTimer); searchTimer = setTimeout(() => { state.search = event.target.value; state.page = 1; loadLibrary(); }, 250); });
  $('#statusFilter').addEventListener('change', (event) => { state.status = event.target.value; state.page = 1; loadLibrary(); });
  $('#previousPage').addEventListener('click', () => { state.page -= 1; loadLibrary(); }); $('#nextPage').addEventListener('click', () => { state.page += 1; loadLibrary(); });
  $('#gameGrid').addEventListener('click', (event) => cardAction(event, 'library')); $('#gameGrid').addEventListener('keydown', (event) => { if ((event.key === 'Enter' || event.key === ' ') && !event.target.closest('button')) cardAction(event, 'library'); });
  $('#discoveryResults').addEventListener('click', (event) => cardAction(event, 'discovery'));
  let suggestionTimer; $('#referenceInput').addEventListener('input', (event) => { clearTimeout(suggestionTimer); suggestionTimer = setTimeout(() => searchReferences(event.target.value), 220); });
  $('#referenceSuggestions').addEventListener('click', (event) => { const button = event.target.closest('button[data-id]'); if (button) selectReference({ app_id: button.dataset.id, title: button.dataset.title }); });
  document.addEventListener('click', (event) => { if (!event.target.closest('.suggestion-field')) $('#referenceSuggestions').hidden = true; });
  $('#discoverButton').addEventListener('click', () => runDiscovery(false)); $('#surpriseButton').addEventListener('click', () => runDiscovery(true));
  $('#inventoryFile').addEventListener('change', async (event) => { const file = event.target.files[0]; if (!file || !requireToken()) { event.target.value = ''; return; } try { const result = await api('/api/library/import', { method: 'POST', body: await file.text() }); toast(`${result.imported} jeu(x) importé(s) sans supprimer les profils existants.`); state.page = 1; await Promise.all([loadLibrary(), loadStatus()]); } catch (error) { toast(error.message, true); } finally { event.target.value = ''; } });
  $('#enrichmentToggle').addEventListener('click', async () => { if (!requireToken()) return; const pause = $('#enrichmentToggle').dataset.paused !== 'true'; try { await api(`/api/enrichment/${pause ? 'pause' : 'start'}`, { method: 'POST', body: '{}' }); await loadStatus(); toast(pause ? 'Enrichissement mis en pause.' : 'Enrichissement repris.'); } catch (error) { toast(error.message, true); } });
  showView(location.hash === '#discovery' ? 'discovery' : 'library');
  try { await Promise.all([loadLibrary(), loadStatus()]); } catch (error) { toast(error.message, true); }
}

initialize();
