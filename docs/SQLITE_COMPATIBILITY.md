# Compatibilité SQLite V1.0

Cette version ne transforme pas le modèle métier. Au démarrage, elle vérifie la présence des colonnes V1.0 connues :

- `games`: `app_id TEXT`, `title`, `studio`, `genres`, `cover_url`, `description`, `playtime_minutes`, `last_played_at`, `inventory_metadata_json`, `source_table`, `imported_at`, `updated_at`;
- `profiles`: structure V1.0 avec `analysis_model`, `embedding_model`, `confidence`;
- `discovery_feedback`: clé composée `reference_app_id`, `candidate_app_id`, `motivation_key`;
- `discovery_sessions`: sessions et résultats existants.

Deux tables isolées sont ajoutées :

- `core_background_campaign`: état global, demande de pause et jeu en cours;
- `core_background_queue`: état, étape, tentatives et erreur par jeu.

Elles n'ont volontairement aucune clé étrangère vers les tables historiques : la migration est additive et ne force aucune reconstruction de table SQLite.
