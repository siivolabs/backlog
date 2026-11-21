const state = { offset: 0, limit: 48, total: 0, status: null, games: [], motivation: '', reference: '' };
const $ = (selector) => document.querySelector(selector);
const escapeHtml = (value) => String(value ?? '').replace(/[&<>'"]/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;' }[c]));
const formatNumber = (value) => new Intl.NumberFormat('fr-FR').format(Number(value || 0));
const formatDuration = (ms) => { if (!ms) return 'estimation indisponible'; const minutes = Math.ceil(ms / 60000); return minutes < 60 ? `environ ${minutes} min restantes` : `environ ${Math.floor(minutes / 60)} h ${minutes % 60} min restantes`; };

async function api(path, options = {}) {
  const response = await fetch(path, { headers: { 'content-type': 'application/json', ...(options.headers || {}) }, ...options });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `Erreur HTTP ${response.status}`);
  return payload;
}
function toast(message, error = false) { const node = $('#toast'); node.textContent = message; node.className = `toast show${error ? ' error' : ''}`; setTimeout(() => node.className = 'toast', 3400); }

function renderStatus(data) {
  state.status = data;
  for (const key of ['total','completed','running','errors','remaining']) $(`#m-${key}`).textContent = formatNumber(data[key]);
  $('#progress-label').textContent = `${data.progress_percent} %`;
  $('#progress-bar').style.width = `${data.progress_percent}%`;
  const labels = { idle:'En attente',running:'En cours',pausing:'Suspension…',paused:'Suspendu',completed:'Terminé',completed_with_errors:'Terminé avec erreurs' };
  $('#campaign-state').textContent = labels[data.lifecycle] || data.lifecycle;
  $('#current-game').textContent = data.current_app_id ? `App ${data.current_app_id} · ${data.current_step || 'préparation'}` : 'Aucun traitement actif';
  $('#campaign-detail').textContent = data.lifecycle === 'running' ? formatDuration(data.estimated_remaining_ms) : data.last_error || 'La campagne peut être reprise sans perdre les profils terminés.';
  $('#start').disabled = data.desired_state === 'running'; $('#pause').disabled = data.desired_state !== 'running'; $('#retry').disabled = !Number(data.errors);
}

async function loadStatus() {
  try { renderStatus(await api('/api/status')); $('#connection').textContent = 'Serveur disponible'; $('#connection').className = 'connection ok'; }
  catch (error) { $('#connection').textContent = 'Serveur indisponible'; $('#connection').className = 'connection error'; }
}

function placeholder(title) { const hue = [...String(title)].reduce((n,c)=>n+c.charCodeAt(0),0)%360; return `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="184" height="276"><rect width="100%" height="100%" fill="hsl(${hue} 25% 18%)"/><text x="50%" y="50%" fill="#aab" text-anchor="middle" font-family="sans-serif" font-size="18">${escapeHtml(String(title).slice(0,1))}</text></svg>`)}`; }
function renderGames(data) {
  state.total = Number(data.total); state.games = data.items;
  $('#result-count').textContent = `${formatNumber(data.total)} jeu${data.total > 1 ? 'x' : ''}`;
  const labels = { completed:'Enrichi',pending:'À enrichir',running:'En cours',error:'Erreur' };
  $('#game-grid').innerHTML = data.items.length ? data.items.map((game) => `<article class="game" data-app-id="${escapeHtml(game.app_id)}" tabindex="0"><img class="cover" loading="lazy" src="${escapeHtml(game.cover_url || placeholder(game.title))}" alt=""><div><span class="game-status ${game.enrichment_status}">${labels[game.enrichment_status]}</span><h3>${escapeHtml(game.title)}</h3><p>${escapeHtml(game.studio || 'Studio inconnu')}</p>${game.current_step ? `<p>${escapeHtml(game.current_step)}</p>` : ''}${game.last_error ? `<p class="error-text">${escapeHtml(game.last_error)}</p>` : ''}</div></article>`).join('') : '<p class="empty">Aucun jeu ne correspond à ce filtre.</p>';
  const page = Math.floor(state.offset / state.limit) + 1, pages = Math.max(1, Math.ceil(state.total / state.limit));
  $('#page-label').textContent = `Page ${page} / ${pages}`; $('#previous').disabled = !state.offset; $('#next').disabled = state.offset + state.limit >= state.total;
  document.querySelectorAll('.game').forEach((node) => { node.addEventListener('click', () => showProfile(node.dataset.appId)); node.addEventListener('keydown', (event) => { if (event.key === 'Enter') showProfile(node.dataset.appId); }); });
}
async function loadGames() {
  const params = new URLSearchParams({ limit: state.limit, offset: state.offset, q: $('#search').value, status: $('#status-filter').value });
  try { renderGames(await api(`/api/games?${params}`)); } catch (error) { toast(error.message, true); }
}

async function showProfile(appId) {
  try {
    const game = await api(`/api/games/${encodeURIComponent(appId)}`); const profile = game.profile;
    $('#profile-content').innerHTML = `<p class="eyebrow">APP ${escapeHtml(game.app_id)}</p><h2>${escapeHtml(game.title)}</h2><p class="profile-meta">${escapeHtml(game.studio || 'Studio inconnu')} · ${formatNumber(game.playtime_minutes)} min jouées</p>${profile ? `<div class="profile-json">${Object.entries(profile).map(([key,value]) => `<div class="profile-field"><strong>${escapeHtml(key.replaceAll('_',' '))}</strong><p>${escapeHtml(Array.isArray(value) ? value.join(' · ') : value)}</p></div>`).join('')}</div>` : '<div class="notice">Ce jeu n’est pas encore enrichi.</div>'}`;
    $('#profile-dialog').showModal();
  } catch (error) { toast(error.message, true); }
}

async function control(action) {
  try { renderStatus(await api(`/api/enrichment/${action}`, { method:'POST', body:'{}' })); await loadGames(); toast(action === 'pause' ? 'Suspension demandée après le jeu courant.' : 'Commande enregistrée côté serveur.'); }
  catch (error) { toast(error.message, true); }
}

async function loadReferences() {
  try { const data = await api('/api/games?status=completed&limit=500'); $('#reference-game').innerHTML = '<option value="">Choisir un jeu enrichi…</option>' + data.items.map((g) => `<option value="${escapeHtml(g.app_id)}">${escapeHtml(g.title)}</option>`).join(''); }
  catch (error) { toast(error.message, true); }
}
function renderDiscovery(data) {
  state.reference = data.reference.app_id; state.motivation = $('#motivation').value;
  $('#discovery-results').innerHTML = data.results.length ? data.results.map((item) => `<article class="result"><img class="result-cover" src="${escapeHtml(item.cover_url || placeholder(item.title))}" alt=""><div class="result-body"><div class="score">${Math.round(item.score * 100)} %</div><h3>${escapeHtml(item.title)}</h3><p>${escapeHtml(item.studio || '')}</p><p>${escapeHtml(item.explanation)}</p><div class="feedback"><button class="ghost feedback-btn" data-id="${escapeHtml(item.app_id)}" data-verdict="positive">Pertinent</button><button class="ghost feedback-btn" data-id="${escapeHtml(item.app_id)}" data-verdict="negative">Peu pertinent</button></div></div></article>`).join('') : '<p class="empty">Pas encore assez de profils comparables.</p>';
  document.querySelectorAll('.feedback-btn').forEach((button) => button.addEventListener('click', () => saveFeedback(button)));
}
async function saveFeedback(button) {
  try { await api('/api/discovery/feedback', { method:'POST', body:JSON.stringify({ reference_app_id:state.reference, candidate_app_id:button.dataset.id, motivation_text:state.motivation, verdict:button.dataset.verdict }) }); button.textContent = 'Enregistré'; toast('Correction mémorisée.'); }
  catch (error) { toast(error.message, true); }
}

let searchTimer;
$('#search').addEventListener('input', () => { clearTimeout(searchTimer); searchTimer = setTimeout(() => { state.offset=0; loadGames(); }, 250); });
$('#status-filter').addEventListener('change', () => { state.offset=0; loadGames(); });
$('#previous').addEventListener('click', () => { state.offset=Math.max(0,state.offset-state.limit); loadGames(); });
$('#next').addEventListener('click', () => { state.offset+=state.limit; loadGames(); });
$('#start').addEventListener('click', () => control('start')); $('#pause').addEventListener('click', () => control('pause')); $('#retry').addEventListener('click', () => control('retry-errors'));
$('#close-dialog').addEventListener('click', () => $('#profile-dialog').close());
document.querySelectorAll('.nav-link').forEach((button) => button.addEventListener('click', async () => { document.querySelectorAll('.nav-link,.view').forEach((node) => node.classList.remove('active')); button.classList.add('active'); $(`#view-${button.dataset.view}`).classList.add('active'); if (button.dataset.view === 'discovery') await loadReferences(); }));
$('#discovery-form').addEventListener('submit', async (event) => { event.preventDefault(); const message=$('#discovery-message'); message.classList.remove('hidden'); message.textContent='Calcul des résonances…'; try { const data=await api('/api/discovery',{method:'POST',body:JSON.stringify({reference_app_id:$('#reference-game').value,motivation_text:$('#motivation').value,limit:12})}); renderDiscovery(data); message.classList.add('hidden'); } catch(error){ message.textContent=error.message; toast(error.message,true); } });

await Promise.all([loadStatus(),loadGames()]);
setInterval(async () => { const previous=state.status?.completed; await loadStatus(); if (state.status?.completed !== previous || state.status?.running) await loadGames(); }, 3000);
