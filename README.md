# Backlog Core V1.2.0

Backlog est une bibliothèque de jeux auto-hébergée qui enrichit localement les métadonnées avec Ollama et aide à faire émerger des expériences déjà possédées.

## Ce que change V1.2

La version 1.2 conserve la bibliothèque, les profils et les embeddings de V1.1.4, puis fiabilise leur exploitation :

1. **Qualité documentaire** — un jeu n’est recommandé que si son profil contient au moins une base substantive (description, résumé ou motivation étayée). La popularité n’entre pas dans ce contrôle.
2. **Deux indicateurs distincts** — la proximité sémantique mesure un voisinage vectoriel ; la fiabilité indique si ce rapprochement est suffisamment documenté.
3. **Renouvellement** — Backlog mémorise les jeux récemment présentés et les dépriorise temporairement. Les refus explicites conservent une pénalité plus forte.
4. **Terminé** — le statut est manuel, indépendant de l’appréciation et réversible. Le jeu reste consultable et utilisable comme référence, mais sort des prochaines propositions.
5. **Surprends-moi** — en l’absence d’envie formulée, Backlog sélectionne des profils étayés, récents et diversifiés.

Backlog peut désormais ne renvoyer aucun résultat plutôt que d’afficher un pourcentage construit sur un profil vide.

## Prérequis

- Docker et Docker Compose, ou Node.js 24+ ;
- un dossier persistant accessible à l’UID 1000 pour SQLite ;
- Ollama accessible depuis le conteneur pour les nouveaux enrichissements et les recherches textuelles ;
- les modèles configurés (par défaut `qwen3:32b` et `embeddinggemma`).

## Déploiement Dockge

1. Sauvegarder le volume SQLite actuel.
2. Copier `.env.example` vers `.env` et définir un `ADMIN_TOKEN` long et aléatoire.
3. Vérifier que le réseau Docker externe `npm_default` existe et que Nginx Proxy Manager pointe vers `backlog-test:3000`.
4. Conserver le même dossier `./data` que la V1.1.4.
5. Dans Dockge : **Pull**, puis **Up**.
6. Ouvrir `/healthz` et vérifier la version `1.2.0`.

```bash
cp .env.example .env
mkdir -p data
sudo chown -R 1000:1000 data
docker compose up -d
curl http://127.0.0.1:3000/healthz
```

Si le service n’est volontairement pas publié sur l’hôte, exécuter le contrôle dans le conteneur ou via le Proxy Host.

## Migration depuis V1.1.4

La migration s’exécute au démarrage et est uniquement additive :

- création de `game_user_state` pour le statut Terminé ;
- création de `recommendation_history` pour le renouvellement ;
- ajout uniquement des colonnes manquantes aux tables `games` et `profiles` ;
- récupération des tâches d’enrichissement restées `running` depuis plus de 30 minutes.

Aucun profil ni embedding existant n’est supprimé. **Faire malgré tout une sauvegarde du fichier SQLite avant le premier démarrage.**

## Utilisation

### Bibliothèque
- Rechercher par titre, studio ou AppID.
- Cliquer une carte enrichie pour ouvrir la fiche complète.
- Marquer un jeu Terminé ou annuler ce statut.
- Importer un export Steam JSON sans supprimer les profils existants.

### Découverte
- Choisir explicitement un jeu de référence dans la recherche indépendante ; ou
- décrire l’expérience recherchée ; ou
- cliquer **Surprends-moi**.

Chaque carte distingue la **proximité sémantique** de la **fiabilité**. Les profils insuffisants sont comptés parmi les résultats écartés, sans être affichés.

### Administration
Les opérations d’écriture exigent `ADMIN_TOKEN` : import, retours, statut Terminé et pilotage de l’enrichissement. Le navigateur le conserve dans `localStorage` et l’envoie dans l’en-tête `X-Admin-Token`.

## Variables d’environnement

| Variable | Défaut | Rôle |
|---|---|---|
| `ADMIN_TOKEN` | vide | Obligatoire pour toute écriture |
| `DATA_DIR` | `./data` | Dossier de données |
| `DATABASE_PATH` | `$DATA_DIR/backlog.sqlite` | Fichier SQLite |
| `OLLAMA_URL` | `http://host.docker.internal:11434` | API Ollama |
| `OLLAMA_ANALYSIS_MODEL` | `qwen3:32b` | Modèle d’analyse |
| `OLLAMA_EMBEDDING_MODEL` | `embeddinggemma` | Modèle d’embedding |
| `AUTO_ENRICH` | `true` | Active le worker autonome |
| `ENRICHMENT_CONCURRENCY` | `1` | Tâches parallèles (1 à 4) |
| `MIN_PROFILE_QUALITY` | `0.35` | Seuil documentaire minimal |
| `REQUEST_TIMEOUT_MS` | `120000` | Délai Ollama |

## API principale

- `GET /healthz`
- `GET /api/status`
- `GET /api/library`
- `GET /api/library/search?q=...`
- `GET /api/library/:appId/profile`
- `PATCH /api/library/:appId/completed`
- `POST /api/library/import`
- `POST /api/discovery`
- `POST /api/discovery/feedback`
- `GET /api/discovery/history`
- `GET /api/enrichment/status`
- `POST /api/enrichment/start|pause|retry`

## Tests

Le projet n’utilise aucune dépendance npm d’exécution ; SQLite est fourni par Node.js 24.

```bash
npm ci
npm test
npm run check
```

Les tests couvrent la migration, la recherche indépendante, les fiches, l’import non destructif, le filtre documentaire, le renouvellement, le statut Terminé, Surprends-moi, l’API HTTP, l’authentification et les en-têtes de sécurité.
