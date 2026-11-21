import { json } from './db.js';

function cosine(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length || !a.length) return -1;
  let dot = 0, normA = 0, normB = 0;
  for (let index = 0; index < a.length; index += 1) {
    dot += a[index] * b[index];
    normA += a[index] ** 2;
    normB += b[index] ** 2;
  }
  return normA && normB ? dot / Math.sqrt(normA * normB) : -1;
}

const RESULT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['recommendations'],
  properties: {
    recommendations: {
      type: 'array', maxItems: 5,
      items: {
        type: 'object', additionalProperties: false,
        required: ['app_id', 'score', 'explanation', 'matching_motivations', 'caveats'],
        properties: {
          app_id: { type: 'integer' },
          score: { type: 'number' },
          explanation: { type: 'string' },
          matching_motivations: { type: 'array', items: { type: 'string' }, maxItems: 5 },
          caveats: { type: 'array', items: { type: 'string' }, maxItems: 4 }
        }
      }
    }
  }
};

export class DiscoveryEngine {
  constructor({ db, ollama, shortlist = 20, limit = 5, logger }) {
    Object.assign(this, { db, ollama, shortlist, limit, logger });
  }

  listCandidates(q = '', limit = 100) {
    const pattern = `%${q}%`;
    return this.db.prepare(`
      SELECT g.app_id, g.name, g.cover_url, g.developer
      FROM games g JOIN profiles p ON p.app_id=g.app_id
      WHERE g.name LIKE ? ORDER BY g.name COLLATE NOCASE LIMIT ?
    `).all(pattern, Math.min(250, Math.max(1, Number(limit) || 100)));
  }

  async recommend({ motivation, referenceAppId = null }) {
    const text = String(motivation || '').trim();
    if (text.length < 8) throw new Error('Décrivez votre envie en au moins 8 caractères.');
    const queryEmbedding = await this.ollama.embed(text);
    const reference = referenceAppId ? this.db.prepare(`
      SELECT g.app_id, g.name, p.profile_json, p.embedding_json
      FROM games g JOIN profiles p ON p.app_id=g.app_id WHERE g.app_id=?
    `).get(Number(referenceAppId)) : null;
    const referenceEmbedding = reference ? json(reference.embedding_json, []) : null;
    const rows = this.db.prepare(`
      SELECT g.app_id, g.name, g.cover_url, g.developer, p.profile_json, p.embedding_json
      FROM games g JOIN profiles p ON p.app_id=g.app_id
    `).all();
    const feedback = new Map(this.db.prepare(`
      SELECT app_id, SUM(CASE verdict WHEN 'positive' THEN 1 WHEN 'negative' THEN -1 ELSE 0 END) AS balance
      FROM discovery_feedback GROUP BY app_id
    `).all().map((row) => [Number(row.app_id), Number(row.balance || 0)]));
    const ranked = rows.filter((row) => Number(row.app_id) !== Number(referenceAppId)).map((row) => {
      const vector = json(row.embedding_json, []);
      const motivationScore = cosine(queryEmbedding, vector);
      const referenceScore = referenceEmbedding ? cosine(referenceEmbedding, vector) : motivationScore;
      const memoryAdjustment = Math.max(-0.08, Math.min(0.05, (feedback.get(Number(row.app_id)) || 0) * 0.02));
      return { ...row, profile: json(row.profile_json, {}), vector: undefined, embedding_json: undefined,
        vectorScore: Math.max(-1, Math.min(1, motivationScore * 0.82 + referenceScore * 0.18 + memoryAdjustment)) };
    }).filter((row) => Number.isFinite(row.vectorScore)).sort((a, b) => b.vectorScore - a.vectorScore).slice(0, this.shortlist);
    if (!ranked.length) return { reference: reference ? { app_id: reference.app_id, name: reference.name } : null, recommendations: [], method: 'semantic' };

    const candidates = ranked.map((row) => ({
      app_id: row.app_id,
      name: row.name,
      semantic_score: Math.round(row.vectorScore * 1000) / 1000,
      profile: row.profile
    }));
    const prompt = `Tu es l'unique moteur de découverte de Backlog Core. Évalue les résonances expérientielles, sans te limiter aux genres.\n` +
      `Envie exprimée: ${text}\n` +
      (reference ? `Jeu de référence: ${reference.name}\n` : '') +
      `Candidats présélectionnés sémantiquement:\n${JSON.stringify(candidates)}\n\n` +
      `Règles: retiens de 0 à ${this.limit} jeux; ne force aucun résultat; utilise uniquement les app_id fournis; score entre 0 et 1; explique précisément la résonance et les réserves.`;
    try {
      const evaluated = await this.ollama.generateJson(prompt, RESULT_SCHEMA);
      const byId = new Map(ranked.map((row) => [Number(row.app_id), row]));
      const recommendations = (evaluated.recommendations || []).map((item) => {
        const row = byId.get(Number(item.app_id));
        if (!row) return null;
        return {
          app_id: row.app_id, name: row.name, cover_url: row.cover_url, developer: row.developer,
          score: Math.max(0, Math.min(1, Number(item.score) || 0)), explanation: item.explanation,
          matching_motivations: item.matching_motivations || [], caveats: item.caveats || []
        };
      }).filter(Boolean).sort((a, b) => b.score - a.score).slice(0, this.limit);
      return { reference: reference ? { app_id: reference.app_id, name: reference.name } : null, recommendations, method: 'semantic_and_experiential' };
    } catch (error) {
      this.logger.warn('Évaluation expérientielle indisponible, classement sémantique conservé', error);
      return {
        reference: reference ? { app_id: reference.app_id, name: reference.name } : null,
        recommendations: ranked.slice(0, this.limit).map((row) => ({
          app_id: row.app_id, name: row.name, cover_url: row.cover_url, developer: row.developer,
          score: Math.max(0, Math.min(1, row.vectorScore)),
          explanation: 'Correspondance sémantique avec les motivations exprimées. L’explication approfondie est temporairement indisponible.',
          matching_motivations: [], caveats: ['Évaluation IA détaillée indisponible pour cette recherche.']
        })),
        method: 'semantic_fallback', warning: error.message
      };
    }
  }

  feedback({ appId, motivation, verdict, note = null }) {
    if (!['positive', 'negative', 'neutral'].includes(verdict)) throw new Error('Verdict invalide');
    this.db.prepare('INSERT INTO discovery_feedback (app_id, motivation, verdict, note) VALUES (?, ?, ?, ?)')
      .run(Number(appId), String(motivation || ''), verdict, note ? String(note) : null);
    return { saved: true };
  }
}
