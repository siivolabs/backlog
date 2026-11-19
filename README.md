# Backlog V0.9.4.3 — campagnes IA supervisées et reprenables

Backlog V0.9.4.3 conserve l’application complète (bibliothèque, fiches, profils, sources, historique, expérience personnelle, administration et réseau de similarité) et ajoute une supervision persistante des campagnes d’analyse.

## Fonctions V0.9.4.3

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
- Une interruption réseau ou une indisponibilité Ollama est classée `infrastructure` et suspend automatiquement la campagne au lieu de transformer tous les jeux suivants en échecs.
- Les résultats intermédiaires déjà terminés (dossier, réponse Qwen, profil réparé, vérification, embedding) sont réutilisés.

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

Les erreurs sont classées en `infrastructure`, `technique`, `qualite`, `documentaire` ou `interruption`. Les erreurs techniques peuvent être retentées automatiquement ; les pannes d’infrastructure provoquent une suspension sûre.

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

V0.9.4.3 ajoute deux tables :

- `ai_analysis_checkpoints_v0943` ;
- `ai_analysis_events_v0943`.

Elle ajoute aussi des colonnes de supervision aux tables de tâches et de campagnes existantes. Les migrations sont idempotentes.

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

Le résultat doit annoncer la version `0.9.4.3`.

## Variables utiles

| Variable | Défaut | Rôle |
|---|---:|---|
| `EXPERIMENT_SIZE` | `50` | taille de la sélection initiale |
| `USE_DRAFT_PROFILES` | `true` | candidats autorisés dans le laboratoire |
| `NETWORK_USABLE_THRESHOLD` | `0.45` | complétude comparable minimale |
| `NETWORK_JOB_POLL_MS` | `500` | fréquence de collecte de l’étape réelle |
| `NETWORK_GAME_TIMEOUT_MS` | `2700000` | délai maximal par jeu |
| `AI_ANALYSIS_TIMEOUT_MS` | `480000` | délai Qwen |
| `AI_VERIFICATION_TIMEOUT_MS` | `480000` | délai de vérification |
| `AI_EMBEDDING_TIMEOUT_MS` | `120000` | délai d’embedding |

Toutes les mutations exigent le même `ADMIN_TOKEN` que l’administration existante.
