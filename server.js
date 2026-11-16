// Backlog: proxy de diagnostic pour UNE fiche Steam, sans clé API.
const http = require('node:http');
const { URL } = require('node:url');
const HOST = '0.0.0.0'; // Publication restreinte à 127.0.0.1 par Docker Compose.
const PORT = 3000;
const html = `<!doctype html><html lang="fr"><meta charset="utf-8"><title>Backlog - Test proxy</title><style>body{font:16px system-ui;background:#101827;color:#eef;padding:30px;max-width:720px;margin:auto}button,input{padding:10px}pre{white-space:pre-wrap;background:#23314a;padding:16px;border-radius:8px}</style><h1>Backlog : diagnostic Steam</h1><p>Ce test interroge une seule fiche de jeu, via un proxy local. Aucune clé API.</p><input id="appid" value="400" inputmode="numeric" aria-label="AppID"><button id="go">Tester</button><pre id="output">Prêt.</pre><script>document.getElementById('go').onclick=async()=>{const id=document.getElementById('appid').value;const out=document.getElementById('output');out.textContent='Chargement...';try{const r=await fetch('/api/steam/'+encodeURIComponent(id));const data=await r.json();out.textContent=JSON.stringify(data,null,2);}catch(e){out.textContent='Erreur : '+e.message;}};</script></html>`;
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const send = (status, obj) => { res.writeHead(status, {'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}); res.end(JSON.stringify(obj)); };
  if (req.method !== 'GET') return send(405, {error:'Méthode non autorisée'});
  if (url.pathname === '/') {res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Content-Security-Policy':"default-src 'self'; script-src 'unsafe-inline' 'self'; style-src 'unsafe-inline' 'self'"});return res.end(html);}
  const match = /^\/api\/steam\/(\d{1,10})$/.exec(url.pathname);
  if (!match) return send(404,{error:'Route inconnue ou AppID invalide'});
  const id = match[1];
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    let upstream;
    try {upstream = await fetch(`https://store.steampowered.com/api/appdetails?appids=${id}&l=french`, {signal:controller.signal,headers:{'Accept':'application/json'}});}
    finally {clearTimeout(timeout);}
    if (!upstream.ok) return send(502,{error:`Steam a répondu HTTP ${upstream.status}`});
    const data = await upstream.json();
    const entry = data[id];
    if (!entry?.success || !entry.data) return send(404,{error:'Fiche indisponible chez Steam'});
    return send(200,{appid:Number(id),name:entry.data.name ?? null,genres:(entry.data.genres ?? []).map(g=>g.description)});
  } catch(e) { console.error('Erreur Steam:',e.message); return send(502,{error:'Impossible de joindre ou lire Steam',detail:e.name==='AbortError'?'Délai dépassé':e.message}); }
});
server.listen(PORT,HOST,()=>console.log(`Backlog test sur port ${PORT}`));
