# Migration SQLite V1.0 → V1.1.1

## Table `games`

| V1.0 | V1.1.1 | Règle |
|---|---|---|
| `app_id TEXT` | `app_id INTEGER` | validation numérique, détection de collision, conversion transactionnelle |
| `title` | `name` | valeur conservée |
| `studio` | `developer` | valeur conservée |
| `genres` | `genres` | valeur conservée |
| `cover_url` | `cover_url` | valeur conservée |
| `description` | `description` | conservée comme extension compatible |
| `playtime_minutes` | `playtime_minutes` | valeur conservée |
| `last_played_at` | `last_played_at` | conservée comme extension compatible |
| `inventory_metadata_json` | même nom | conservée comme extension compatible |
| `source_table` | `source_table` + `source` | valeur conservée et réutilisée comme source |
| `imported_at` | `imported_at` | valeur conservée |
| `updated_at` | `updated_at` | valeur conservée |

Aucun App ID non numérique n’est converti arbitrairement en `0`. Dans ce cas, la migration échoue explicitement et la transaction est annulée.

## Autres tables

- `profiles` : les lignes sont conservées ; les colonnes attendues manquantes sont ajoutées sans supprimer les colonnes héritées.
- `enrichment_campaign` : l’état, les dates, le jeu courant, l’étape et la dernière erreur sont conservés.
- `enrichment_jobs` : statuts, tentatives, erreurs et durées sont conservés. Une tâche interrompue en `processing` est replacée en attente au redémarrage.
- `discovery_feedback` : motivations, verdicts et notes sont conservés.
- `discovery_sessions` : table laissée intacte.
- `enrichment_items`, `enrichment_runs`, `meta`, `work_batch` : tables laissées intactes.
- `schema_migrations` : entrée `10101` ajoutée une seule fois.

## Atomicité

La migration utilise `BEGIN IMMEDIATE`. La reconstruction de `games`, l’adaptation des tables Core, les index et le journal de migration appartiennent à une même transaction. `quick_check` et `foreign_key_check` s’exécutent avant `COMMIT`.

La sauvegarde `VACUUM INTO` est créée avant la transaction et capture aussi les données présentes dans le WAL.

## Limites volontaires

- Un App ID Steam doit être un entier positif représentable sans perte.
- Une table Core existante sans identifiant essentiel (`profiles.app_id`, `enrichment_jobs.app_id`, etc.) provoque un arrêt explicite plutôt qu’une reconstruction spéculative.
- Les anciennes tables sont conservées pour permettre diagnostic et retour arrière ; elles ne sont pas supprimées automatiquement.
