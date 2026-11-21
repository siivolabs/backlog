const state = { page: 1, pages: 1, status: 'all', q: '', view: 'library', lastGamesRefresh: 0 };
const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

const statusLabels = {
  idle: 'Inactive', running: 'En cours', pausing: 'Suspension…', paused: 'Suspendue',
  completed: 'Terminée', completed_with_errors: 'Terminée avec erreurs',
  pending: 'À enrichir', processing: 'En cours', enriched: 'Enrichi', failed: 'Erreur', completed: 'Enrichi'
};

function escapeHtml(value = '') {
  return String(value).replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]);
}

function safeImageUrl(value) {
  try {
    const url = new URL(String(value));
    return ['http:', 'https:'].includes(url.protocol) ? escapeHtml(url.href) : '';
  } catch { return ''; }
}

async function api(url, options = {}) {
  const response = await fetch(url, { headers: { 'content-type': 'application/json', ...(options.headers || {}) }, ...options });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `Erreur HTTP ${response.status}`);
  return payload;
}

function formatDuration(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return '—';
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds} s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ${seconds % 60} s`;
  const hours = Math.floor(minutes / 60);
  return `${hours} h ${minutes % 60} min`;
}

function toast(message, error = false) {
  const node = $('#toast');
  node.textContent = message;
  node.classList.toggle('error', error);
  node.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { node.hidden = true; }, 4200);
}

function switchView(view) {
  state.view = view;
  $$('.view').forEach((node) => node.classList.toggle('active', node.id === `${view}-view`));
  $$('.nav-link').forEach((node) => node.classList.toggle('active', node.dataset.view === view));
  location.hash = view;
  if (view === 'discovery') loadDiscoveryGames();
}

function updateCampaign(data) {
  $('#service-state').textContent = 'Service disponible';
  $('#service-state').classList.add('online');
  $('#metric-total').textContent = data.totalGames.toLocaleString('fr-FR');
  $('#metric-enriched').textContent = data.enriched.toLocaleString('fr-FR');
  $('#metric-remaining').textContent = data.remaining.toLocaleString('fr-FR');
  $('#metric-failed').textContent = data.failed.toLocaleString('fr-FR');
  $('#progress-percent').textContent = `${data.percent.toLocaleString('fr-FR')} %`;
  $('#progress-bar').style.width = `${Math.min(100, data.percent)}%`;
  $('#campaign-badge').textContent = statusLabels[data.status] || data.status;
  $('#campaign-badge').dataset.status = data.status;
  $('#current-game').textContent = data.current_game_name || (data.status === 'completed' ? 'Bibliothèque enrichie' : 'Aucun jeu en cours');
  $('#current-step').textContent = data.current_step ? data.current_step.replaceAll('_', ' ') : '—';
  $('#average-time').textContent = formatDuration(data.averageMs);
  $('#remaining-time').textContent = formatDuration(data.estimatedRemainingMs);
  $('#start-button').hidden = !['idle', 'completed', 'completed_with_errors'].includes(data.status);
  $('#pause-button').hidden = data.status !== 'running';
  $('#resume-button').hidden = !['paused', 'pausing'].includes(data.status);
  $('#retry-button').hidden = data.failed < 1 || data.status === 'running' || data.status === 'pausing';
  const error = $('#last-error');
  error.hidden = !data.last_error;
  error.textContent = data.last_error ? `Dernière erreur : ${data.last_error}` : '';
}

async function refreshCampaign() {
  try {
    const data = await api('/api/enrichment');
    updateCampaign(data);
    if (Date.now() - state.lastGamesRefresh > 9000 || data.processing) await loadGames(false);
  } catch (error) {
    $('#service-state').textContent = 'Service indisponible';
    $('#service-state').classList.remove('online');
  }
}

function gameCard(game) {
  const status = game.enrichment_status || 'pending';
  const imageUrl = safeImageUrl(game.cover_url);
  const cover = imageUrl
    ? `<img src="${imageUrl}" alt="" loading="lazy">`
    : `<div class="cover-placeholder">${escapeHtml(game.name.slice(0, 1).toUpperCase())}</div>`;
  return `<article class="game-card" data-app-id="${game.app_id}">
    <div class="cover">${cover}<span class="game-status status-${escapeHtml(status)}">${escapeHtml(statusLabels[status] || status)}</span></div>
    <div class="game-copy"><h3>${escapeHtml(game.name)}</h3><p>${escapeHtml(game.developer || game.genres || 'Informations Steam')}</p>${game.error ? `<small class="card-error">${escapeHtml(game.error)}</small>` : ''}</div>
  </article>`;
}

async function loadGames(resetPage = false) {
  if (resetPage) state.page = 1;
  const params = new URLSearchParams({ page: state.page, pageSize: 48, status: state.status, q: state.q });
  const grid = $('#games-grid');
  if (!grid.children.length) grid.innerHTML = '<p class="loading">Chargement de la bibliothèque…</p>';
  try {
    const data = await api(`/api/library/games?${params}`);
    state.pages = data.pages;
    state.page = data.page;
    grid.innerHTML = data.items.length ? data.items.map(gameCard).join('') : '<div class="empty"><strong>Aucun jeu trouvé</strong><span>Essayez un autre filtre ou une autre recherche.</span></div>';
    $('#page-state').textContent = `Page ${data.page} sur ${data.pages} · ${data.total.toLocaleString('fr-FR')} jeu${data.total > 1 ? 'x' : ''}`;
    $('#previous-page').disabled = data.page <= 1;
    $('#next-page').disabled = data.page >= data.pages;
    state.lastGamesRefresh = Date.now();
  } catch (error) {
    grid.innerHTML = `<div class="empty error"><strong>Impossible de charger la bibliothèque</strong><span>${escapeHtml(error.message)}</span></div>`;
  }
}

async function showGame(appId) {
  try {
    const game = await api(`/api/games/${appId}`);
    const profile = game.profile;
    const section = (title, values) => Array.isArray(values) && values.length ? `<section><h3>${title}</h3><ul>${values.map((value) => `<li>${escapeHtml(value)}</li>`).join('')}</ul></section>` : '';
    $('#game-details').innerHTML = `<div class="detail-head"><p class="eyebrow">Steam AppID ${game.app_id}</p><h2>${escapeHtml(game.name)}</h2><p>${escapeHtml(game.developer || game.genres || '')}</p><span class="game-status status-${profile ? 'enriched' : (game.job_status || 'pending')}">${escapeHtml(statusLabels[profile ? 'enriched' : (game.job_status || 'pending')] || '')}</span></div>
      ${profile ? `<div class="profile-summary"><h3>Expérience générale</h3><p>${escapeHtml(profile.summary || '')}</p></div>
      <div class="profile-grid">${section('Actions du joueur', profile.player_actions)}${section('Intentions expérientielles', profile.experiential_intentions)}${section('Traits distinctifs', profile.distinctive_traits)}${section('Incertitudes', profile.uncertainties)}</div>
      <p class="metadata">Pipeline ${escapeHtml(game.pipeline_version)} · ${escapeHtml(game.model)} · ${escapeHtml(game.embedding_model)}</p>` : `<div class="empty"><strong>Profil non disponible</strong><span>${escapeHtml(game.error || 'Ce jeu sera traité par la campagne globale.')}</span></div>`}`;
    $('#game-dialog').showModal();
  } catch (error) { toast(error.message, true); }
}

async function campaignAction(action) {
  try {
    const data = await api(`/api/enrichment/${action}`, { method: 'POST', body: '{}' });
    updateCampaign(data);
    toast(action === 'pause' ? 'Suspension demandée après le jeu en cours.' : 'Campagne mise à jour.');
  } catch (error) { toast(error.message, true); }
}

async function loadDiscoveryGames() {
  const select = $('#reference-game');
  const selected = select.value;
  try {
    const data = await api('/api/discovery/games?limit=250');
    select.innerHTML = '<option value="">Aucun — partir uniquement de mon envie</option>' + data.items.map((game) => `<option value="${game.app_id}">${escapeHtml(game.name)}</option>`).join('');
    if ([...select.options].some((option) => option.value === selected)) select.value = selected;
  } catch (error) { toast(error.message, true); }
}

async function discover() {
  const motivation = $('#motivation').value.trim();
  const referenceAppId = $('#reference-game').value || null;
  const button = $('#discover-button');
  const notice = $('#discovery-status');
  button.disabled = true;
  button.textContent = 'Recherche en cours…';
  notice.hidden = false;
  notice.textContent = 'Backlog confronte votre envie aux profils disponibles.';
  $('#recommendations').innerHTML = '';
  try {
    const data = await api('/api/discovery/recommend', { method: 'POST', body: JSON.stringify({ motivation, referenceAppId }) });
    notice.textContent = data.recommendations.length ? `${data.recommendations.length} résonance${data.recommendations.length > 1 ? 's' : ''} retenue${data.recommendations.length > 1 ? 's' : ''}.` : 'Aucune résonance suffisamment convaincante pour cette envie.';
    $('#recommendations').innerHTML = data.recommendations.map((item) => `<article class="recommendation" data-app-id="${item.app_id}">
      <div class="rec-score">${Math.round(item.score * 100)}<span>%</span></div><div><p class="eyebrow">Résonance expérientielle</p><h2>${escapeHtml(item.name)}</h2><p>${escapeHtml(item.explanation)}</p>
      ${item.matching_motivations?.length ? `<div class="chips">${item.matching_motivations.map((value) => `<span>${escapeHtml(value)}</span>`).join('')}</div>` : ''}
      ${item.caveats?.length ? `<p class="caveat">Réserves : ${escapeHtml(item.caveats.join(' · '))}</p>` : ''}
      <div class="feedback"><button data-verdict="positive">Pertinent</button><button data-verdict="negative">Peu pertinent</button><button class="open-game">Voir le profil</button></div></div></article>`).join('');
  } catch (error) {
    notice.textContent = error.message;
    notice.classList.add('error');
  } finally {
    button.disabled = false;
    button.textContent = 'Chercher des résonances';
  }
}

async function saveFeedback(appId, verdict, button) {
  try {
    await api('/api/discovery/feedback', { method: 'POST', body: JSON.stringify({ appId, verdict, motivation: $('#motivation').value.trim() }) });
    button.closest('.feedback').querySelectorAll('[data-verdict]').forEach((node) => node.classList.remove('selected'));
    button.classList.add('selected');
    toast('Retour mémorisé pour les prochaines recherches.');
  } catch (error) { toast(error.message, true); }
}

$$('.nav-link').forEach((button) => button.addEventListener('click', () => switchView(button.dataset.view)));
$$('.filter').forEach((button) => button.addEventListener('click', () => {
  $$('.filter').forEach((node) => node.classList.remove('active')); button.classList.add('active'); state.status = button.dataset.status; loadGames(true);
}));
let searchTimer;
$('#search-input').addEventListener('input', (event) => { clearTimeout(searchTimer); searchTimer = setTimeout(() => { state.q = event.target.value.trim(); loadGames(true); }, 280); });
$('#previous-page').addEventListener('click', () => { state.page -= 1; loadGames(); scrollTo({ top: 540, behavior: 'smooth' }); });
$('#next-page').addEventListener('click', () => { state.page += 1; loadGames(); scrollTo({ top: 540, behavior: 'smooth' }); });
$('#games-grid').addEventListener('click', (event) => { const card = event.target.closest('.game-card'); if (card) showGame(card.dataset.appId); });
$('#game-dialog .dialog-close').addEventListener('click', () => $('#game-dialog').close());
$('#start-button').addEventListener('click', () => campaignAction('start'));
$('#pause-button').addEventListener('click', () => campaignAction('pause'));
$('#resume-button').addEventListener('click', () => campaignAction('resume'));
$('#retry-button').addEventListener('click', () => campaignAction('retry-failures'));
$('#discover-button').addEventListener('click', discover);
$('#recommendations').addEventListener('click', (event) => {
  const card = event.target.closest('.recommendation'); if (!card) return;
  if (event.target.matches('[data-verdict]')) saveFeedback(card.dataset.appId, event.target.dataset.verdict, event.target);
  if (event.target.matches('.open-game')) showGame(card.dataset.appId);
});

switchView((location.hash || '#library').slice(1) === 'discovery' ? 'discovery' : 'library');
loadGames();
refreshCampaign();
setInterval(refreshCampaign, 3000);
