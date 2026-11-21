# Backlog Core V1.1.2 — enrichissement autonome compatible V1.0

Cette version reprend **le contrat SQLite réel de Backlog Core V1.0** et y ajoute l'enrichissement global en arrière-plan. Elle ne convertit pas les identifiants Steam, ne renomme aucune colonne et ne remplace aucune table métier.

## Garanties de compatibilité

Les structures V1.0 restent la source de vérité :

- `games.app_id TEXT`, `games.title`, `games.studio` et toutes les métadonnées existantes ;
- `profiles` avec `profile_json`, `embedding_json`, `source_json`, modèles et confiance ;
- `discovery_feedback` avec la clé `(reference_app_id, candidate_app_id, motivation_key)` ;
- `discovery_sessions` avec motivations et résultats JSON.

Seules deux tables sont ajoutées :

- `autonomous_enrichment_control` : intention et état durable de la campagne ;
- `autonomous_enrichment_items` : progression, tentatives et erreurs par jeu.

Aucune table V1.0 n'est altérée. Les anciennes tables d'enrichissement sont laissées intactes.

## Fonctionnement

- Bibliothèque et enrichissement sont réunis.
- Toute la bibliothèque est mise en file sans sélection manuelle ni limite arbitraire.
- Le serveur traite séquentiellement les jeux, indépendamment du navigateur.
- Un redémarrage Docker remet en attente le seul jeu interrompu et reprend la campagne si elle était active.
- Les profils déjà présents ne sont jamais retraités.
- Un échec est isolé ; les autres jeux continuent. Les erreurs se relancent explicitement.
- Les profils terminés deviennent immédiatement disponibles dans Découverte.
- Aucun catalogue externe n'est créé : seuls les jeux de la bibliothèque sont candidats.

## Déploiement GitHub Actions → GHCR → Dockge

1. Décompressez l'archive à la racine de votre dépôt GitHub.
2. Poussez sur `main`. Le workflow exécute les tests et publie `ghcr.io/<propriétaire>/backlog:latest`.
3. Dans Dockge, copiez `compose.yaml` et créez `.env` depuis `.env.example`.
4. Réutilisez **exactement le même `DATA_PATH`** que V1.0.
5. Avant `Up`, effectuez une sauvegarde cohérente de `backlog-core.sqlite`.
6. Faites `Pull`, puis `Up`.
7. Vérifiez `/api/health`, le nombre de jeux et quelques profils avant de démarrer la campagne.

Exemple local :

```bash
cp .env.example .env
# Éditer DATA_PATH, IMAGE et OLLAMA_BASE_URL
set -a; . ./.env; set +a
npm run preflight
npm test
docker compose pull
docker compose up -d
```

## Configuration importante

| Variable | Valeur par défaut | Rôle |
|---|---:|---|
| `DATA_PATH` | obligatoire dans Compose | Dossier NAS contenant les bases |
| `DATABASE_PATH` | `/data/backlog-core.sqlite` | Base Core V1.0 conservée |
| `LEGACY_DATABASE_PATH` | `/data/backlog.sqlite` | Inventaire historique, utilisé uniquement si Core est vide |
| `OLLAMA_BASE_URL` | `http://host.docker.internal:11434` | Serveur Ollama |
| `AI_ANALYSIS_MODEL` | `qwen3:32b` | Modèle d'analyse |
| `AI_EMBEDDING_MODEL` | `embeddinggemma` | Modèle d'embedding |
| `ENRICHMENT_RETRY_LIMIT` | `3` | Tentatives maximales avant relance explicite |

## Sauvegarde et vérification

Dans le conteneur :

```bash
npm run backup
npm run verify-db
```

La sauvegarde utilise l'API SQLite de sauvegarde en ligne et est écrite dans le même dossier que la base. Le contrôle vérifie le contrat V1.0, `quick_check` et les clés étrangères.

## Limites connues

- Les appels Steam et Ollama sont séquentiels par prudence.
- La qualité des profils dépend du modèle Ollama choisi.
- L'interface charge au maximum 500 jeux enrichis dans la liste de référence ; l'API et le moteur n'ont pas cette limite.
- Le moteur Docker n'est pas nécessaire aux tests Node, mais la construction finale sera exécutée par GitHub Actions/GHCR.

Voir aussi [docs/ROLLBACK.md](docs/ROLLBACK.md).
