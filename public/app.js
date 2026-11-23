const $ = (selector) => document.querySelector(selector);
const state = { token: sessionStorage.getItem('adminToken') || '', capabilities: {}, searchTimer: null };
async function api(url, options = {}) {
  const headers = { ...(options.body ? { 'content-type': 'application/json' } : {}), ...(state.token ? { 'x-admin-token': state.token } : {}), ...options.headers };
  const response = await fetch(url, { ...options, headers });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Erreur HTTP ${response.status}`);
  return data;
}
function escapeHtml(value) { return String(value ?? '').replace(/[&<>'"]/g, (char) => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[char])); }
function toast(message, error = false) { const node = $('#toast'); node.textContent = message; node.className = error ? 'show error' : 'show'; clearTimeout(toast.timer); toast.timer = setTimeout(() => { node.className = ''; }, 3600); }
function renderValue(value) {
  if (value == null || value === '') return '<span class="muted">Non renseigné</span>';
  if (Array.isArray(value)) {
    if (value.length > 64 && value.every((item) => typeof item === 'number')) return `<details><summary>${value.length} valeurs — afficher l'embedding</summary><p class="embedding">${value.map(escapeHtml).join(', ')}</p></details>`;
    return `<ul class="value-list">${value.map((item) => `<li>${renderValue(item)}</li>`).join('')}</ul>`;
  }
  if (typeof value === 'object') return `<dl class="data-grid">${Object.entries(value).map(([key, item]) => `<dt>${escapeHtml(key)}</dt><dd>${renderValue(item)}</dd>`).join('')}</dl>`;
  if (typeof value === 'boolean') return value ? 'Oui' : 'Non';
  return escapeHtml(value);
}
function card(game, discovery = false) {
  const score = discovery ? `<div class="meta">Résonance ${Math.round((game.similarity || 0) * 100)} % · Fiabilité ${Math.round((game.profileQuality || 0) * 100)} %</div>` : `<div class="meta">${game.profiled ? 'Profil enrichi disponible' : 'Profil absent'}${game.completed ? ' · Terminé' : ''}</div>`;
  const complete = state.capabilities.completion ? `<button class="done" data-completed="${game.completed ? 0 : 1}">${game.completed ? 'Rouvrir' : 'Terminé'}</button>` : '';
  return `<article class="card" data-appid="${escapeHtml(game.app_id)}"><div class="cover-wrap"><img class="cover" loading="lazy" src="${escapeHtml(game.cover_url || '')}" alt="Jaquette de ${escapeHtml(game.title)}"></div><div class="card-body"><h3 title="${escapeHtml(game.title)}">${escapeHtml(game.title)}</h3><p>${escapeHtml(game.description || game.summary || game.studio || 'Description indisponible.')}</p>${score}<div class="actions">${discovery ? '<button data-feedback="positive">Pertinent</button><button data-feedback="negative">Écarter</button>' : ''}${complete}<button class="details-button" data-details>${game.profiled || discovery ? 'Voir la fiche' : 'Détails'}</button></div></div></article>`;
}
function bindCards(container) {
  container.querySelectorAll('[data-completed]').forEach((button) => button.addEventListener('click', async () => { try { const article = button.closest('[data-appid]'); await api(`/api/games/${article.dataset.appid}/completed`, { method: 'PATCH', body: JSON.stringify({ completed: button.dataset.completed === '1' }) }); await loadLibrary(); } catch (error) { toast(error.message, true); } }));
  container.querySelectorAll('[data-details]').forEach((button) => button.addEventListener('click', async () => {
    const id = button.closest('[data-appid]').dataset.appid; const dialog = $('#details'); $('#detailsContent').innerHTML = '<p>Chargement de la fiche…</p>'; dialog.showModal();
    try { const game = await api(`/api/games/${id}`); $('#detailsContent').innerHTML = `<div class="detail-hero"><img src="${escapeHtml(game.cover_url || '')}" alt=""><div><p class="eyebrow">FICHE ENRICHIE</p><h2>${escapeHtml(game.title)}</h2><p>${escapeHtml(game.description || '')}</p><div class="detail-meta">AppID ${escapeHtml(game.app_id)} · confiance ${game.confidence == null ? 'non renseignée' : `${Math.round(game.confidence * 100)} %`}</div></div></div><section class="profile-section"><h3>Profil expérientiel</h3>${renderValue(game.profile)}</section><section class="profile-section"><h3>Sources</h3>${renderValue(game.sources)}</section><section class="profile-section"><h3>Modèles et embedding</h3>${renderValue({ schema_version: game.schema_version, analysis_model: game.analysis_model, embedding_model: game.embedding_model, embedding: game.embedding })}</section>`; }
    catch (error) { $('#detailsContent').innerHTML = `<p class="empty">${escapeHtml(error.message)}</p>`; }
  }));
  container.querySelectorAll('[data-feedback]').forEach((button) => button.addEventListener('click', async () => { try { const article = button.closest('[data-appid]'); await api('/api/discovery/feedback', { method: 'POST', body: JSON.stringify({ candidateAppId: article.dataset.appid, verdict: button.dataset.feedback, motivationKey: $('#motivation').value, referenceAppId: $('#reference').value }) }); article.remove(); } catch (error) { toast(error.message, true); } }));
}
async function loadLibrary() {
  const params = new URLSearchParams({ q: $('#search').value, limit: '250' });
  if (state.capabilities.completion && $('#completedFilter').value) params.set('completed', $('#completedFilter').value);
  const data = await api(`/api/library?${params}`); $('#libraryGrid').innerHTML = data.games.length ? data.games.map((game) => card(game)).join('') : '<p class="empty">Aucun jeu trouvé.</p>'; bindCards($('#libraryGrid'));
}
async function runDiscovery(surprise = false) {
  $('#discoveryMessage').textContent = 'Analyse des profils historiques…'; $('#discoveryGrid').innerHTML = '';
  try { const data = await api('/api/discovery', { method: 'POST', body: JSON.stringify({ referenceAppId: $('#reference').value.trim(), query: $('#motivation').value.trim(), motivationKey: $('#motivation').value.trim(), surprise, limit: 12 }) }); $('#discoveryMessage').textContent = data.message || `${data.results.length} proposition(s), ${data.excludedForQuality} profil(s) écarté(s).`; $('#discoveryGrid').innerHTML = data.results.map((game) => card(game, true)).join(''); bindCards($('#discoveryGrid')); } catch (error) { $('#discoveryMessage').textContent = error.message; }
}
for (const button of document.querySelectorAll('[data-view]')) button.addEventListener('click', () => { const discovery = button.dataset.view === 'discovery'; $('#libraryView').hidden = discovery; $('#discoveryView').hidden = !discovery; document.querySelectorAll('[data-view]').forEach((item) => item.classList.toggle('active', item === button)); });
$('#reload').addEventListener('click', loadLibrary); $('#search').addEventListener('input', () => { clearTimeout(state.searchTimer); state.searchTimer = setTimeout(loadLibrary, 250); }); $('#completedFilter').addEventListener('change', loadLibrary); $('#discoveryForm').addEventListener('submit', (event) => { event.preventDefault(); runDiscovery(false); }); $('#surprise').addEventListener('click', () => runDiscovery(true)); $('#adminButton').addEventListener('click', () => { const token = prompt('Jeton administrateur', state.token); if (token !== null) { state.token = token; sessionStorage.setItem('adminToken', token); } }); $('#details .close').addEventListener('click', () => $('#details').close());
(async () => { try { const health = await api('/healthz'); state.capabilities = health.capabilities || {}; $('#health').textContent = `${Number(health.games).toLocaleString('fr-FR')} jeux · ${Number(health.profiles).toLocaleString('fr-FR')} profils · base historique`; if (!state.capabilities.completion) $('#completedFilter').hidden = true; await loadLibrary(); } catch (error) { $('#health').textContent = error.message; $('#libraryGrid').innerHTML = `<p class="empty">${escapeHtml(error.message)}</p>`; } })();
