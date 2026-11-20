# Backlog V0.9.6 — découverte expérientielle

Backlog V0.9.6 étend intégralement V0.9.5.0 avec **Backlog Discovery**, un prototype isolé qui part des motivations formulées et confirmées par le joueur. Il utilise les métadonnées et embeddings pour présélectionner des candidats, puis réserve Qwen à l’analyse comparative des candidats prometteurs. Les profils, réseaux et comportements existants ne sont ni remplacés ni réécrits.

## Fonctions V0.9.6

### Backlog Discovery : trois étapes

1. **Pourquoi ce jeu ?** — sélection d’un jeu apprécié, explication libre, interprétation Qwen, correction puis confirmation explicite.
2. **Explorer les intentions** — mémoire durable des motivations confirmées, désactivation possible et combinaison contextuelle de plusieurs intentions.
3. **Découvrir** — cinq jeux argumentés avec motivations concernées, différences, éléments utilisés, niveau de confiance et incertitudes.

La similarité n’est pas le critère final. Une différence de genre, de structure ou de mécanique peut devenir un argument si le jeu répond autrement à la motivation recherchée.

### Coût IA ciblé et résultats mesurables

- une requête EmbeddingGemma représente la combinaison d’intentions ;
- les embeddings des profils rapides ou actifs et les métadonnées de la bibliothèque classent jusqu’à 40 candidats ;
- seuls les 12 candidats les plus prometteurs sont transmis à une analyse Qwen comparative ;
- le résultat conserve les scores de présélection, les sources du candidat et les durées d’embedding, de sélection et d’analyse ;
- trois retours qualitatifs distinguent l’intérêt, l’absence de pertinence et une bonne piste expliquée pour la mauvaise raison ;
- le dernier retour peut préciser si la correction concerne le jeu, le joueur ou leur association.

### Conservation intégrale de V0.9.5.0

Le pipeline sémantique rapide et le réseau indépendant restent disponibles sans changement.

### Pipeline sémantique rapide

- extraction Qwen d’un profil compact structuré sur 11 dimensions comparables ;
- aucune génération de preuves détaillées, réparation de chemins ou vérification factuelle dans ce chemin expérimental ;
- EmbeddingGemma sur une représentation courte et stable ;
- stockage totalement séparé dans `fast_semantic_*_v095` ;
- mode intelligent qui réutilise un résultat lorsque l’empreinte du dossier et le modèle d’embedding n’ont pas changé ;
- mode reconstruction qui régénère explicitement la sélection ;
- mesure par jeu du temps d’analyse, du temps d’embedding et de la durée totale ;
- objectif affiché : 50 jeux en moins de dix minutes, à valider sur l’installation réelle.

Le réseau rapide est indépendant du réseau V0.9.4 et de `ai_similarity_cache`. Ses recommandations apparaissent séparément dans la fiche du jeu.

### Supervision sans pourcentage artificiel

L’interface affiche l’étape réelle de chaque jeu :

1. dossier documentaire ;
2. génération Qwen ;
3. normalisation des chemins ;
4. vérification factuelle ;
5. embedding ;
6. stockage d’une nouvelle version ;
7. similarités.

Chaque étape possède un état, une durée réelle et des événements horodatés. Le journal et les points de reprise sont stockés dans SQLite et restent disponibles après un rechargement de page ou un redémarrage.

### Suspension, reprise et interruptions Ollama

- **Suspendre** arrête la requête IA active lorsque possible et place la campagne dans un état persistant.
- **Reprendre** repart de la dernière étape terminée.
- Une interruption réseau ponctuelle est classée `infrastructure` puis suivie d’un contrôle de disponibilité. La campagne ne se suspend automatiquement que si Ollama est réellement indisponible.
- Les résultats intermédiaires déjà terminés (dossier, réponse Qwen, profil réparé, vérification, embedding) sont réutilisés.


### Fiabilité Qwen et preuves expérimentales

- Les trois appels longs à Qwen utilisent le streaming NDJSON ; chaque fragment reçu réarme le délai d’inactivité.
- Le réseau expérimental peut conserver un profil sémantiquement exploitable tout en excluant les preuves documentaires secondaires non vérifiées.
- Les opérations `full` et la base de connaissances continuent d’exiger la validation documentaire stricte.
- Les statuts HTTP, corps de réponse et causes réseau restent visibles dans le diagnostic.
- Le journal en direct reste ouvert et affiche les événements SQLite avec le nom du jeu et son AppID.

### Campagnes intelligentes ou complètes

- **Compléter le réseau** réutilise les profils et embeddings valides et ne calcule que ce qui manque.
- **Reconstruire les 50 analyses** force une nouvelle analyse complète de chaque jeu sélectionné.
- Une reconstruction complète crée des versions candidates supplémentaires : elle ne remplace pas les versions actives et ne supprime aucune analyse historique.

### File d’attente

La file persistante permet de :

- placer un jeu en priorité ;
- retirer un jeu sans supprimer ses données ;
- relancer uniquement les erreurs ;
- reprendre une campagne interrompue après redémarrage.

Les erreurs sont classées en `infrastructure`, `technique`, `qualite`, `documentaire` ou `interruption`. Les erreurs techniques et incidents réseau ponctuels peuvent être retentés automatiquement ; une indisponibilité Ollama confirmée provoque une suspension sûre.

### Bilan de campagne

À la fin, Backlog enregistre et affiche : jeux traités, profils exploitables, embeddings, relations, annulations, durées par étape, durée totale et répartition statistique des erreurs.

### Recherche et navigation

- La bibliothèque et le mini-réseau recherchent par titre ou par **Steam AppID exact** lorsque la requête est numérique.
- Les filtres du réseau couvrent les profils exploitables, profils insuffisants, embeddings, erreurs et jeux participant au réseau.
- Les fiches ouvrent directement le jeu dans le réseau et le réseau ouvre directement une fiche ou un voisin.
- Recherches, filtres et vue active sont conservés dans la session du navigateur.

## Compatibilité et données

La migration est uniquement additive. Elle conserve notamment :

- les tables et données existantes ;
- les profils actifs, candidats, rejetés et historiques ;
- les dossiers documentaires et sources ;
- les réglages `ADMIN_TOKEN`, Ollama et SearXNG ;
- les tables du réseau V0.9.4 et de complétion V0.9.4.1.

V0.9.4.4 avait ajouté deux tables :

- `ai_analysis_checkpoints_v0943` ;
- `ai_analysis_events_v0943`.

V0.9.5.0 ajoutait :

- `fast_semantic_runs_v095` ;
- `fast_semantic_items_v095` ;
- `fast_semantic_edges_v095`.

V0.9.6 ajoute six tables isolées :

- `discovery_interpretations_v096` ;
- `discovery_intentions_v096` ;
- `discovery_runs_v096` ;
- `discovery_candidates_v096` ;
- `discovery_recommendations_v096` ;
- `discovery_feedback_v096`.

Les colonnes de supervision des tâches et campagnes existantes restent conservées. Les migrations sont idempotentes.

## Déploiement

1. Arrêter Backlog et sauvegarder SQLite :

   ```bash
   cp /srv/docker/backlog/data/backlog.sqlite \
      /srv/docker/backlog/data/backlog.sqlite.bak-$(date +%Y%m%d-%H%M%S)
   ```

2. Publier le contenu de cette archive dans le dépôt GitHub et reconstruire l’image `dev`.
3. Conserver le montage `./data:/data`, `ADMIN_TOKEN`, `OLLAMA_BASE_URL` et `SEARXNG_BASE_URL`.
4. Recréer le conteneur.
5. Ne supprimer ni `data` ni `backlog.sqlite`.

Le `compose.yaml` conserve :

```yaml
user: "1000:1000"
read_only: true
cap_drop:
  - ALL
tmpfs:
  - /tmp
```

## Vérification

```bash
npm run check
npm test
```

Après démarrage :

```bash
curl -fsS http://127.0.0.1:3000/healthz
```

Le résultat doit annoncer la version `0.9.6`.

## Variables utiles

| Variable | Défaut | Rôle |
|---|---:|---|
| `EXPERIMENT_SIZE` | `50` | taille de la sélection initiale |
| `USE_DRAFT_PROFILES` | `true` | candidats autorisés dans le laboratoire |
| `NETWORK_USABLE_THRESHOLD` | `0.45` | complétude comparable minimale |
| `NETWORK_JOB_POLL_MS` | `500` | fréquence de collecte de l’étape réelle |
| `NETWORK_GAME_TIMEOUT_MS` | `2700000` | délai maximal par jeu |
| `AI_ANALYSIS_INACTIVITY_TIMEOUT_MS` | `480000` | délai sans fragment Qwen |
| `AI_PATH_REPAIR_INACTIVITY_TIMEOUT_MS` | `120000` | délai sans fragment de réparation |
| `AI_VERIFICATION_INACTIVITY_TIMEOUT_MS` | `480000` | délai sans fragment de vérification |
| `AI_OLLAMA_HEALTH_TIMEOUT_MS` | `10000` | contrôle avant suspension automatique |
| `AI_EMBEDDING_TIMEOUT_MS` | `120000` | délai d’embedding |
| `FAST_SEMANTIC_SIZE` | `50` | limite de secours si aucune sélection réseau n’existe |
| `FAST_SEMANTIC_MAX_INPUT_CHARS` | `28000` | taille maximale du dossier transmis au prompt compact |
| `FAST_SEMANTIC_MAX_TOKENS` | `1200` | plafond de sortie du profil compact |
| `FAST_SEMANTIC_INACTIVITY_TIMEOUT_MS` | `180000` | délai sans fragment du prompt rapide |
| `DISCOVERY_LIBRARY_LIMIT` | `5000` | nombre maximal de jeux inspectés par métadonnées |
| `DISCOVERY_CANDIDATE_LIMIT` | `40` | candidats de présélection conservés par exécution |
| `DISCOVERY_DEEP_CANDIDATES` | `12` | candidats maximum transmis à Qwen |
| `DISCOVERY_INTERPRET_MAX_TOKENS` | `1600` | plafond de l’interprétation des motivations |
| `DISCOVERY_ANALYSIS_MAX_TOKENS` | `3600` | plafond de l’analyse comparative ciblée |
| `DISCOVERY_INACTIVITY_TIMEOUT_MS` | `240000` | délai sans fragment des prompts Discovery |

Toutes les mutations exigent le même `ADMIN_TOKEN` que l’administration existante.
