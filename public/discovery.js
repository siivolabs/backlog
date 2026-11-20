'use strict';

(() => {
  const state = { selectedGame:null, interpretation:null, intentions:[], run:null, searchTimer:null, loaded:false };
  const one = (selector, root = document) => root.querySelector(selector);
  const all = (selector, root = document) => [...root.querySelectorAll(selector)];
  const escapeHtml = (value) => String(value ?? '').replace(/[&<>'"]/g, (character) => ({ '&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#039;','"':'&quot;' }[character]));
  const adminToken = () => sessionStorage.getItem('backlogAdminToken') || '';
  async function request(url, options = {}) {
    const headers = { 'content-type':'application/json', ...(options.headers || {}) }; if (options.admin && adminToken()) headers['x-admin-token'] = adminToken();
    const response = await fetch(url, { ...options, headers, body:options.body && typeof options.body !== 'string' ? JSON.stringify(options.body) : options.body });
    const payload = await response.json().catch(() => ({})); if (!response.ok) throw new Error([payload.error, payload.detail].filter(Boolean).join(' — ') || `HTTP ${response.status}`); return payload;
  }
  function toast(message, type = '') { const node = one('#toast'); if (!node) return; node.textContent = message; node.className = `toast-visible ${type}`; clearTimeout(node.timer); node.timer = setTimeout(() => { node.className = ''; node.textContent = ''; }, 5200); }
  function busy(button, active, label = 'Traitement…') { if (!button) return; if (active) { button.dataset.label = button.textContent; button.textContent = label; } else button.textContent = button.dataset.label || button.textContent; button.disabled = active; }
  function duration(ms) { const seconds = Math.max(0, Math.round(Number(ms || 0) / 1000)); return seconds < 60 ? `${seconds} s` : `${Math.floor(seconds / 60)} min ${seconds % 60} s`; }
  function updateSteps(step) { all('.discovery-steps li').forEach((item, index) => item.classList.toggle('active', index + 1 === step)); }
  async function loadDashboard() {
    try {
      const dashboard = await request('/api/v09/discovery/dashboard'); const node = one('#discoveryMetrics'); if (!node) return;
      node.innerHTML = `<span><b>${dashboard.counts.active_intentions || 0}</b> intentions</span><span><b>${dashboard.counts.completed_runs || 0}</b> découvertes</span><span><b>${dashboard.counts.feedback || 0}</b> retours</span><span><b>${dashboard.counts.memory_associations || 0}</b> associations apprises</span>`;
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
  async function runDiscovery(mode = 'initial', trigger = null) {
    const button = trigger || one('#discoveryRunBtn'); const parentRunId = mode === 'initial' ? null : state.run?.id; const loadingLabel = mode === 'refine' ? 'Affinage en cours…' : mode === 'explore' ? 'Exploration en cours…' : 'Présélection puis analyse…';
    busy(button, true, loadingLabel); one('#discoveryStageThree').hidden = false; one('#discoveryRecommendations').innerHTML = `<div class="panel discovery-loading"><strong>Backlog ${mode === 'initial' ? 'cherche des résonances' : 'renouvelle les candidats'}…</strong><p>La mémoire des retours est relue avant la présélection. Les corrections restent attachées au jeu et à la motivation concernés.</p></div>`; updateSteps(3);
    try {
      const payload = await request('/api/v09/discovery/runs', { method:'POST', admin:true, body:{ referenceAppId:state.selectedGame.appId, intentionIds:selectedIntentions(), queryText:one('#discoveryQuery').value, mode, parentRunId } });
      state.run = payload.run; renderRun(); await loadDashboard(); one('#discoveryStageThree').scrollIntoView({ behavior:'smooth', block:'start' });
    } catch (error) { one('#discoveryRecommendations').innerHTML = `<div class="panel error-detail"><strong>Découverte interrompue</strong><p>${escapeHtml(error.message)}</p></div>`; toast(error.message, 'error'); } finally { busy(button, false); updateRunButton(); }
  }
  function evaluationLabel(status) { return status === 'satisfied' ? 'Satisfaite' : status === 'unsatisfied' ? 'Non satisfaite' : 'Incertaine'; }
  function renderEvaluation(item) {
    const intention = item.intention || {}; const existing = item.memoryAssociation || '';
    return `<article class="discovery-evaluation ${escapeHtml(item.status)}" data-intention-id="${escapeHtml(item.intentionId)}"><div class="discovery-evaluation-head"><div><span class="evaluation-status">${evaluationLabel(item.status)}</span><b>${escapeHtml(intention.label || `Intention ${item.intentionId}`)}</b></div><span class="evaluation-confidence">${Math.round(Number(item.confidence || 0) * 100)} %</span></div><p>${escapeHtml(item.rationale)}</p>${item.evidence?.length ? `<ul>${item.evidence.map((entry) => `<li>${escapeHtml(entry)}</li>`).join('')}</ul>` : ''}<label>Votre validation de cette association<select class="association-feedback"><option value="">Ne pas modifier la mémoire</option><option value="validated" ${existing === 'validated' ? 'selected' : ''}>Association validée</option><option value="rejected" ${existing === 'rejected' ? 'selected' : ''}>Association rejetée</option><option value="uncertain" ${existing === 'uncertain' ? 'selected' : ''}>Association encore incertaine</option></select></label>${item.memoryNote ? `<small class="memory-note">Mémoire actuelle : ${escapeHtml(item.memoryNote)}</small>` : ''}</article>`;
  }
  function renderFeedback(item, run) {
    return `<div class="discovery-feedback" data-run-id="${run.id}" data-app-id="${escapeHtml(item.app_id)}" data-verdict="${escapeHtml(item.verdict || '')}"><p><b>Votre retour qualitatif</b></p><div class="feedback-buttons"><button type="button" data-verdict="interested" class="${item.verdict === 'interested' ? 'selected' : ''}">Ça m’intéresse</button><button type="button" data-verdict="not_for_me" class="${item.verdict === 'not_for_me' ? 'selected' : ''}">Ce n’est pas ce que je cherche</button><button type="button" data-verdict="reason_wrong" class="${item.verdict === 'reason_wrong' ? 'selected' : ''}">Bonne piste, mauvaise raison</button></div><div class="discovery-feedback-detail"><select class="correction-target" aria-label="Ce qui doit être corrigé"><option value="unknown">À préciser</option><option value="game" ${item.correction_target === 'game' ? 'selected' : ''}>Compréhension du jeu</option><option value="player" ${item.correction_target === 'player' ? 'selected' : ''}>Compréhension de mes motivations</option><option value="match" ${item.correction_target === 'match' ? 'selected' : ''}>Association entre les deux</option></select><select class="familiarity" aria-label="Connaissance du jeu"><option value="unknown">Je ne précise pas si je le connais</option><option value="known" ${item.familiarity === 'known' ? 'selected' : ''}>Je connais déjà ce jeu</option><option value="played" ${item.familiarity === 'played' ? 'selected' : ''}>J’y ai déjà joué</option></select><input class="feedback-comment" maxlength="2000" value="${escapeHtml(item.feedback_comment || '')}" placeholder="Expliquez précisément ce qui convient ou non"></div><button type="button" class="button secondary save-discovery-feedback">Enregistrer et réutiliser ce retour</button></div>`;
  }
  function renderRun() {
    const run = state.run; const count = Number(run.recommendation_count || 0); const mode = run.mode === 'refine' ? 'affinage' : run.mode === 'explore' ? 'exploration' : 'découverte';
    one('#discoveryRunSummary').textContent = `${count} recommandation${count > 1 ? 's' : ''} · ${run.candidate_count} candidats présélectionnés · ${run.deep_candidate_count} analysés · ${run.feedback_memory_count || 0} éléments de mémoire relus · ${mode} en ${duration(run.duration_ms)}`;
    const cards = run.recommendations.map((item) => `<article class="discovery-recommendation" data-app-id="${escapeHtml(item.app_id)}"><div class="discovery-rec-cover"><img src="${escapeHtml(item.game?.coverUrl || '')}" alt="" loading="lazy"><span>${Math.round(Number(item.resonance_score) * 100)} %</span></div><div class="discovery-rec-body"><div class="discovery-rec-title"><div><span class="eyebrow">RÉSONANCE ${escapeHtml(item.confidence)}</span><h3>${escapeHtml(item.game?.displayName || item.game?.name || `AppID ${item.app_id}`)}</h3></div><div class="discovery-intent-tags">${item.matchedIntentions.map((intent) => `<span>${escapeHtml(intent.label)}</span>`).join('')}</div></div><p class="discovery-presentation">${escapeHtml(item.presentation)}</p><div class="discovery-argument-grid"><div><h4>Pourquoi cette rencontre</h4><p>${escapeHtml(item.explanation)}</p></div><div><h4>Ce qui change</h4><p>${escapeHtml(item.difference_text)}</p></div></div><section class="discovery-evaluations"><h4>Évaluation indépendante des motivations</h4><div>${item.intentionEvaluations.map(renderEvaluation).join('')}</div></section><details><summary>Éléments connus et incertitudes générales</summary><h4>Éléments utilisés</h4><ul>${item.evidence.map((entry) => `<li>${escapeHtml(entry)}</li>`).join('')}</ul><h4>Incertitudes</h4><ul>${item.uncertainties.map((entry) => `<li>${escapeHtml(entry)}</li>`).join('')}</ul></details>${renderFeedback(item, run)}</div></article>`).join('');
    const empty = count ? '' : '<div class="panel discovery-empty"><strong>Aucune résonance suffisamment étayée.</strong><p>Backlog préfère ne rien proposer plutôt que de forcer cinq rapprochements fragiles. Vous pouvez affiner la demande ou explorer un autre groupe de candidats.</p></div>';
    one('#discoveryRecommendations').innerHTML = `${cards}${empty}<div class="panel discovery-next-actions"><div><span class="eyebrow">POURSUIVRE SANS RÉPÉTER</span><h3>Renouveler les candidats</h3><p>Les deux actions relisent vos retours. L’affinage écarte cette série ; l’exploration écarte toutes les recommandations déjà vues dans ce contexte.</p></div><div class="button-row"><button id="discoveryRefineBtn" class="button" type="button">Affiner ces recommandations</button><button id="discoveryExploreBtn" class="button secondary" type="button">Explorer d'autres jeux</button></div></div>`;
    all('.discovery-feedback button[data-verdict]').forEach((button) => button.addEventListener('click', () => { const box = button.closest('.discovery-feedback'); box.dataset.verdict = button.dataset.verdict; all('button[data-verdict]', box).forEach((item) => item.classList.toggle('selected', item === button)); }));
    all('.save-discovery-feedback').forEach((button) => button.addEventListener('click', () => saveFeedback(button)));
    one('#discoveryRefineBtn').addEventListener('click', (event) => runDiscovery('refine', event.currentTarget));
    one('#discoveryExploreBtn').addEventListener('click', (event) => runDiscovery('explore', event.currentTarget));
  }
  async function saveFeedback(button) {
    const box = button.closest('.discovery-feedback'); const verdict = box.dataset.verdict;
    if (!verdict) { toast('Choisissez d’abord un retour qualitatif.', 'error'); return; }
    const card = box.closest('.discovery-recommendation'); const intentionAssessments = all('.discovery-evaluation', card).map((evaluation) => ({ intentionId:Number(evaluation.dataset.intentionId), association:one('.association-feedback', evaluation).value, note:one('.feedback-comment', box).value })).filter((item) => item.association);
    busy(button, true, 'Mémorisation…');
    try {
      await request('/api/v09/discovery/feedback', { method:'PUT', admin:true, body:{ runId:Number(box.dataset.runId), appId:box.dataset.appId, verdict, correctionTarget:one('.correction-target', box).value, familiarity:one('.familiarity', box).value, comment:one('.feedback-comment', box).value, intentionAssessments } });
      toast('Retour mémorisé. Il sera relu lors des prochaines recherches sans être généralisé aux autres jeux.'); await loadDashboard();
    } catch (error) { toast(error.message, 'error'); } finally { busy(button, false); }
  }
  async function load() { if (!state.loaded) { state.loaded = true; await Promise.all([loadIntentions(), loadDashboard()]); } else await loadDashboard(); }
  function init() {
    const search = one('#discoveryGameSearch'); if (!search) return;
    search.addEventListener('input', () => { clearTimeout(state.searchTimer); state.searchTimer = setTimeout(searchGames, 250); });
    one('#discoveryReason').addEventListener('input', () => { one('#discoveryInterpretBtn').disabled = !state.selectedGame || one('#discoveryReason').value.trim().length < 20; });
    one('#discoveryInterpretBtn').addEventListener('click', interpret); one('#discoveryRunBtn').addEventListener('click', () => runDiscovery('initial'));
    const tab = one('.tab[data-view="discovery"]'); tab?.addEventListener('click', load);
    if (one('#discoveryView').classList.contains('active') || sessionStorage.getItem('backlogView') === 'discovery') load();
  }
  document.addEventListener('DOMContentLoaded', init);
})();
