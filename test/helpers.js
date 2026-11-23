import { openDatabase } from '../src/db.js';

export function config(overrides = {}) {
  return { version: '1.2.0', host: '127.0.0.1', port: 0, databasePath: ':memory:', adminToken: 'secret', ollamaUrl: 'http://127.0.0.1:9', analysisModel: 'test-analysis', embeddingModel: 'test-embedding', autoEnrich: false, enrichmentConcurrency: 1, enrichmentPollMs: 1000, requestTimeoutMs: 500, discoveryLimit: 12, minProfileQuality: 0.35, ...overrides };
}

export function profile(title, confidence = 0.8) {
  return {
    summary: `${title} propose une expérience singulière, documentée et cohérente dans laquelle le joueur expérimente des systèmes, observe leurs conséquences et progresse par compréhension.`,
    motivations: [
      { key: 'exploration', label: 'Exploration', weight: 0.8, evidence: 'Le joueur découvre progressivement les règles et les espaces à partir d’indices concrets.' },
      { key: 'problem-solving', label: 'Résolution de problèmes', weight: 0.7, evidence: 'Les obstacles demandent de formuler des hypothèses puis de vérifier leurs conséquences.' }
    ],
    pace: 'Délibéré et exploratoire', challenge: 'Modéré, fondé sur la compréhension', agency: 'Élevée grâce à plusieurs approches possibles', social: 'Expérience solo', tone: 'Étrange et curieuse', confidence
  };
}

export function addGame(db, { appId, title, vector = [1, 0, 0], rich = true, completed = false, confidence = 0.8, studio = 'Studio', genres = 'Aventure' }) {
  const description = rich ? `${title} est une expérience documentée avec une mécanique originale. Le joueur explore un monde cohérent, apprend ses règles et utilise ses découvertes pour progresser sans remplissage artificiel.` : '';
  db.prepare(`INSERT INTO games(app_id,title,studio,genres,cover_url,description,playtime_minutes,created_at,updated_at) VALUES(?,?,?,?,?,?,0,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`).run(appId, title, studio, genres, '', description);
  const p = rich ? profile(title, confidence) : { summary: `Expérience inconnue pour ${title}. L’absence de données rend l’analyse spéculative.`, motivations: [], confidence: 0.1 };
  db.prepare(`INSERT INTO profiles(app_id,profile_json,embedding_json,schema_version,analysis_model,embedding_model,confidence,source_json,created_at,updated_at) VALUES(?,?,?,'core-v1','test','test',?,?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`).run(appId, JSON.stringify(p), JSON.stringify(vector), confidence, JSON.stringify({ title, description, studio: rich ? studio : '', genres: rich ? genres : '' }));
  db.prepare(`INSERT INTO game_user_state(app_id,completed,completed_at,updated_at) VALUES(?,?,?,CURRENT_TIMESTAMP)`).run(appId, completed ? 1 : 0, completed ? new Date().toISOString() : null);
}

export function seededDb() {
  const db = openDatabase(':memory:');
  addGame(db, { appId: '100', title: 'Reference', vector: [1, 0, 0] });
  addGame(db, { appId: '101', title: 'Mushroom 11', vector: [0.98, 0.1, 0] });
  addGame(db, { appId: '102', title: 'Everything', vector: [0.9, 0.2, 0.1] });
  addGame(db, { appId: '103', title: 'The Scourge Project', vector: [0.99, 0.01, 0], rich: false, confidence: 0.1, studio: '', genres: '' });
  return db;
}
