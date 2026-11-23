import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;
function ident(value) {
  if (!IDENTIFIER.test(value)) throw new Error(`Identifiant SQL invalide: ${value}`);
  return `"${value}"`;
}
export function tableExists(db, table) {
  return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table));
}
export function columns(db, table) {
  if (!IDENTIFIER.test(table) || !tableExists(db, table)) return new Set();
  return new Set(db.prepare(`PRAGMA table_info(${ident(table)})`).all().map((row) => row.name));
}
export function databaseCapabilities(db) {
  const games = columns(db, 'games');
  const profiles = columns(db, 'profiles');
  const state = columns(db, 'game_user_state');
  const history = columns(db, 'recommendation_history');
  const feedback = columns(db, 'discovery_feedback');
  const queue = columns(db, 'enrichment_queue');
  return {
    historicalCore: ['app_id', 'title'].every((name) => games.has(name)) && ['app_id', 'profile_json', 'embedding_json'].every((name) => profiles.has(name)),
    completion: ['app_id', 'completed'].every((name) => state.has(name)),
    recommendationHistory: history.has('candidate_app_id') || history.has('app_id'),
    feedback: ['reference_app_id', 'candidate_app_id', 'motivation_key', 'verdict'].every((name) => feedback.has(name)),
    enrichmentQueue: queue.has('app_id') || queue.has('game_id')
  };
}
function assertHistoricalCore(db) {
  const capabilities = databaseCapabilities(db);
  if (!capabilities.historicalCore) {
    throw new Error('La base ciblée n’est pas la base historique Backlog attendue (tables games/profiles ou colonnes essentielles absentes). Aucune modification effectuée.');
  }
  const quick = db.prepare('PRAGMA quick_check').get()?.quick_check;
  if (quick !== 'ok') throw new Error(`Échec de PRAGMA quick_check: ${quick || 'résultat absent'}. Aucune modification effectuée.`);
  return capabilities;
}
export function openDatabase(filename, { readOnly = false } = {}) {
  const resolved = path.resolve(filename);
  let stat;
  try { stat = fs.statSync(resolved); }
  catch { throw new Error(`Base SQLite historique introuvable: ${resolved}. Démarrage refusé pour éviter la création d’une base vide.`); }
  if (!stat.isFile() || stat.size === 0) throw new Error(`Chemin SQLite historique invalide ou vide: ${resolved}. Démarrage refusé.`);
  const db = new DatabaseSync(resolved, { readOnly });
  try {
    db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
    db.databasePath = resolved;
    db.capabilities = assertHistoricalCore(db);
    return db;
  } catch (error) {
    try { db.close(); } catch {}
    throw error;
  }
}
