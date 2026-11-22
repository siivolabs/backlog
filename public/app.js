import { createReferenceSearch } from './reference-search.js';

const state = { token: sessionStorage.getItem('backlogAdminToken') || '', page: 1, pages: 1, search: '', status: 'all', campaign: null, reference: '' };
const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

function escapeHtml(value) { return String(value ?? '').replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char])); }
function toast(message, error = false) { const el = $('#toast'); el.textContent = message; el.className = error ? 'show error' : 'show'; clearTimeout(toast.timer); toast.timer = setTimeout(() => { el.className = ''; }, 3600); }
async function api(path, options = {}) {
  const headers = { ...(options.body ? { 'content-type': 'application/json' } : {}), ...(state.token ? { 'x-admin-token': state.token } : {}), ...options.headers };
  const response = await fetch(path, { ...options, headers });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) { if (response.status === 401 || response.status === 503) openToken(data.error); throw new Error(data.error || `Erreur ${response.status}`); }
  return data;
}
function openToken(message = '') { $('#tokenError').textContent = message; $('#tokenInput').value = state.token; if (!$('#tokenDialog').open) $('#tokenDialog').showModal(); }

async function loadConfig() { const config = await api('/api/config'); $('#version').textContent = `V${config.version}`; if (!state.token) openToken(config.admin_token_configured ? '' : 'ADMIN_TOKEN doit être configuré côté serveur.'); }
async function verifyToken(token) { const previous = state.token; state.token = token; try { await api('/api/admin/verify', { method: 'POST' }); sessionStorage.setItem('backlogAdminToken', token); $('#adminButton').classList.add('valid'); $('#tokenDialog').close(); toast('Jeton administrateur validé.'); } catch (error) { state.token = previous; $('#tokenError').textContent = error.message; } }

function campaignLabel(status) { return ({ idle: 'Inactif', running: 'En cours', pausing: 'Suspension…', paused: 'Suspendu', completed: 'Terminé', completed_with_errors: 'Terminé avec erreurs' })[status] || status; }
function renderStatus(data) {
  state.campaign = data; const status = data.campaign.status; const badge = $('#campaignBadge'); badge.textContent = campaignLabel(status); badge.className = `badge ${status === 'running' || status === 'pausing' ? 'running' : status === 'completed' ? 'completed' : status === 'completed_with_errors' ? 'failed' : 'idle'}`;
  $('#gamesCount').textContent = data.library.games.toLocaleString('fr-FR'); $('#enrichedCount').textContent = data.library.enriched.toLocaleString('fr-FR'); $('#processingCount').textContent = data.queue.processing; $('#failedCount').textContent = data.queue.failed; $('#remainingCount').textContent = data.library.remaining.toLocaleString('fr-FR');
  const percent = data.queue.progress_percent; $('#progressBar').style.width = `${percent}%`; $('#progressText').textContent = `${String(percent).replace('.', ',')} %`;
  const current = data.campaign.current_app_id ? `AppID ${data.campaign.current_app_id} · ${data.campaign.current_step || 'traitement'}` : campaignLabel(status); $('#currentStep').textContent = current;
  const action = $('#campaignAction'); action.disabled = status === 'pausing'; action.dataset.action = status === 'running' || status === 'pausing' ? 'pause' : status === 'paused' ? 'resume' : 'start'; action.textContent = status === 'running' ? 'Suspendre après ce jeu' : status === 'pausing' ? 'Suspension demandée…' : status === 'paused' ? 'Reprendre l’enrichissement' : status === 'completed' ? 'Vérifier les nouveaux jeux' : 'Lancer l’enrichissement';
  $('#retryButton').classList.toggle('hidden', !data.queue.failed);
}
async function loadStatus() { try { renderStatus(await api('/api/enrichment/status')); } catch (error) { toast(error.message, true); } }

function statusBadge(game) { if (game.enriched) return ['Enrichi', 'enriched']; if (game.enrichment_status === 'failed') return ['Erreur', 'failed']; if (game.enrichment_status === 'processing') return ['En cours', 'processing']; return ['À enrichir', 'pending']; }
function gameCard(game) { const [label, status] = statusBadge(game); const cover = game.cover_url || ''; return `<article class="game-card"><div class="cover"><img src="${escapeHtml(cover)}" alt="Couverture de ${escapeHtml(game.title)}" loading="lazy"><span class="card-status ${status}">${label}</span></div><div class="card-body"><h3 title="${escapeHtml(game.title)}">${escapeHtml(game.title)}</h3><p>${escapeHtml(game.studio || game.genres || `AppID ${game.app_id}`)}</p></div></article>`; }
async function loadLibrary() { const query = new URLSearchParams({ page: state.page, pageSize: 48, search: state.search, status: state.status }); const data = await api(`/api/library?${query}`); state.pages = data.pages; $('#gameGrid').innerHTML = data.items.length ? data.items.map(gameCard).join('') : '<p class="empty">Aucun jeu pour ce filtre.</p>'; [...$('#gameGrid').querySelectorAll('.game-card')].forEach((card, index) => { const game = data.items[index]; if (!game) return; card.dataset.profileAppId = String(game.app_id); card.dataset.enriched = game.enriched ? 'true' : 'false'; if (game.enriched) { card.classList.add('has-profile'); card.tabIndex = 0; card.setAttribute('aria-label', `Ouvrir le profil enrichi de ${game.title}`); } }); $('#resultCount').textContent = `${data.total.toLocaleString('fr-FR')} jeu${data.total > 1 ? 'x' : ''}`; $('#pageText').textContent = `Page ${data.page} / ${data.pages}`; $('#previousPage').disabled = data.page <= 1; $('#nextPage').disabled = data.page >= data.pages; }
async function loadErrors() { const data = await api('/api/enrichment/errors'); $('#errorsBody').innerHTML = data.items.length ? data.items.map((item) => `<tr><td>${escapeHtml(item.title || item.app_id)}</td><td>${item.attempts}</td><td class="error-message">${escapeHtml(item.error)}</td><td>${escapeHtml(item.finished_at || '—')}</td></tr>`).join('') : '<tr><td colspan="4" class="empty">Aucune erreur signalée.</td></tr>'; }
async function campaignAction(action) { if (!state.token) return openToken(); try { await api(`/api/enrichment/${action}`, { method: 'POST' }); await Promise.all([loadStatus(), loadLibrary(), loadErrors()]); toast(action === 'pause' ? 'La campagne se suspendra après le jeu en cours.' : 'Campagne mise à jour.'); } catch (error) { toast(error.message, true); } }
async function importInventory(file) { if (!file) return; if (!state.token) { openToken('Validez le jeton avant l’import.'); return; } try { const payload = JSON.parse(await file.text()); const result = await api('/api/library/import', { method: 'POST', body: JSON.stringify(payload) }); state.page = 1; await Promise.all([loadLibrary(), loadStatus()]); toast(`${result.imported} jeu(x) importé(s) sans supprimer les profils existants.`); } catch (error) { toast(`Import impossible : ${error.message}`, true); } finally { $('#inventoryFile').value = ''; } }

// BACKLOG_V1_1_4: sélecteur Résonances indépendant et fiche de profil en lecture seule.
let referenceSearchTimer;

function setReferenceOptions(games) {
  $('#referenceSuggestions').innerHTML = games.map((game) => `<option value="${escapeHtml(game.app_id)}">${escapeHtml(game.title)} (${escapeHtml(game.app_id)})</option>`).join('');
}
const referenceSearch = createReferenceSearch({ onResults: setReferenceOptions });
function parseProfileValue(value) {
  if (typeof value !== 'string') return value;
  const text = value.trim();
  if (!text || (!text.startsWith('{') && !text.startsWith('['))) return value;
  try { return JSON.parse(text); } catch { return value; }
}
function profileNode(value) {
  const parsed = parseProfileValue(value);
  if (parsed === null || parsed === undefined || parsed === '') return '<span class="profile-empty">Non renseigné</span>';
  if (Array.isArray(parsed)) return parsed.length ? `<ul>${parsed.map((item) => `<li>${profileNode(item)}</li>`).join('')}</ul>` : '<span class="profile-empty">Liste vide</span>';
  if (typeof parsed === 'object') return `<dl>${Object.entries(parsed).map(([key, item]) => `<div><dt>${escapeHtml(key.replaceAll('_', ' '))}</dt><dd>${profileNode(item)}</dd></div>`).join('')}</dl>`;
  return `<span>${escapeHtml(String(parsed))}</span>`;
}
async function openProfile(appId) {
  const dialog = $('#profileDialog');
  $('#profileTitle').textContent = 'Chargement…';
  $('#profileContent').innerHTML = '<p>Chargement du profil enrichi…</p>';
  dialog.showModal();
  try {
    const data = await api(`/api/library/profile?appId=${encodeURIComponent(appId)}`);
    $('#profileTitle').textContent = data.game.title || `Jeu ${appId}`;
    const visible = Object.entries(data.profile).filter(([key]) => key !== 'app_id');
    $('#profileContent').innerHTML = visible.map(([key, value]) => `<section class="profile-section"><h3>${escapeHtml(key.replaceAll('_', ' '))}</h3>${profileNode(value)}</section>`).join('') || '<p class="empty">Le profil ne contient aucun champ affichable.</p>';
  } catch (error) {
    $('#profileContent').innerHTML = `<p class="empty">${escapeHtml(error.message)}</p>`;
  }
}

function discoveryCard(game) { return `<article class="game-card discovery-card"><div class="cover"><img src="${escapeHtml(game.cover_url || '')}" alt="Couverture de ${escapeHtml(game.title)}" loading="lazy"></div><div class="card-body"><h3>${escapeHtml(game.title)}</h3><p>${escapeHtml(game.summary || game.genres || '')}</p><p class="score">Résonance ${Math.round(game.score * 100)} %</p><div class="feedback-row"><button data-verdict="positive" data-id="${escapeHtml(game.app_id)}">Pertinent</button><button data-verdict="negative" data-id="${escapeHtml(game.app_id)}">Écarter</button></div></div></article>`; }
async function runDiscovery() {
  const typedReference = $('#referenceInput').value.trim();
  const motivation = $('#motivationInput').value.trim();
  $('#discoverButton').disabled = true;
  try {
    const selected = typedReference ? await referenceSearch.resolve(typedReference) : null;
    if (typedReference && !selected) throw new Error('Sélectionnez un jeu proposé ou saisissez un Steam AppID exact.');
    const reference = selected ? String(selected.app_id) : '';
    state.reference = reference || '__motivation__';
    const data = await api('/api/discovery', { method: 'POST', body: JSON.stringify({ reference_app_id: reference, motivation_text: motivation }) });
    $('#discoveryResults').innerHTML = data.items.length ? data.items.map(discoveryCard).join('') : '<p class="empty">Aucune résonance disponible.</p>';
  } catch (error) { toast(error.message, true); }
  finally { $('#discoverButton').disabled = false; }
}
async function feedback(button) { if (!state.token) return openToken(); try { await api('/api/discovery/feedback', { method: 'POST', body: JSON.stringify({ reference_app_id: state.reference, candidate_app_id: button.dataset.id, motivation_key: $('#motivationInput').value.trim(), verdict: button.dataset.verdict }) }); toast('Correction enregistrée.'); button.disabled = true; } catch (error) { toast(error.message, true); } }

function bind() {
  $$('.nav-button').forEach((button) => button.addEventListener('click', () => { $$('.nav-button').forEach((x) => x.classList.toggle('active', x === button)); $$('.view').forEach((view) => view.classList.remove('active')); $(`#${button.dataset.view}View`).classList.add('active'); }));
  $('#adminButton').addEventListener('click', () => openToken()); $('#tokenForm').addEventListener('submit', (event) => { event.preventDefault(); verifyToken($('#tokenInput').value); }); $('#tokenCancel').addEventListener('click', () => $('#tokenDialog').close());
  $('#importButton').addEventListener('click', () => { if (!state.token) return openToken('Validez le jeton avant l’import.'); $('#inventoryFile').click(); }); $('#inventoryFile').addEventListener('change', (event) => importInventory(event.target.files?.[0]));
  $('#campaignAction').addEventListener('click', () => campaignAction($('#campaignAction').dataset.action || 'start')); $('#retryButton').addEventListener('click', () => campaignAction('retry-failed')); $('#refreshErrors').addEventListener('click', loadErrors);
  let timer; $('#searchInput').addEventListener('input', (event) => { clearTimeout(timer); timer = setTimeout(() => { state.search = event.target.value; state.page = 1; loadLibrary(); }, 250); });
  $$('.filter').forEach((button) => button.addEventListener('click', () => { $$('.filter').forEach((x) => x.classList.toggle('active', x === button)); state.status = button.dataset.status; state.page = 1; loadLibrary(); }));
  $('#previousPage').addEventListener('click', () => { state.page -= 1; loadLibrary(); }); $('#nextPage').addEventListener('click', () => { state.page += 1; loadLibrary(); }); $('#referenceInput').addEventListener('input', (event) => { clearTimeout(referenceSearchTimer); referenceSearchTimer = setTimeout(() => referenceSearch.search(event.target.value).catch((error) => toast(error.message, true)), 250); }); $('#referenceInput').addEventListener('change', (event) => { const game = referenceSearch.find(event.target.value); if (game) event.target.value = String(game.app_id); }); $('#gameGrid').addEventListener('click', (event) => { if (event.target.closest('a,button,input,select,textarea')) return; const card = event.target.closest('[data-profile-app-id][data-enriched="true"]'); if (card) openProfile(card.dataset.profileAppId); }); $('#gameGrid').addEventListener('keydown', (event) => { if ((event.key === 'Enter' || event.key === ' ') && event.target.matches('[data-profile-app-id][data-enriched="true"]')) { event.preventDefault(); openProfile(event.target.dataset.profileAppId); } }); $('#discoverButton').addEventListener('click', runDiscovery); $('#discoveryResults').addEventListener('click', (event) => { const button = event.target.closest('[data-verdict]'); if (button) feedback(button); });
}

bind();
Promise.all([loadConfig(), loadStatus(), loadLibrary(), loadErrors()]).catch((error) => toast(error.message, true));
setInterval(() => { loadStatus(); if (state.campaign?.campaign?.status === 'running' || state.campaign?.campaign?.status === 'pausing') { loadLibrary(); loadErrors(); } }, 3000);
