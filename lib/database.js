'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const APP_ID_COLUMNS = ['app_id', 'appid', 'steam_app_id', 'steam_appid', 'id'];
const NAME_COLUMNS = ['name', 'title', 'display_name', 'displayName'];
const PROFILE_COLUMNS = ['profile_json', 'profile', 'analysis_json', 'analysis', 'result_json', 'result'];
const EMBEDDING_COLUMNS = ['embedding_json', 'embedding', 'vector_json', 'vector'];

function qid(value) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) throw new Error(`Identifiant SQLite non sûr: ${value}`);
  return `"${value}"`;
}

function parseJson(value, fallback = null) {
  if (value == null || value === '') return fallback;
  if (typeof value === 'object') return value;
  try { return JSON.parse(value); } catch { return fallback; }
}

function json(value) {
  return JSON.stringify(value == null ? null : value);
}

function now() { return new Date().toISOString(); }

function resolveDatabasePath(env = process.env) {
  if (env.DATABASE_PATH) return env.DATABASE_PATH;
  const dataDir = env.DATA_DIR || '/data';
  const candidates = [
    'backlog.sqlite', 'backlog.db', 'database.sqlite', 'database.db',
    'library.sqlite', 'backlog.sqlite3'
  ].map((name) => path.join(dataDir, name));
  const existing = candidates.find((candidate) => fs.existsSync(candidate));
  return existing || candidates[0];
}

class BacklogDatabase {
  constructor(filename, options = {}) {
    this.filename = filename;
    this.logger = options.logger || console;
    fs.mkdirSync(path.dirname(filename), { recursive: true });
    this.db = new DatabaseSync(filename);
    this.db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
    this.librarySource = null;
    this.migrate();
  }

  close() { this.db.close(); }

  transaction(fn) {
    this.db.exec('BEGIN IMMEDIATE');
    try { const result = fn(); this.db.exec('COMMIT'); return result; }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }

  migrate() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS ai_v09_meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
    this.migrateLegacyDocumentSources();
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS ai_profile_versions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        app_id TEXT NOT NULL,
        version_no INTEGER NOT NULL,
        lifecycle_state TEXT NOT NULL DEFAULT 'active' CHECK(lifecycle_state IN ('draft','active','superseded','rejected')),
        quality_status TEXT NOT NULL DEFAULT 'generated' CHECK(quality_status IN ('generated','validated','needs_review','rejected')),
        profile_json TEXT NOT NULL,
        embedding_json TEXT,
        model TEXT,
        embedding_model TEXT,
        prompt_version TEXT,
        source_fingerprint TEXT,
        generated_at TEXT NOT NULL,
        based_on_version_id INTEGER,
        validated_at TEXT,
        validation_notes TEXT,
        FOREIGN KEY(based_on_version_id) REFERENCES ai_profile_versions(id),
        UNIQUE(app_id, version_no)
      );
      CREATE INDEX IF NOT EXISTS idx_ai_profile_versions_app ON ai_profile_versions(app_id, version_no DESC);
      CREATE INDEX IF NOT EXISTS idx_ai_profile_versions_quality ON ai_profile_versions(quality_status, lifecycle_state);
      CREATE TABLE IF NOT EXISTS ai_profile_sources (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        profile_version_id INTEGER NOT NULL,
        source_type TEXT NOT NULL,
        source_key TEXT,
        title TEXT,
        url TEXT,
        collected_at TEXT NOT NULL,
        excerpt TEXT,
        supports_json TEXT NOT NULL DEFAULT '[]',
        FOREIGN KEY(profile_version_id) REFERENCES ai_profile_versions(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_ai_sources_version ON ai_profile_sources(profile_version_id);
      CREATE TABLE IF NOT EXISTS ai_profile_field_reviews (
        profile_version_id INTEGER NOT NULL,
        field_path TEXT NOT NULL,
        review_status TEXT NOT NULL CHECK(review_status IN ('unverified','validated','corrected')),
        corrected_value_json TEXT,
        note TEXT,
        updated_at TEXT NOT NULL,
        PRIMARY KEY(profile_version_id, field_path),
        FOREIGN KEY(profile_version_id) REFERENCES ai_profile_versions(id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS ai_analysis_jobs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        app_id TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('queued','running','completed','error','interrupted','cancelled')),
        current_step TEXT,
        message TEXT,
        attempts INTEGER NOT NULL DEFAULT 0,
        error_code TEXT,
        error_detail TEXT,
        requested_at TEXT NOT NULL,
        started_at TEXT,
        finished_at TEXT,
        target_version_id INTEGER,
        FOREIGN KEY(target_version_id) REFERENCES ai_profile_versions(id)
      );
      CREATE INDEX IF NOT EXISTS idx_ai_jobs_app ON ai_analysis_jobs(app_id, id DESC);
      CREATE TABLE IF NOT EXISTS ai_similarity_cache (
        from_app_id TEXT NOT NULL,
        to_app_id TEXT NOT NULL,
        from_version_id INTEGER NOT NULL,
        to_version_id INTEGER NOT NULL,
        score REAL NOT NULL,
        reasons_json TEXT NOT NULL DEFAULT '[]',
        differences_json TEXT NOT NULL DEFAULT '[]',
        dimensions_json TEXT NOT NULL DEFAULT '{}',
        computed_at TEXT NOT NULL,
        PRIMARY KEY(from_app_id, to_app_id, from_version_id, to_version_id)
      );
      CREATE INDEX IF NOT EXISTS idx_ai_similarity_from ON ai_similarity_cache(from_app_id, score DESC);
      CREATE TABLE IF NOT EXISTS ai_similarity_feedback (
        from_app_id TEXT NOT NULL,
        to_app_id TEXT NOT NULL,
        similarity_score INTEGER CHECK(similarity_score BETWEEN 0 AND 3),
        personally_relevant INTEGER CHECK(personally_relevant IN (0,1)),
        reason TEXT,
        updated_at TEXT NOT NULL,
        PRIMARY KEY(from_app_id, to_app_id)
      );
      CREATE TABLE IF NOT EXISTS player_game_experience (
        app_id TEXT PRIMARY KEY,
        liked INTEGER CHECK(liked IN (-1,0,1)),
        overall_rating INTEGER CHECK(overall_rating BETWEEN 1 AND 5),
        dimensions_json TEXT NOT NULL DEFAULT '{}',
        reasons_json TEXT NOT NULL DEFAULT '[]',
        comment TEXT,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS ai_document_dossiers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        app_id TEXT NOT NULL,
        version_no INTEGER NOT NULL,
        quality_status TEXT NOT NULL,
        completeness_score REAL NOT NULL DEFAULT 0,
        dimensions_json TEXT NOT NULL DEFAULT '{}',
        notes_json TEXT NOT NULL DEFAULT '[]',
        source_fingerprint TEXT,
        created_at TEXT NOT NULL,
        based_on_dossier_id INTEGER,
        FOREIGN KEY(based_on_dossier_id) REFERENCES ai_document_dossiers(id),
        UNIQUE(app_id, version_no)
      );
      CREATE INDEX IF NOT EXISTS idx_ai_dossiers_app ON ai_document_dossiers(app_id, version_no DESC);
      CREATE TABLE IF NOT EXISTS ai_document_sources (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        dossier_id INTEGER NOT NULL,
        source_type TEXT NOT NULL,
        source_key TEXT,
        title TEXT,
        url TEXT,
        collected_at TEXT NOT NULL,
        excerpt TEXT,
        supports_json TEXT NOT NULL DEFAULT '[]',
        confidence TEXT,
        relevance_score REAL,
        retrieval_status TEXT,
        FOREIGN KEY(dossier_id) REFERENCES ai_document_dossiers(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_ai_document_sources_dossier ON ai_document_sources(dossier_id);
    `);
    this.ensureColumn('ai_profile_versions','document_quality','TEXT');
    this.ensureColumn('ai_profile_versions','completeness_score','REAL');
    this.ensureColumn('ai_profile_versions','provenance_json',"TEXT NOT NULL DEFAULT '{}'");
    this.ensureColumn('ai_profile_versions','profile_schema_version',"TEXT NOT NULL DEFAULT 'legacy'");
    this.ensureColumn('ai_profile_versions','profile_quality','TEXT');
    this.ensureColumn('ai_profile_versions','profile_completeness_score','REAL');
    this.ensureColumn('ai_profile_versions','semantic_quality_score','REAL');
    this.ensureColumn('ai_profile_versions','evidence_coverage','REAL');
    this.ensureColumn('ai_profile_sources','confidence','TEXT');
    this.ensureColumn('ai_profile_sources','relevance_score','REAL');
    this.ensureColumn('ai_profile_sources','retrieval_status','TEXT');
    this.ensureColumn('ai_analysis_jobs','operation',"TEXT NOT NULL DEFAULT 'full'");
    this.db.prepare(`UPDATE ai_analysis_jobs SET status='interrupted', message='Traitement interrompu par un redémarrage', finished_at=? WHERE status='running'`).run(now());
    this.importLegacyProfiles();
    this.setMeta('schema_version', '0.9.2');
  }

  migrateLegacyDocumentSources() {
    if (!this.tableNames().includes('ai_document_sources')) return;
    if (this.columns('ai_document_sources').some((name) => name.toLowerCase() === 'dossier_id')) return;

    const baseName = 'ai_document_sources_legacy_v090';
    let legacyName = baseName;
    let suffix = 2;
    const tables = new Set(this.tableNames());
    while (tables.has(legacyName)) legacyName = `${baseName}_${suffix++}`;
    const count = Number(this.db.prepare('SELECT COUNT(*) AS count FROM ai_document_sources').get().count || 0);

    this.transaction(() => {
      this.db.exec(`ALTER TABLE ${qid('ai_document_sources')} RENAME TO ${qid(legacyName)}`);
      this.setMeta('legacy_document_sources_table', legacyName);
      this.setMeta('legacy_document_sources_count', String(count));
      this.setMeta('legacy_document_sources_migrated_at', now());
    });
    this.logger.info?.(`Ancienne table ai_document_sources conservée sous ${legacyName} (${count} ligne(s)).`);
  }

  ensureColumn(table, column, declaration) {
    if (this.columns(table).some((name) => name.toLowerCase() === column.toLowerCase())) return;
    this.db.exec(`ALTER TABLE ${qid(table)} ADD COLUMN ${qid(column)} ${declaration}`);
  }

  tableNames() {
    return this.db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name`).all().map((r) => r.name);
  }

  columns(table) {
    return this.db.prepare(`PRAGMA table_info(${qid(table)})`).all().map((row) => row.name);
  }

  findColumn(columns, candidates) {
    const lower = new Map(columns.map((column) => [column.toLowerCase(), column]));
    for (const candidate of candidates) if (lower.has(candidate.toLowerCase())) return lower.get(candidate.toLowerCase());
    return null;
  }

  setMeta(key, value) {
    this.db.prepare(`INSERT INTO ai_v09_meta(key,value,updated_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at`).run(key, String(value), now());
  }

  getMeta(key) {
    return this.db.prepare('SELECT value FROM ai_v09_meta WHERE key=?').get(key)?.value || null;
  }

  importLegacyProfiles() {
    if (this.getMeta('legacy_import_v1') === 'done') return;
    const ignored = new Set(['ai_profile_versions','ai_profile_sources','ai_profile_field_reviews','ai_analysis_jobs','ai_similarity_cache','ai_similarity_feedback','ai_v09_meta','ai_document_dossiers','ai_document_sources','player_game_experience']);
    let imported = 0;
    let importedSources = 0;
    this.transaction(() => {
      for (const table of this.tableNames()) {
        if (ignored.has(table) || !/ai|profile/i.test(table)) continue;
        const columns = this.columns(table);
        const appId = this.findColumn(columns, APP_ID_COLUMNS);
        const profile = this.findColumn(columns, PROFILE_COLUMNS);
        if (!appId || !profile) continue;
        const embedding = this.findColumn(columns, EMBEDDING_COLUMNS);
        const model = this.findColumn(columns, ['model','analysis_model']);
        const prompt = this.findColumn(columns, ['prompt_version','schema_version']);
        const created = this.findColumn(columns, ['generated_at','created_at','updated_at','analyzed_at']);
        const select = [appId, profile, embedding, model, prompt, created].filter(Boolean).map(qid).join(', ');
        let rows;
        try { rows = this.db.prepare(`SELECT ${select} FROM ${qid(table)} WHERE ${qid(profile)} IS NOT NULL`).all(); }
        catch { continue; }
        for (const row of rows) {
          const id = String(row[appId] ?? '').trim();
          const value = parseJson(row[profile]);
          if (!id || !value || this.getActiveProfile(id)) continue;
          this.insertProfileVersion({
            appId: id,
            profile: value,
            embedding: embedding ? parseJson(row[embedding]) : null,
            model: model ? row[model] : 'import-v0.8',
            promptVersion: prompt ? row[prompt] : 'legacy',
            generatedAt: created ? row[created] : now(),
            lifecycleState: 'active', qualityStatus: 'generated'
          });
          imported += 1;
        }
      }
      for (const table of this.tableNames()) {
        if (ignored.has(table) || !/source|document/i.test(table)) continue;
        const columns = this.columns(table);
        const appId = this.findColumn(columns, APP_ID_COLUMNS);
        if (!appId) continue;
        const type = this.findColumn(columns, ['source_type','type','provider']);
        const key = this.findColumn(columns, ['source_key','key','external_id']);
        const title = this.findColumn(columns, ['title','name']);
        const url = this.findColumn(columns, ['url','source_url']);
        const collected = this.findColumn(columns, ['collected_at','created_at','updated_at']);
        const excerpt = this.findColumn(columns, ['excerpt','content','text','snippet']);
        const supports = this.findColumn(columns, ['supports_json','fields_json','supports']);
        let rows;
        try { rows = this.db.prepare(`SELECT * FROM ${qid(table)}`).all(); } catch { continue; }
        const insert = this.db.prepare(`INSERT INTO ai_profile_sources(profile_version_id,source_type,source_key,title,url,collected_at,excerpt,supports_json) VALUES(?,?,?,?,?,?,?,?)`);
        for (const row of rows) {
          const profile = this.getActiveProfile(String(row[appId] ?? ''));
          if (!profile) continue;
          insert.run(profile.id,type ? String(row[type] || 'legacy') : 'legacy',key ? row[key] : null,title ? row[title] : null,url ? row[url] : null,collected ? row[collected] : now(),excerpt ? row[excerpt] : null,json(supports ? parseJson(row[supports],[]) : []));
          importedSources += 1;
        }
      }
      this.setMeta('legacy_import_v1', 'done');
      this.setMeta('legacy_import_count', imported);
      this.setMeta('legacy_source_import_count', importedSources);
      this.setMeta('schema_version', '0.9.2');
    });
    if (imported) this.logger.info?.(`Migration V0.9 : ${imported} profil(s) V0.8 importé(s) sans suppression.`);
  }

  discoverLibrarySource() {
    if (this.librarySource) return this.librarySource;
    const excluded = /^ai_|^sqlite_/i;
    const candidates = [];
    for (const table of this.tableNames()) {
      if (excluded.test(table)) continue;
      const columns = this.columns(table);
      const appId = this.findColumn(columns, APP_ID_COLUMNS);
      const name = this.findColumn(columns, NAME_COLUMNS);
      if (!appId || !name) continue;
      const score = (/games?|library/i.test(table) ? 10 : 0) + columns.length;
      candidates.push({ table, columns, appId, name, score });
    }
    candidates.sort((a,b) => b.score - a.score);
    this.librarySource = candidates[0] || null;
    return this.librarySource;
  }

  normalizeGame(row, source) {
    const get = (names, fallback = null) => {
      const column = this.findColumn(source.columns, names);
      return column ? row[column] : fallback;
    };
    const providerValue = get(['provider_cache','provider_cache_json','providers_json'], null);
    const providerCache = parseJson(providerValue, []);
    const providers = Array.isArray(providerCache) ? providerCache : Object.values(providerCache || {});
    const providerGenres = providers.flatMap((provider) => Array.isArray(provider?.genres) ? provider.genres : []);
    const providerThemes = providers.flatMap((provider) => Array.isArray(provider?.themes) ? provider.themes : []);
    const providerPlatforms = providers.flatMap((provider) => Array.isArray(provider?.platforms) ? provider.platforms : []);
    const merge = (primary, secondary) => [...new Set([...(primary || []), ...(secondary || [])].filter(Boolean).map(String))];
    return {
      appId: String(row[source.appId]),
      name: String(row[source.name] || `App ${row[source.appId]}`),
      displayName: get(['display_name','displayName'], null),
      playtimeMinutes: Number(get(['playtime_forever','playtime_minutes','playtime'], 0) || 0),
      lastPlayedAt: get(['rtime_last_played','last_played_at','last_played'], null),
      genres: merge(parseJson(get(['genres_json','genres'], '[]'), String(get(['genres'], '')).split(',').map((v)=>v.trim()).filter(Boolean)), providerGenres),
      themes: merge(parseJson(get(['themes_json','themes'], '[]'), []), providerThemes),
      platforms: merge(parseJson(get(['platforms_json','platforms'], '[]'), []), providerPlatforms),
      applicationType: get(['application_type','type'], null),
      coverUrl: get(['cover_url','header_image','image_url'], `https://cdn.akamai.steamstatic.com/steam/apps/${row[source.appId]}/header.jpg`),
      raw: row
    };
  }

  getGame(appId) {
    const source = this.discoverLibrarySource();
    if (!source) return null;
    const row = this.db.prepare(`SELECT * FROM ${qid(source.table)} WHERE CAST(${qid(source.appId)} AS TEXT)=? LIMIT 1`).get(String(appId));
    return row ? this.normalizeGame(row, source) : null;
  }

  listGames({ query = '', aiStatus = 'all', limit = 60, offset = 0 } = {}) {
    const source = this.discoverLibrarySource();
    if (!source) return { items: [], total: 0, source: null };
    const where = [];
    const params = [];
    const pageSize = Math.min(500, Math.max(1, Number(limit) || 60));
    const pageOffset = Math.max(0, Number(offset) || 0);
    if (query) { where.push(`LOWER(COALESCE(${qid(source.name)},'')) LIKE ?`); params.push(`%${query.toLowerCase()}%`); }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    if (aiStatus && aiStatus !== 'all') {
      const rows = this.db.prepare(`SELECT * FROM ${qid(source.table)} ${whereSql} ORDER BY LOWER(${qid(source.name)})`).all(...params);
      const filtered = rows.map((row) => this.attachAiState(this.normalizeGame(row, source))).filter((game) => aiStatus === 'profiled' ? game.aiStatus !== 'not_analyzed' : game.aiStatus === aiStatus);
      return { items: filtered.slice(pageOffset, pageOffset + pageSize), total: filtered.length, source: source.table };
    }
    const rows = this.db.prepare(`SELECT * FROM ${qid(source.table)} ${whereSql} ORDER BY LOWER(${qid(source.name)}) LIMIT ? OFFSET ?`).all(...params, pageSize, pageOffset);
    const total = this.db.prepare(`SELECT COUNT(*) AS count FROM ${qid(source.table)} ${whereSql}`).get(...params).count;
    return { items: rows.map((row) => this.attachAiState(this.normalizeGame(row, source))), total: Number(total), source: source.table };
  }

  attachAiState(game) {
    const active = this.getActiveProfile(game.appId);
    const draft = this.db.prepare(`SELECT * FROM ai_profile_versions WHERE app_id=? AND lifecycle_state='draft' ORDER BY version_no DESC LIMIT 1`).get(game.appId);
    const job = this.latestJob(game.appId);
    const displayed = draft || active;
    let aiStatus = active ? (active.quality_status === 'validated' ? 'validated' : 'ready') : 'not_analyzed';
    const profileQuality = displayed?.profile_quality || null;
    if (profileQuality === 'insufficient' || displayed?.document_quality === 'insufficient') aiStatus = 'insufficient';
    else if (profileQuality === 'partial' || displayed?.document_quality === 'partial') aiStatus = 'partial';
    else if (draft) aiStatus = 'ready';
    if (job?.status === 'queued') aiStatus = 'reanalysis_requested';
    if (job?.status === 'running') aiStatus = 'analyzing';
    if (job?.status === 'error') aiStatus = 'error';
    const dossier = this.getLatestDossier(game.appId);
    return { ...game, aiStatus, activeProfileVersion: active?.version_no || null, draftProfileVersion: draft?.version_no || null, documentQuality: displayed?.document_quality || dossier?.quality_status || null, documentCompleteness: displayed?.completeness_score ?? dossier?.completeness_score ?? null, profileQuality: displayed?.profile_quality || (displayed?.profile_schema_version === 'legacy' ? 'legacy' : null), profileCompleteness: displayed?.profile_completeness_score ?? null, semanticQuality: displayed?.semantic_quality_score ?? null, evidenceCoverage: displayed?.evidence_coverage ?? null, profileSchemaVersion: displayed?.profile_schema_version || 'legacy', dossierVersion: dossier?.version_no || null, lastJob: job || null };
  }

  getDashboard() {
    const source = this.discoverLibrarySource();
    const totalGames = source ? Number(this.db.prepare(`SELECT COUNT(*) AS count FROM ${qid(source.table)}`).get().count) : 0;
    const profileCounts = this.db.prepare(`SELECT quality_status, COUNT(DISTINCT app_id) AS count FROM ai_profile_versions WHERE lifecycle_state IN ('active','draft') GROUP BY quality_status`).all();
    const jobCounts = this.db.prepare(`SELECT status, COUNT(*) AS count FROM ai_analysis_jobs WHERE id IN (SELECT MAX(id) FROM ai_analysis_jobs GROUP BY app_id) GROUP BY status`).all();
    const counts = Object.fromEntries(profileCounts.map((r)=>[r.quality_status,Number(r.count)]));
    const jobs = Object.fromEntries(jobCounts.map((r)=>[r.status,Number(r.count)]));
    const profiled = Number(this.db.prepare(`SELECT COUNT(DISTINCT app_id) AS count FROM ai_profile_versions WHERE lifecycle_state IN ('active','draft')`).get().count);
    const latest = this.db.prepare(`SELECT generated_at, model, prompt_version FROM ai_profile_versions ORDER BY generated_at DESC LIMIT 1`).get() || null;
    const feedback = Number(this.db.prepare(`SELECT (SELECT COUNT(*) FROM ai_similarity_feedback) + (SELECT COUNT(*) FROM player_game_experience) AS count`).get().count);
    const documentQuality = Object.fromEntries(this.db.prepare(`SELECT COALESCE(document_quality,'legacy') AS status, COUNT(DISTINCT app_id) AS count FROM ai_profile_versions WHERE lifecycle_state IN ('active','draft') GROUP BY COALESCE(document_quality,'legacy')`).all().map((row)=>[row.status,Number(row.count)]));
    const profileQuality = Object.fromEntries(this.db.prepare(`SELECT COALESCE(profile_quality,'legacy') AS status, COUNT(DISTINCT app_id) AS count FROM ai_profile_versions WHERE lifecycle_state IN ('active','draft') GROUP BY COALESCE(profile_quality,'legacy')`).all().map((row)=>[row.status,Number(row.count)]));
    return { totalGames, profiled, ready: (counts.generated||0)+(counts.needs_review||0), validated: counts.validated||0, insufficient: profileQuality.insufficient||0, partial: profileQuality.partial||0, complete: profileQuality.complete||0, legacyProfiles: profileQuality.legacy||0, documentQuality, errors: jobs.error||0, analyzing: jobs.running||0, queued: jobs.queued||0, notAnalyzed: Math.max(0,totalGames-profiled), feedback, latest };
  }

  getActiveProfile(appId) {
    return this.db.prepare(`SELECT * FROM ai_profile_versions WHERE app_id=? AND lifecycle_state='active' ORDER BY version_no DESC LIMIT 1`).get(String(appId)) || null;
  }

  getProfileBundle(appId) {
    const active = this.getActiveProfile(appId);
    const draft = this.db.prepare(`SELECT * FROM ai_profile_versions WHERE app_id=? AND lifecycle_state='draft' ORDER BY version_no DESC LIMIT 1`).get(String(appId)) || null;
    const version = draft || active;
    if (!version) return null;
    return {
      active: active ? this.hydrateVersion(active) : null,
      candidate: draft ? this.hydrateVersion(draft) : null,
      displayed: this.hydrateVersion(version),
      dossier: this.getLatestDossier(appId)
    };
  }

  hydrateVersion(row) {
    const sources = this.db.prepare(`SELECT * FROM ai_profile_sources WHERE profile_version_id=? ORDER BY source_type,title`).all(row.id).map((source)=>({...source,supports:parseJson(source.supports_json,[])}));
    const fieldReviews = this.db.prepare(`SELECT * FROM ai_profile_field_reviews WHERE profile_version_id=? ORDER BY field_path`).all(row.id).map((review)=>({...review,correctedValue:parseJson(review.corrected_value_json)}));
    return { ...row, profile: parseJson(row.profile_json,{}), embedding: parseJson(row.embedding_json), provenance: parseJson(row.provenance_json,{}), sources, fieldReviews };
  }

  insertProfileVersion({ appId, profile, embedding = null, sources = [], model = null, embeddingModel = null, promptVersion = null, generatedAt = now(), basedOnVersionId = null, lifecycleState = 'draft', qualityStatus = 'generated', documentQuality = null, completenessScore = null, profileSchemaVersion = null, profileQuality = null, profileCompletenessScore = null, semanticQualityScore = null, evidenceCoverage = null, provenance = {}, sourceFingerprint = null }) {
    const next = Number(this.db.prepare(`SELECT COALESCE(MAX(version_no),0)+1 AS next FROM ai_profile_versions WHERE app_id=?`).get(String(appId)).next);
    const result = this.db.prepare(`INSERT INTO ai_profile_versions(app_id,version_no,lifecycle_state,quality_status,profile_json,embedding_json,model,embedding_model,prompt_version,source_fingerprint,generated_at,based_on_version_id,document_quality,completeness_score,profile_schema_version,profile_quality,profile_completeness_score,semantic_quality_score,evidence_coverage,provenance_json) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(String(appId),next,lifecycleState,qualityStatus,json(profile),embedding?json(embedding):null,model,embeddingModel,promptVersion,sourceFingerprint,generatedAt,basedOnVersionId,documentQuality,completenessScore,profileSchemaVersion||profile?.schema_version||'legacy',profileQuality,profileCompletenessScore,semanticQualityScore,evidenceCoverage,json(provenance||{}));
    const id = Number(result.lastInsertRowid);
    const insertSource = this.db.prepare(`INSERT INTO ai_profile_sources(profile_version_id,source_type,source_key,title,url,collected_at,excerpt,supports_json,confidence,relevance_score,retrieval_status) VALUES(?,?,?,?,?,?,?,?,?,?,?)`);
    for (const source of sources) insertSource.run(id,source.sourceType||source.source_type||'unknown',source.sourceKey||source.source_key||null,source.title||null,source.url||null,source.collectedAt||source.collected_at||now(),source.excerpt||null,json(source.supports||[]),source.confidence||null,source.relevanceScore??source.relevance_score??null,source.retrievalStatus||source.retrieval_status||null);
    return this.hydrateVersion(this.db.prepare(`SELECT * FROM ai_profile_versions WHERE id=?`).get(id));
  }

  reviewProfile(id, { action, notes = '' }) {
    const profile = this.db.prepare(`SELECT * FROM ai_profile_versions WHERE id=?`).get(Number(id));
    if (!profile) return null;
    if ((action === 'validate' || action === 'activate') && (profile.document_quality === 'insufficient' || profile.profile_quality === 'insufficient')) throw Object.assign(new Error(profile.profile_quality === 'insufficient' ? 'Validation refusée : le profil est sémantiquement insuffisant' : 'Validation refusée : le profil est insuffisamment documenté'),{statusCode:409});
    return this.transaction(() => {
      if (action === 'validate' || action === 'activate') {
        this.db.prepare(`UPDATE ai_profile_versions SET lifecycle_state='superseded' WHERE app_id=? AND lifecycle_state='active' AND id<>?`).run(profile.app_id,profile.id);
        this.db.prepare(`UPDATE ai_profile_versions SET lifecycle_state='active', quality_status='validated', validated_at=?, validation_notes=? WHERE id=?`).run(now(),notes,profile.id);
      } else if (action === 'needs_review') {
        this.db.prepare(`UPDATE ai_profile_versions SET quality_status='needs_review', validation_notes=? WHERE id=?`).run(notes,profile.id);
      } else if (action === 'reject') {
        this.db.prepare(`UPDATE ai_profile_versions SET lifecycle_state='rejected', quality_status='rejected', validation_notes=? WHERE id=?`).run(notes,profile.id);
      } else throw new Error('Action de révision invalide');
      return this.hydrateVersion(this.db.prepare(`SELECT * FROM ai_profile_versions WHERE id=?`).get(profile.id));
    });
  }

  saveFieldReview(versionId, fieldPath, { status, correctedValue = null, note = '' }) {
    this.db.prepare(`INSERT INTO ai_profile_field_reviews(profile_version_id,field_path,review_status,corrected_value_json,note,updated_at) VALUES(?,?,?,?,?,?) ON CONFLICT(profile_version_id,field_path) DO UPDATE SET review_status=excluded.review_status, corrected_value_json=excluded.corrected_value_json, note=excluded.note, updated_at=excluded.updated_at`).run(Number(versionId),fieldPath,status,correctedValue==null?null:json(correctedValue),note,now());
    return this.db.prepare(`SELECT * FROM ai_profile_field_reviews WHERE profile_version_id=? AND field_path=?`).get(Number(versionId),fieldPath);
  }

  insertDossier(appId, dossier) {
    const previous = this.db.prepare(`SELECT * FROM ai_document_dossiers WHERE app_id=? ORDER BY version_no DESC LIMIT 1`).get(String(appId));
    const versionNo = Number(previous?.version_no || 0) + 1;
    return this.transaction(() => {
      const result = this.db.prepare(`INSERT INTO ai_document_dossiers(app_id,version_no,quality_status,completeness_score,dimensions_json,notes_json,source_fingerprint,created_at,based_on_dossier_id) VALUES(?,?,?,?,?,?,?,?,?)`).run(String(appId),versionNo,dossier.quality_status||'insufficient',Number(dossier.completeness_score||0),json(dossier.dimensions||{}),json(dossier.notes||[]),dossier.source_fingerprint||null,dossier.created_at||now(),previous?.id||null);
      const id = Number(result.lastInsertRowid);
      const insert = this.db.prepare(`INSERT INTO ai_document_sources(dossier_id,source_type,source_key,title,url,collected_at,excerpt,supports_json,confidence,relevance_score,retrieval_status) VALUES(?,?,?,?,?,?,?,?,?,?,?)`);
      for (const source of dossier.sources||[]) insert.run(id,source.sourceType||source.source_type||'unknown',source.sourceKey||source.source_key||null,source.title||null,source.url||null,source.collectedAt||source.collected_at||now(),source.excerpt||null,json(source.supports||[]),source.confidence||null,source.relevanceScore??source.relevance_score??null,source.retrievalStatus||source.retrieval_status||null);
      return this.getDossier(id);
    });
  }

  getDossier(id) {
    const row=this.db.prepare(`SELECT * FROM ai_document_dossiers WHERE id=?`).get(Number(id));
    if(!row)return null;
    const sources=this.db.prepare(`SELECT * FROM ai_document_sources WHERE dossier_id=? ORDER BY relevance_score DESC, source_type, title`).all(row.id).map((source)=>({...source,supports:parseJson(source.supports_json,[])}));
    return {...row,dimensions:parseJson(row.dimensions_json,{}),notes:parseJson(row.notes_json,[]),sources};
  }

  getLatestDossier(appId) {
    const row=this.db.prepare(`SELECT id FROM ai_document_dossiers WHERE app_id=? ORDER BY version_no DESC LIMIT 1`).get(String(appId));
    return row?this.getDossier(row.id):null;
  }

  updateProfileEmbedding(id, embedding, embeddingModel) {
    this.db.prepare(`UPDATE ai_profile_versions SET embedding_json=?, embedding_model=? WHERE id=?`).run(json(embedding),embeddingModel||null,Number(id));
    return this.hydrateVersion(this.db.prepare(`SELECT * FROM ai_profile_versions WHERE id=?`).get(Number(id)));
  }

  history(appId) {
    return this.db.prepare(`SELECT id,app_id,version_no,lifecycle_state,quality_status,document_quality,completeness_score,profile_schema_version,profile_quality,profile_completeness_score,semantic_quality_score,evidence_coverage,model,embedding_model,prompt_version,generated_at,based_on_version_id,validated_at,validation_notes FROM ai_profile_versions WHERE app_id=? ORDER BY version_no DESC`).all(String(appId));
  }

  createJob(appId, operation = 'full') {
    const current = this.latestJob(appId);
    if (current && ['queued','running'].includes(current.status)) return current;
    if (!['full','documents','analysis','embedding'].includes(operation)) throw new Error('Opération IA invalide');
    const result = this.db.prepare(`INSERT INTO ai_analysis_jobs(app_id,status,current_step,message,attempts,requested_at,operation) VALUES(?,'queued','queued',?,0,?,?)`).run(String(appId),operation==='full'?'Réanalyse complète demandée':`Opération ${operation} demandée`,now(),operation);
    return this.db.prepare(`SELECT * FROM ai_analysis_jobs WHERE id=?`).get(Number(result.lastInsertRowid));
  }

  latestJob(appId) { return this.db.prepare(`SELECT * FROM ai_analysis_jobs WHERE app_id=? ORDER BY id DESC LIMIT 1`).get(String(appId)) || null; }
  getJob(id) { return this.db.prepare(`SELECT * FROM ai_analysis_jobs WHERE id=?`).get(Number(id)) || null; }
  nextQueuedJob() { return this.db.prepare(`SELECT * FROM ai_analysis_jobs WHERE status='queued' ORDER BY id LIMIT 1`).get() || null; }
  updateJob(id, patch) {
    const allowed = ['status','current_step','message','attempts','error_code','error_detail','started_at','finished_at','target_version_id'];
    const entries = Object.entries(patch).filter(([key])=>allowed.includes(key));
    if (!entries.length) return this.getJob(id);
    const sql = entries.map(([key])=>`${key}=?`).join(', ');
    this.db.prepare(`UPDATE ai_analysis_jobs SET ${sql} WHERE id=?`).run(...entries.map(([,value])=>value),Number(id));
    return this.getJob(id);
  }

  listErrors(limit=100) {
    return this.db.prepare(`SELECT * FROM ai_analysis_jobs WHERE status='error' ORDER BY finished_at DESC LIMIT ?`).all(Math.min(500,Number(limit)||100));
  }

  replaceSimilarities(appId, versionId, candidates) {
    this.transaction(() => {
      this.db.prepare(`DELETE FROM ai_similarity_cache WHERE from_app_id=? AND from_version_id=?`).run(String(appId),Number(versionId));
      const statement = this.db.prepare(`INSERT INTO ai_similarity_cache(from_app_id,to_app_id,from_version_id,to_version_id,score,reasons_json,differences_json,dimensions_json,computed_at) VALUES(?,?,?,?,?,?,?,?,?)`);
      for (const item of candidates) statement.run(String(appId),String(item.appId),Number(versionId),Number(item.versionId),item.score,json(item.reasons||[]),json(item.differences||[]),json(item.dimensions||{}),now());
    });
  }

  similarities(appId) {
    return this.db.prepare(`SELECT s.*, f.similarity_score, f.personally_relevant, f.reason AS feedback_reason FROM ai_similarity_cache s LEFT JOIN ai_similarity_feedback f ON f.from_app_id=s.from_app_id AND f.to_app_id=s.to_app_id WHERE s.from_app_id=? ORDER BY s.score DESC LIMIT 20`).all(String(appId)).map((row)=>({...row,reasons:parseJson(row.reasons_json,[]),differences:parseJson(row.differences_json,[]),dimensions:parseJson(row.dimensions_json,{})}));
  }

  saveSimilarityFeedback({ fromAppId, toAppId, similarityScore = null, personallyRelevant = null, reason = '' }) {
    this.db.prepare(`INSERT INTO ai_similarity_feedback(from_app_id,to_app_id,similarity_score,personally_relevant,reason,updated_at) VALUES(?,?,?,?,?,?) ON CONFLICT(from_app_id,to_app_id) DO UPDATE SET similarity_score=excluded.similarity_score, personally_relevant=excluded.personally_relevant, reason=excluded.reason, updated_at=excluded.updated_at`).run(String(fromAppId),String(toAppId),similarityScore,personallyRelevant==null?null:(personallyRelevant?1:0),reason,now());
    return this.db.prepare(`SELECT * FROM ai_similarity_feedback WHERE from_app_id=? AND to_app_id=?`).get(String(fromAppId),String(toAppId));
  }

  getExperience(appId) {
    const row = this.db.prepare(`SELECT * FROM player_game_experience WHERE app_id=?`).get(String(appId));
    return row ? {...row,dimensions:parseJson(row.dimensions_json,{}),reasons:parseJson(row.reasons_json,[])} : null;
  }

  saveExperience(appId, { liked = 0, overallRating = null, dimensions = {}, reasons = [], comment = '' }) {
    this.db.prepare(`INSERT INTO player_game_experience(app_id,liked,overall_rating,dimensions_json,reasons_json,comment,updated_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT(app_id) DO UPDATE SET liked=excluded.liked, overall_rating=excluded.overall_rating, dimensions_json=excluded.dimensions_json, reasons_json=excluded.reasons_json, comment=excluded.comment, updated_at=excluded.updated_at`).run(String(appId),liked,overallRating,json(dimensions),json(reasons),comment,now());
    return this.getExperience(appId);
  }

  activeEmbeddings(excludeAppId) {
    return this.db.prepare(`SELECT id,app_id,version_no,profile_json,embedding_json FROM ai_profile_versions WHERE lifecycle_state='active' AND embedding_json IS NOT NULL AND app_id<>?`).all(String(excludeAppId)).map((row)=>({...row,profile:parseJson(row.profile_json,{}),embedding:parseJson(row.embedding_json,[])}));
  }
}

module.exports = { BacklogDatabase, resolveDatabasePath, parseJson };
