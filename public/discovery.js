'use strict';

(() => {
  const state = { selectedGame: null, interpretation: null, intentions: [], run: null, searchTimer: null, loaded: false };
  const one = (selector, root = document) => root.querySelector(selector);
  const all = (selector, root = document) => [...root.querySelectorAll(selector)];
  const escapeHtml = (value) => String(value ?? '').replace(/[&<>'"]/g, (character) => ({ '&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#039;','"':'&quot;' }[character]));
  const adminToken = () => sessionStorage.getItem('backlogAdminToken') || '';
  async function request(url, options = {}) {
    const headers = { 'content-type':'application/json', ...(options.headers || {}) }; if (options.admin && adminToken()) headers['x-admin-token'] = adminToken();
    const response = await fetch(url, { ...options, headers, body: options.body && typeof options.body !== 'string' ? JSON.stringify(options.body) : options.body });
    const payload = await response.json().catch(() => ({})); if (!response.ok) throw new Error([payload.error, payload.detail].filter(Boolean).join(' — ') || `HTTP ${response.status}`); return payload;
  }
  function toast(message, type = '') { const node = one('#toast'); if (!node) return; node.textContent = message; node.className = `toast-visible ${type}`; clearTimeout(node.timer); node.timer = setTimeout(() => { node.className = ''; node.textContent = ''; }, 5200); }
  function busy(button, active, label = 'Traitement…') { if (!button) return; if (active) { button.dataset.label = button.textContent; button.textContent = label; } else button.textContent = button.dataset.label || button.textContent; button.disabled = active; }
  function duration(ms) { const seconds = Math.max(0, Math.round(Number(ms || 0) / 1000)); return seconds < 60 ? `${seconds} s` : `${Math.floor(seconds / 60)} min ${seconds % 60} s`; }
  function updateSteps(step) { all('.discovery-steps li').forEach((item, index) => item.classList.toggle('active', index + 1 === step)); }
  async function loadDashboard() {
    try {
      const dashboard = await request('/api/v09/discovery/dashboard'); const node = one('#discoveryMetrics'); if (!node) return;
      node.innerHTML = `<span><b>${dashboard.counts.active_intentions || 0}</b> intentions</span><span><b>${dashboard.counts.completed_runs || 0}</b> découvertes</span><span><b>${dashboard.counts.feedback || 0}</b> retours</span>`;
    } catch { /* Discovery remains usable even if metrics are temporarily unavailable. */ }
  }
  async function searchGames() {
    const input = one('#discoveryGameSearch'); const results = one('#discoveryGameResults'); const query = input.value.trim();
    if (!query) { results.hidden = true; results.innerHTML = ''; return; }
    try {
      const payload = await request(`/api/v09/discovery/games?query=${encodeURIComponent(query)}&limit=12`); results.hidden = false;
      results.innerHTML = payload.items.length ? payload.items.map((game) => `<button type="button" class="discovery-game-option" data-app-id="${escapeHtml(game.appId)}"><img src="${escapeHtml(game.coverUrl)}" alt="" loading="lazy"><span><b>${escapeHtml(game.displayName || game.name)}</b><small>AppID ${escapeHtml(game.appId)} · ${Math.round(Number(game.playtimeMinutes || 0) / 60)} h</small></span></button>`).join('') : '<div class="empty">Aucun jeu trouvé.</div>';
      all('.discovery-game-option', results).forEach((button) => button.addEventListener('click', () => selectGame(payload.items.find((game) => game.appId === button.dataset.appId))));
    } catch (error) { toast(error.message, 'error'); }
  }
  function selectGame(game) {
    state.selectedGame = game; state.interpretation = null; state.run = null;
    one('#discoverySelectedGame').innerHTML = `<img src="${escapeHtml(game.coverUrl)}" alt=""><div><span class="eyebrow">JEU DE RÉFÉRENCE</span><h4>${escapeHtml(game.displayName || game.name)}</h4><p class="muted">AppID ${escapeHtml(game.appId)} · ${(game.genres || []).map(escapeHtml).join(', ') || 'genres non renseignés'}</p></div>`;
    one('#discoveryGameResults').hidden = true; one('#discoveryGameSearch').value = game.displayName || game.name; one('#discoveryInterpretBtn').disabled = one('#discoveryReason').value.trim().length < 20;
    one('#discoveryStageThree').hidden = true; updateRunButton(); updateSteps(1);
  }
  async function interpret() {
    const button = one('#discoveryInterpretBtn'); if (!state.selectedGame) return;
    busy(button, true, 'Interprétation ciblée…');
    try {
      const payload = await request('/api/v09/discovery/interpret', { method:'POST', admin:true, body:{ appId:state.selectedGame.appId, sourceText:one('#discoveryReason').value } });
      state.interpretation = payload.interpretation; renderInterpretation(); updateSteps(1); toast('Interprétation prête : confirmez ou corrigez chaque motivation.');
    } catch (error) { toast(error.message, 'error'); } finally { busy(button, false); button.disabled = !state.selectedGame || one('#discoveryReason').value.trim().length < 20; }
  }
  function renderInterpretation() {
    const node = one('#discoveryInterpretation'); const motivations = state.interpretation?.motivations || []; node.hidden = false;
    node.innerHTML = `<div class="discovery-interpret-head"><div><span class="eyebrow">INTERPRÉTATION À VÉRIFIER</span><h3>Est-ce bien ce que vous vouliez dire ?</h3><p>Modifiez les formulations, retirez une hypothèse incorrecte, puis confirmez. Rien ne devient durable avant cette étape.</p></div></div><div class="discovery-motivation-editor">${motivations.map((item, index) => motivationEditor(item, index)).join('')}</div><div class="button-row"><button id="discoveryAddMotivation" class="button secondary" type="button">Ajouter une motivation</button><button id="discoveryConfirmBtn" class="button" type="button">Confirmer ces motivations</button></div>`;
    all('.remove-motivation', node).forEach((button) => button.addEventListener('click', () => button.closest('.discovery-motivation-edit').remove()));
    one('#discoveryAddMotivation').addEventListener('click', () => { const wrapper = one('.discovery-motivation-editor'); wrapper.insertAdjacentHTML('beforeend', motivationEditor({ label:'',description:'',mechanism_agnostic_reason:'',evidence_from_player:'',confidence:0.5,uncertainty:'' }, wrapper.children.length)); const card = wrapper.lastElementChild; one('.remove-motivation', card).addEventListener('click', () => card.remove()); });
    one('#discoveryConfirmBtn').addEventListener('click', confirmInterpretation);
  }
  function motivationEditor(item, index) {
    return `<article class="discovery-motivation-edit" data-index="${index}"><div class="discovery-edit-head"><label>Intention<input class="motivation-label" maxlength="120" value="${escapeHtml(item.label)}"></label><button type="button" class="link-button remove-motivation">Retirer</button></div><label>Description<textarea class="motivation-description" rows="2" maxlength="700">${escapeHtml(item.description)}</textarea></label><label>Pourquoi cette intention dépasse le mécanisme du jeu<textarea class="motivation-reason" rows="2" maxlength="700">${escapeHtml(item.mechanism_agnostic_reason)}</textarea></label><details><summary>Preuve et incertitude de l’interprétation</summary><label>Élément exprimé par le joueur<textarea class="motivation-evidence" rows="2" maxlength="700">${escapeHtml(item.evidence_from_player)}</textarea></label><label>Incertitude<textarea class="motivation-uncertainty" rows="2" maxlength="500">${escapeHtml(item.uncertainty)}</textarea></label><label>Confiance <input class="motivation-confidence" type="range" min="0" max="1" step="0.05" value="${Number(item.confidence || 0.5)}"></label></details></article>`;
  }
  function collectMotivations() {
    return all('.discovery-motivation-edit', one('#discoveryInterpretation')).map((card) => ({ label:one('.motivation-label', card).value, description:one('.motivation-description', card).value, mechanism_agnostic_reason:one('.motivation-reason', card).value, evidence_from_player:one('.motivation-evidence', card).value, uncertainty:one('.motivation-uncertainty', card).value, confidence:Number(one('.motivation-confidence', card).value) })).filter((item) => item.label.trim() && item.description.trim());
  }
  async function confirmInterpretation() {
    const button = one('#discoveryConfirmBtn'); busy(button, true, 'Enregistrement…');
    try {
      const payload = await request(`/api/v09/discovery/interpretations/${state.interpretation.id}/confirm`, { method:'PUT', admin:true, body:{ motivations:collectMotivations() } });
      state.interpretation = payload.interpretation; one('#discoveryInterpretation').innerHTML = '<div class="panel success"><strong>Motivations confirmées.</strong><p>Vous pouvez maintenant les combiner avec vos intentions précédentes.</p></div>'; await loadIntentions(); await loadDashboard(); updateSteps(2); one('#discoveryStageTwo').scrollIntoView({ behavior:'smooth', block:'start' });
    } catch (error) { toast(error.message, 'error'); } finally { busy(button, false); }
  }
  async function loadIntentions() {
    try { state.intentions = (await request('/api/v09/discovery/intentions')).items; renderIntentions(); } catch (error) { toast(error.message, 'error'); }
  }
  function renderIntentions() {
    const node = one('#discoveryIntentions');
    if (!state.intentions.length) { node.innerHTML = '<div class="empty">Aucune intention confirmée pour le moment.</div>'; updateRunButton(); return; }
    const currentInterpretation = state.interpretation?.id;
    node.innerHTML = state.intentions.map((item) => `<label class="discovery-intention-card"><input type="checkbox" value="${item.id}" ${item.interpretation_id === currentInterpretation ? 'checked' : ''}><span><b>${escapeHtml(item.label)}</b><small>${escapeHtml(item.game?.displayName || item.game?.name || `AppID ${item.app_id}`)}</small><p>${escapeHtml(item.description)}</p>${item.uncertainty ? `<em>Incertitude : ${escapeHtml(item.uncertainty)}</em>` : ''}</span></label>`).join('');
    all('input[type="checkbox"]', node).forEach((input) => input.addEventListener('change', updateRunButton)); updateRunButton();
  }
  function selectedIntentions() { return all('#discoveryIntentions input[type="checkbox"]:checked').map((input) => Number(input.value)); }
  function updateRunButton() { const button = one('#discoveryRunBtn'); if (button) button.disabled = !state.selectedGame || !selectedIntentions().length; }
  async function runDiscovery() {
    const button = one('#discoveryRunBtn'); busy(button, true, 'Présélection puis analyse…'); one('#discoveryStageThree').hidden = false; one('#discoveryRecommendations').innerHTML = '<div class="panel discovery-loading"><strong>Backlog cherche des résonances…</strong><p>Embedding de votre recherche, présélection de candidats, puis analyse approfondie des plus prometteurs. Cette étape peut prendre quelques minutes.</p></div>'; updateSteps(3);
    try {
      const payload = await request('/api/v09/discovery/runs', { method:'POST', admin:true, body:{ referenceAppId:state.selectedGame.appId, intentionIds:selectedIntentions(), queryText:one('#discoveryQuery').value } });
      state.run = payload.run; renderRun(); await loadDashboard(); one('#discoveryStageThree').scrollIntoView({ behavior:'smooth', block:'start' });
    } catch (error) { one('#discoveryRecommendations').innerHTML = `<div class="panel error-detail"><strong>Découverte interrompue</strong><p>${escapeHtml(error.message)}</p></div>`; toast(error.message, 'error'); } finally { busy(button, false); updateRunButton(); }
  }
  function renderRun() {
    const run = state.run; one('#discoveryRunSummary').textContent = `${run.recommendation_count} recommandations · ${run.candidate_count} candidats présélectionnés · ${run.deep_candidate_count} analysés en profondeur · ${duration(run.duration_ms)}`;
    one('#discoveryRecommendations').innerHTML = run.recommendations.map((item) => `<article class="discovery-recommendation" data-app-id="${escapeHtml(item.app_id)}"><div class="discovery-rec-cover"><img src="${escapeHtml(item.game?.coverUrl || '')}" alt="" loading="lazy"><span>${Math.round(Number(item.resonance_score) * 100)} %</span></div><div class="discovery-rec-body"><div class="discovery-rec-title"><div><span class="eyebrow">RÉSONANCE ${escapeHtml(item.confidence)}</span><h3>${escapeHtml(item.game?.displayName || item.game?.name || `AppID ${item.app_id}`)}</h3></div><div class="discovery-intent-tags">${item.matchedIntentions.map((intent) => `<span>${escapeHtml(intent.label)}</span>`).join('')}</div></div><p class="discovery-presentation">${escapeHtml(item.presentation)}</p><div class="discovery-argument-grid"><div><h4>Pourquoi cette rencontre</h4><p>${escapeHtml(item.explanation)}</p></div><div><h4>Ce qui change</h4><p>${escapeHtml(item.difference_text)}</p></div></div><details><summary>Éléments connus et incertitudes</summary><h4>Éléments utilisés</h4><ul>${item.evidence.map((entry) => `<li>${escapeHtml(entry)}</li>`).join('')}</ul><h4>Incertitudes</h4><ul>${item.uncertainties.map((entry) => `<li>${escapeHtml(entry)}</li>`).join('')}</ul></details><div class="discovery-feedback" data-run-id="${run.id}" data-app-id="${escapeHtml(item.app_id)}"><p><b>Votre retour qualitatif</b></p><div class="feedback-buttons"><button type="button" data-verdict="interested" class="${item.verdict === 'interested' ? 'selected' : ''}">Ça m’intéresse</button><button type="button" data-verdict="not_for_me" class="${item.verdict === 'not_for_me' ? 'selected' : ''}">Ce n’est pas ce que je cherche</button><button type="button" data-verdict="reason_wrong" class="${item.verdict === 'reason_wrong' ? 'selected' : ''}">Bonne piste, mauvaise raison</button></div><div class="discovery-feedback-detail"><select aria-label="Ce qui doit être corrigé"><option value="unknown">À préciser</option><option value="game" ${item.correction_target === 'game' ? 'selected' : ''}>Compréhension du jeu</option><option value="player" ${item.correction_target === 'player' ? 'selected' : ''}>Compréhension de mes motivations</option><option value="match" ${item.correction_target === 'match' ? 'selected' : ''}>Association entre les deux</option></select><input maxlength="2000" value="${escapeHtml(item.feedback_comment || '')}" placeholder="Pourquoi ? (facultatif)"></div></div></div></article>`).join('');
    all('.discovery-feedback button[data-verdict]').forEach((button) => button.addEventListener('click', () => saveFeedback(button)));
  }
  async function saveFeedback(button) {
    const box = button.closest('.discovery-feedback'); const select = one('select', box); const comment = one('input', box); button.disabled = true;
    try { await request('/api/v09/discovery/feedback', { method:'PUT', admin:true, body:{ runId:Number(box.dataset.runId), appId:box.dataset.appId, verdict:button.dataset.verdict, correctionTarget:select.value, comment:comment.value } }); all('button[data-verdict]', box).forEach((item) => item.classList.toggle('selected', item === button)); toast('Retour enregistré pour mesurer et corriger les recommandations.'); await loadDashboard(); } catch (error) { toast(error.message, 'error'); } finally { button.disabled = false; }
  }
  async function load() { if (!state.loaded) { state.loaded = true; await Promise.all([loadIntentions(), loadDashboard()]); } else await loadDashboard(); }
  function init() {
    const search = one('#discoveryGameSearch'); if (!search) return;
    search.addEventListener('input', () => { clearTimeout(state.searchTimer); state.searchTimer = setTimeout(searchGames, 250); });
    one('#discoveryReason').addEventListener('input', () => { one('#discoveryInterpretBtn').disabled = !state.selectedGame || one('#discoveryReason').value.trim().length < 20; });
    one('#discoveryInterpretBtn').addEventListener('click', interpret); one('#discoveryRunBtn').addEventListener('click', runDiscovery);
    const tab = one('.tab[data-view="discovery"]'); tab?.addEventListener('click', load);
    if (one('#discoveryView').classList.contains('active') || sessionStorage.getItem('backlogView') === 'discovery') load();
  }
  document.addEventListener('DOMContentLoaded', init);
})();
