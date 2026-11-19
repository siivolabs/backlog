'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const appSource=fs.readFileSync(path.join(__dirname,'..','public','app.js'),'utf8');
const serverSource=fs.readFileSync(path.join(__dirname,'..','server.js'),'utf8');

test('l’interface rend le code, l’étape et le détail complet des erreurs',()=>{
  assert.match(appSource,/function jobErrorHtml/);
  assert.match(appSource,/job\.current_step/);
  assert.match(appSource,/job\.error_code/);
  assert.match(appSource,/job\.error_detail/);
  assert.match(appSource,/jobErrorHtml\(game\.lastJob,\{open:true\}\)/);
});

test('le polling affiche le code d’erreur et recharge la fiche en échec',()=>{
  assert.match(appSource,/job\.error_code\?`code/);
  assert.match(appSource,/job\.status==='error'\?'overview':'profile'/);
});


test('le journal de campagne reste ouvert et affiche les noms de jeux avec les événements SQLite',()=>{
  assert.match(appSource,/const log=\(job\.telemetry\?\.log/);
  assert.match(appSource,/<details open><summary>Journal en temps réel/);
  assert.match(appSource,/entry\.gameName/);
  assert.match(appSource,/item\.game_name/);
  assert.match(serverSource,/networkCompletion\.itemTelemetry/);
  assert.match(serverSource,/game_name:game\?\.name/);
});
