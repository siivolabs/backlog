# Backlog Core 1.1 — enrichissement global autonome

Backlog Core transforme progressivement **toute la bibliothèque Steam possédée** en un catalogue expérientiel exploitable par un moteur de découverte unique.

Cette version supprime entièrement la sélection de jeux et fusionne la bibliothèque et l’enrichissement dans une même page. Le navigateur sert uniquement à observer et à piloter : la campagne tourne **côté serveur**, dans le conteneur, et continue quand la page ou le PC de consultation sont fermés.

## Ce qui change en 1.1

- Deux pages principales seulement : **Bibliothèque** et **Découverte**.
- Liste complète des jeux et progression globale au même endroit.
- Un seul bouton de démarrage pour tous les jeux non enrichis.
- Suspension après le jeu courant, reprise et relance séparée des échecs.
- État, file, profils et erreurs persistés dans SQLite.
- Reprise automatique d’une campagne `running` après redémarrage Docker.
- Une erreur locale n’arrête pas la campagne globale.
- Un profil validé n’est jamais recalculé par une campagne normale.
- Chaque profil terminé devient immédiatement disponible dans Découverte.
- Un seul pipeline d’enrichissement et un seul moteur de découverte.
- Aucun catalogue externe, aucun réseau permanent de paires, aucun nouvel onglet.

## Architecture

```text
Navigateur (observation/commandes)
              │
              ▼
Serveur Node.js ─── API Bibliothèque + Découverte
              │
              ├── Orchestrateur persistant séquentiel
              │      ├── Steam App Details
              │      ├── Qwen : profil expérientiel compact
              │      └── EmbeddingGemma : vecteur du profil
              │
              └── /data/backlog-core.sqlite
                     ├── inventaire importé
                     ├── file et campagne
                     ├── profils et embeddings
                     └── retours de découverte
```

Le traitement est volontairement séquentiel pour ne pas saturer Ollama. La page interroge l’API toutes les trois secondes ; fermer la page n’a aucun effet sur le worker serveur.

## Données et migration

Au premier démarrage, si la nouvelle base est vide, Core inspecte automatiquement `/data/backlog.sqlite`, identifie la table d’inventaire compatible et importe uniquement :

- AppID Steam ;
- titre ;
- couverture, studio, genres et temps de jeu lorsqu’ils existent.

Il **n’importe aucun ancien profil IA, embedding, réseau ou score**. La base historique reste inchangée. Les nouvelles données sont écrites dans `/data/backlog-core.sqlite`.

L’importeur reconnaît plusieurs variantes usuelles de colonnes (`app_id`, `appid`, `steam_app_id`, `name`, `title`, `header_image`, etc.). Si aucune table compatible n’est trouvée, l’application démarre avec un inventaire vide et l’indique dans les journaux.

## Prérequis

- Un NAS ou serveur compatible Docker/Dockge.
- Le dossier de données historique contenant `backlog.sqlite`.
- Ollama accessible depuis le conteneur.
- Les modèles configurés, par défaut `qwen3:32b` et `embeddinggemma`.
- Pour GHCR : un dépôt GitHub et GitHub Actions activé.

## Publication via GitHub et GHCR

1. Décompressez l’archive dans votre dépôt GitHub, par exemple `siivolabs/backlog-core`.
2. Poussez les fichiers sur la branche `main`.
3. Le workflow `.github/workflows/publish-ghcr.yml` exécute les tests puis publie :
   - `ghcr.io/<propriétaire>/<dépôt>:latest` ;
   - `ghcr.io/<propriétaire>/<dépôt>:sha-…` ;
   - un tag `v…` si vous poussez un tag Git.
4. Si le paquet GHCR est privé, connectez Dockge au registre avec un PAT GitHub disposant de `read:packages`.

Le workflow construit les architectures `linux/amd64` et `linux/arm64`.

## Déploiement via Dockge

Aucun déploiement n’est effectué par ce livrable.

1. Copiez `compose.yml` et `.env.example` dans la pile Dockge.
2. Renommez `.env.example` en `.env`.
3. Réglez au minimum :

```dotenv
BACKLOG_IMAGE=ghcr.io/siivolabs/backlog:latest
DATA_PATH=/volume1/docker/backlog/data
OLLAMA_BASE_URL=http://host.docker.internal:11434
AI_ANALYSIS_MODEL=qwen3:32b
AI_EMBEDDING_MODEL=embeddinggemma
```

4. Vérifiez que l’utilisateur UID 1000 du conteneur peut lire `backlog.sqlite` et écrire dans `DATA_PATH`.
5. Lancez localement, si possible :

```bash
cp .env.example .env
# modifier .env
./scripts/preflight.sh
./scripts/backup-data.sh
```

6. Dans Dockge, faites **Pull**, puis **Up**.
7. Ouvrez `http://ADRESSE_DU_NAS:3000`.
8. Vérifiez le nombre de jeux et quelques titres avant de démarrer l’enrichissement.

### Conservation de l’ancienne installation

Le nom de conteneur par défaut est `backlog-core`. Si l’ancien conteneur utilise déjà ce nom ou le port 3000, changez `CONTAINER_NAME` ou `BACKLOG_PORT`. Ne supprimez ni l’ancien conteneur ni son volume avant validation.

## Cycle de campagne

- **Démarrer** : ajoute à la file tous les jeux sans profil et lance le worker.
- **Suspendre** : laisse le jeu courant terminer, puis arrête la file.
- **Reprendre** : continue les jeux restants.
- **Relancer les échecs** : remet uniquement les jeux échoués en attente.
- **Redémarrage Docker** : un job marqué `processing` est remis en attente ; une campagne `running` repart automatiquement.
- **Fin** : `completed` ou `completed_with_errors` selon le résultat.

Les erreurs sont visibles dans l’interface et détaillées dans les journaux du conteneur :

```bash
docker logs -f backlog-core
```

## API essentielle

| Méthode | Route | Rôle |
|---|---|---|
| GET | `/api/health` | Santé du service |
| GET | `/api/library/stats` | Statistiques globales |
| GET | `/api/library/games` | Bibliothèque paginée et filtrable |
| GET | `/api/games/:appId` | Jeu et profil |
| GET | `/api/enrichment` | État persistant de campagne |
| POST | `/api/enrichment/start` | Démarrer |
| POST | `/api/enrichment/pause` | Suspendre après le jeu courant |
| POST | `/api/enrichment/resume` | Reprendre |
| POST | `/api/enrichment/retry-failures` | Relancer uniquement les échecs |
| POST | `/api/discovery/recommend` | Recherche de résonances |
| POST | `/api/discovery/feedback` | Mémoriser un retour |

## Configuration

| Variable | Défaut | Description |
|---|---|---|
| `CORE_DATABASE_PATH` | `/data/backlog-core.sqlite` | Base Core persistante |
| `LEGACY_DATABASE_PATH` | `/data/backlog.sqlite` | Inventaire historique en lecture seule logique |
| `OLLAMA_BASE_URL` | `http://host.docker.internal:11434` | URL Ollama |
| `AI_ANALYSIS_MODEL` | `qwen3:32b` | Modèle de profil et d’évaluation |
| `AI_EMBEDDING_MODEL` | `embeddinggemma` | Modèle d’embedding |
| `ENRICHMENT_MAX_ATTEMPTS` | `1` | Tentatives automatiques avant état d’erreur |
| `HTTP_TIMEOUT_MS` | `120000` | Délai maximal Ollama |
| `STEAM_TIMEOUT_MS` | `20000` | Délai maximal Steam |
| `DISCOVERY_SHORTLIST` | `20` | Candidats sémantiques évalués par le moteur |
| `DISCOVERY_LIMIT` | `5` | Maximum de recommandations, jamais un minimum |

## Développement et tests

Node.js 24 est recommandé ; aucune dépendance npm externe n’est nécessaire.

```bash
npm run check
npm test
npm start
```

Les tests couvrent : import sans connaissances IA historiques, poursuite après erreur, non-retraitement, suspension/reprise, récupération après redémarrage et disponibilité immédiate d’un nouveau profil dans Découverte.

## Limites connues

- La structure exacte de votre base NAS n’est pas présente dans ce livrable ; l’importeur adaptatif est testé sur une structure représentative. Vérifiez impérativement l’inventaire réel au premier démarrage.
- La collecte Steam peut être limitée ou indisponible. Le pipeline conserve alors les métadonnées de l’inventaire et signale l’incertitude au modèle.
- L’estimation restante repose sur la moyenne des jeux terminés ; elle varie selon Ollama, les tailles de contexte et les délais réseau.
- Le fallback sémantique maintient Découverte utilisable si l’évaluation Qwen échoue, mais l’interface le signale comme une explication dégradée.
