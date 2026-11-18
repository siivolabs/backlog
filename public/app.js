'use strict';

const state = { dashboard: null, library: [], selected: new Set() };
const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const dimensionLabels = { gameplay:'Gameplay',narrative:'Narration',exploration:'Exploration',structure:'Structure',pace:'Rythme',progression:'Progression',difficulty:'Difficulté',atmosphere:'Ambiance',mode:'Mode de jeu',perspective:'Perspective',identity:'Identité' };

async function request(url, options = {}) {
  const response = await fetch(url, { headers: { 'content-type': 'application/json' }, ...options });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Erreur HTTP ${response.status}`);
  return data;
}

function notify(message, error = false) {
  const notice = $('#notice'); notice.textContent = message; notice.classList.remove('hidden','error');
  if (error) notice.classList.add('error');
  clearTimeout(notice.timer); notice.timer = setTimeout(() => notice.classList.add('hidden'), 7000);
}

function pct(value) { return `${Math.round((Number(value) || 0) * 100)} %`; }
function dateLabel(value) { if (!value) return 'Aucun calcul récent'; return new Intl.DateTimeFormat('fr-FR',{dateStyle:'medium',timeStyle:'short'}).format(new Date(value)); }

async function loadDashboard() {
  state.dashboard = await request('/api/dashboard'); renderDashboard();
}

function renderDashboard() {
  const { coverage, quality, games, lastRun } = state.dashboard;
  $('#selectedMetric').textContent = coverage.selectedTotal;
  $('#profiledMetric').textContent = coverage.profiled;
  $('#embeddedMetric').textContent = coverage.embedded;
  $('#pairsMetric').textContent = `${coverage.pairCount} / ${coverage.maximumPairs}`;
  $('#coverageBar').style.width = pct(coverage.selectedTotal ? coverage.networked / coverage.selectedTotal : 0);
  $('#coverageCaption').textContent = `${coverage.networked} jeux participent au réseau sur ${coverage.libraryTotal} jeux détectés dans la bibliothèque.`;
  $('#medianMetric').textContent = pct(quality.medianCompleteness);
  $('#usableMetric').textContent = coverage.usable;
  $('#densityMetric').textContent = pct(quality.usefulDensity);
  $('#evaluatedMetric').textContent = quality.evaluatedRecommendations;
  $('#levelA').textContent = quality.levels.A; $('#levelB').textContent = quality.levels.B; $('#levelC').textContent = quality.levels.C;
  $('#runCaption').textContent = lastRun ? `Dernier calcul : ${dateLabel(lastRun.completed_at || lastRun.started_at)} · ${lastRun.pair_count || 0} paires · ${lastRun.status}` : 'Le réseau n’a pas encore été calculé.';
  renderGames(games); renderMissing(quality.missingByDimension, coverage.profiled);
}

function renderGames(games) {
  const filter = $('#gameFilter').value.trim().toLowerCase(); const container = $('#games'); container.textContent = '';
  const visible = games.filter((game) => game.title.toLowerCase().includes(filter) || game.appId.includes(filter));
  if (!visible.length) { container.innerHTML = '<div class="skeleton">Aucun jeu ne correspond au filtre.</div>'; return; }
  for (const game of visible) {
    const card = $('#gameTemplate').content.firstElementChild.cloneNode(true);
    const badge = $('.quality-badge', card); badge.textContent = game.qualityLevel || '—'; badge.classList.add((game.qualityLevel || '').toLowerCase());
    $('.game-title', card).textContent = game.title;
    $('.game-meta', card).textContent = `App ${game.appId} · profil ${game.versionNo ? `V${game.versionNo}` : 'absent'} · ${game.hasEmbedding ? 'embedding prêt' : 'sans embedding'} · ${pct(game.completeness)}`;
    $('.mini-progress i', card).style.width = pct(game.completeness);
    const summary = $('.game-summary', card); const detail = $('.game-detail', card);
    summary.addEventListener('click', () => { const open = summary.getAttribute('aria-expanded') === 'true'; summary.setAttribute('aria-expanded', String(!open)); detail.classList.toggle('hidden', open); });
    renderRecommendations($('.recommendations', card), game);
    container.append(card);
  }
}

function renderRecommendations(container, game) {
  if (!game.recommendations.length) { container.innerHTML = '<p class="caption">Aucune similarité calculée. Lancez le recalcul du réseau.</p>'; return; }
  for (const rec of game.recommendations) {
    const article = document.createElement('article'); article.className = 'recommendation';
    const similar = (rec.explanation.similarities || []).map((item) => `${dimensionLabels[item.dimension] || item.dimension}${item.shared?.length ? ` (${item.shared.slice(0,3).join(', ')})` : ''}`).join(' · ') || 'profil global';
    const different = (rec.explanation.differences || []).map((item) => dimensionLabels[item.dimension] || item.dimension).join(' · ') || 'non déterminé';
    article.innerHTML = `<div class="rec-head"><strong></strong><span class="score">${pct(rec.score)}</span></div><p class="rec-reasons"><b>Proche :</b> ${escapeHtml(similar)}<br><b>Diffère :</b> ${escapeHtml(different)}<br><small>${rec.mode === 'hybrid' ? 'score hybride' : 'score structuré — embedding indisponible'}</small></p><div class="feedback-row"></div><input class="feedback-reason" maxlength="2000" placeholder="Pourquoi ? (facultatif)">`;
    $('.rec-head strong', article).textContent = rec.title;
    const row = $('.feedback-row', article); const reason = $('.feedback-reason', article); reason.value = rec.feedback?.reason || '';
    const ratings = [['very_similar','Très similaire'],['partially_similar','Partiel'],['slightly_similar','Faible'],['not_similar','Non']];
    for (const [value,label] of ratings) {
      const button = document.createElement('button'); button.type='button'; button.textContent=label; button.classList.toggle('active',rec.feedback?.rating===value);
      button.addEventListener('click', async () => { try { await request('/api/feedback',{method:'POST',body:JSON.stringify({sourceAppId:game.appId,targetAppId:rec.appId,rating:value,reason:reason.value})}); $$('.feedback-row button',article).forEach((item)=>item.classList.remove('active')); button.classList.add('active'); notify('Évaluation enregistrée.'); await loadDashboard(); } catch(error){ notify(error.message,true); } });
      row.append(button);
    }
    container.append(article);
  }
}

function renderMissing(missing, total) {
  const container = $('#missingDimensions'); container.textContent='';
  for (const [name,count] of Object.entries(missing).sort((a,b)=>b[1]-a[1])) {
    const item=document.createElement('div'); item.className='dimension'; const ratio=total?count/total:0;
    item.innerHTML=`<span>${dimensionLabels[name]||name}</span><b>${count}</b><i style="width:${pct(ratio)}"></i>`; container.append(item);
  }
}

async function runAction(button, url, body, success) {
  button.disabled=true; const old=button.textContent; button.textContent='Traitement…';
  try { const result=await request(url,{method:'POST',body:JSON.stringify(body||{})}); notify(success(result)); await loadDashboard(); }
  catch(error){ notify(error.message,true); } finally { button.disabled=false; button.textContent=old; }
}

async function openSelection() {
  if (!state.library.length) state.library=(await request('/api/games?limit=10000')).games;
  state.selected=new Set(state.library.filter((game)=>game.selected).map((game)=>game.appId)); renderLibrary(); $('#selectionDialog').showModal();
}

function renderLibrary() {
  const filter=$('#libraryFilter').value.trim().toLowerCase(); const container=$('#libraryGames'); container.textContent='';
  for (const game of state.library.filter((item)=>item.title.toLowerCase().includes(filter)||item.appId.includes(filter))) {
    const label=document.createElement('label'); label.className='library-game';
    const input=document.createElement('input'); input.type='checkbox'; input.checked=state.selected.has(game.appId);
    input.addEventListener('change',()=>{ if(input.checked)state.selected.add(game.appId);else state.selected.delete(game.appId);$('#selectionCount').textContent=state.selected.size; });
    const title=document.createElement('span'); title.textContent=game.title; const id=document.createElement('small'); id.textContent=`App ${game.appId}`;
    label.append(input,title,id); container.append(label);
  }
  $('#selectionCount').textContent=state.selected.size;
}

function escapeHtml(value){return String(value).replace(/[&<>'"]/g,(char)=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[char]));}

$('#rebuildBtn').addEventListener('click',()=>runAction($('#rebuildBtn'),'/api/network/rebuild',{},(result)=>`${result.pairCount} paires recalculées pour ${result.usableCount} profils.`));
$('#embedBtn').addEventListener('click',()=>runAction($('#embedBtn'),'/api/embeddings/backfill',{limit:50},(result)=>`${result.completed} embeddings créés, ${result.failed} échecs.`));
$('#gameFilter').addEventListener('input',()=>renderGames(state.dashboard?.games||[]));
$('#selectionBtn').addEventListener('click',openSelection);
$('#libraryFilter').addEventListener('input',renderLibrary);
$('#saveSelectionBtn').addEventListener('click',async(event)=>{event.preventDefault();try{await request('/api/selection',{method:'POST',body:JSON.stringify({appIds:[...state.selected]})});$('#selectionDialog').close();state.library=[];notify(`${state.selected.size} jeux enregistrés. Recalculez maintenant le réseau.`);await loadDashboard();}catch(error){notify(error.message,true);}});

loadDashboard().catch((error)=>notify(error.message,true));
