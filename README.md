# Backlog v0.8.0 POC

Backlog V0.8.0 POC ajoute un moteur expérimental d’analyse d’expérience entièrement séparé du moteur de recommandation historique. Il conserve l’interface, la classification, les fiches, les corrections manuelles et la réparation de migration V0.7.1, sans réinitialiser les données existantes.

## Régression corrigée

La V0.7.0 contenait ce comportement lors d’une migration depuis une version antérieure :

```sql
UPDATE games
SET metadata_status = 'pending', metadata_error = NULL, next_retry_at = NULL
WHERE metadata_status IN ('synced', 'unavailable');
```

Les métadonnées et le cache SQLite restaient présents, mais les jeux terminés redevenaient artificiellement éligibles à l’enrichissement. Ce bloc a été supprimé.

## Réparation automatique V0.7.1

Au premier démarrage, V0.7.1 exécute une réparation transactionnelle et idempotente :

1. Un jeu `pending` possédant une source terminée (`steam_store` ou `igdb`) et une date de métadonnées redevient `synced`.
2. Un jeu `pending` sans source directe, mais disposant d’une correspondance IGDB exacte et trouvée dans `metadata_cache`, redevient `synced`. Les données du cache ne remplissent que les champs absents : les données existantes ne sont pas écrasées.
3. Un jeu `pending` dont le traitement était terminé, sans source, et dont le cache IGDB contient une absence exacte (`found = 0`) devient `unavailable`, affiché dans l’interface comme **Métadonnées introuvables**.
4. Les `temporary_error` restent inchangés et conservent leur prochaine date de tentative.
5. Les anciens `syncing` deviennent toujours `pending` après une interruption. Ils ne sont pas confondus avec les statuts endommagés par la migration.

Une marque `migration_071_status_repair` est écrite dans `settings` dans la même transaction que la réparation. La réparation destructive ne peut donc pas être rejouée à chaque démarrage. Une transaction interrompue est entièrement annulée et sera reprise au démarrage suivant.

## Données préservées

Le correctif ne supprime et ne réinitialise pas :

- les noms, genres, thèmes, plateformes et types d’applications ;
- les sources et identifiants Steam/IGDB ;
- `metadata_cache` et ses entrées négatives ;
- les corrections de `game_manual_overrides` ;
- les associations de `igdb_manual_matches` ;
- les recommandations et autres tables applicatives ;
- les erreurs temporaires légitimes.

Aucune requête Steam ou IGDB n’est effectuée pendant la migration.

## Effet attendu sur la base observée

Pour une base contenant 4 321 jeux, 4 321 entrées de cache, 4 258 jeux avec genres et les statuts `3893 pending / 402 synced / 26 temporary_error`, V0.7.1 recalcule les statuts depuis les sources persistées et le drapeau `found` du cache.

Le nombre exact de jeux `synced` et `unavailable` dépend donc des correspondances réellement trouvées dans `metadata_cache`. Les jeux réparés ne restent plus `pending` et ne sont pas ré-enrichis inutilement. Les 26 erreurs temporaires restent inchangées.

## Déploiement depuis V0.7.0

1. Suspendre un éventuel enrichissement encore actif.
2. Sauvegarder `data/backlog.sqlite`.
3. Publier les fichiers V0.7.1 dans le dépôt GitHub.
4. Attendre la reconstruction de `ghcr.io/siivolabs/backlog:dev`.
5. Dans Dockge, effectuer **Pull**, puis recréer le conteneur.
6. Ouvrir Backlog et contrôler la répartition des statuts avant de relancer manuellement un enrichissement.

Aucune variable d’environnement ni modification du Compose n’est nécessaire.

## Contrôle SQLite facultatif

Après le premier démarrage V0.7.1 :

```sql
SELECT metadata_status, COUNT(*)
FROM games
GROUP BY metadata_status
ORDER BY metadata_status;

SELECT value
FROM settings
WHERE key = 'migration_071_status_repair';
```

La seconde requête renvoie le bilan JSON de la réparation : jeux restaurés depuis leur source, jeux restaurés depuis le cache et métadonnées introuvables.

## Tests

```bash
npm test
node --check server.js
node --check public/app.js
```

La suite couvre notamment :

- la migration d’une base V0.6.1 entièrement enrichie ;
- la réparation d’une base V0.7.0 dont les statuts ont été réinitialisés ;
- la distribution observée de 4 321 jeux ;
- l’idempotence sur plusieurs redémarrages ;
- la reprise des anciens `syncing` ;
- la préservation du cache, des métadonnées, des corrections manuelles et des associations IGDB ;
- l’absence de jeux terminés encore éligibles à un enrichissement inutile ;
- toutes les non-régressions V0.7.0.


## Sélection du pilote IA V0.8

L'interface permet de rechercher les jeux de la bibliothèque, de les sélectionner manuellement, de visualiser le compteur et de valider explicitement la sélection avant toute future analyse. Le bouton de proposition crée un échantillon diversifié de 50 jeux qui reste modifiable et n'est jamais enregistré ni analysé sans validation. La limite de 50 est un garde-fou du POC uniquement, pas une limite de conception de l'architecture future.


## Moteur d’analyse IA local

### Architecture

- Backlog reste sur le NAS et conserve SQLite ainsi que l’interface.
- Ollama tourne sur le PC IA à `http://192.168.1.77:11434` par défaut.
- `qwen3:32b` produit un profil d’expérience JSON versionné et validé.
- `embeddinggemma` produit un vecteur strictement contrôlé à 768 dimensions.
- Les similarités combinent 60 % de proximité sémantique et 40 % de proximité des dimensions d’expérience.
- Le moteur explicable historique reste disponible et inchangé.

### Construction du dossier

Backlog constitue d’abord un dossier avec les données locales Steam et IGDB : genres, thèmes, plateformes, types, catégories, descriptions Steam, résumé et synopsis IGDB lorsqu’ils sont disponibles. Si ce dossier est insuffisant et si `SEARXNG_BASE_URL` est configuré, Backlog demande à SearXNG des résultats documentaires et conserve leurs extraits dans SQLite.

Les URL des résultats sont conservées pour la traçabilité côté Backlog, mais elles ne sont jamais incluses dans le prompt. Qwen reçoit uniquement des identifiants de sources, leurs titres et leur texte. Le prompt lui interdit d’ouvrir ou de demander un lien et lui impose de signaler les informations absentes.

### Reproductibilité

Chaque requête de profil utilise :

- température `0` ;
- graine `42` ;
- contexte `16384` ;
- sortie JSON stricte ;
- version de prompt `experience-profile-v1` ;
- modèle, hachage des sources, dates, tentatives, erreurs et état persistés.

Une modification des données locales, du modèle, de la version du prompt ou du modèle d’embedding rend le profil obsolète et permet son recalcul.

### Tables SQLite ajoutées

- `ai_analysis_runs` : exécutions, progression et erreurs globales ;
- `ai_game_profiles` : profils JSON, versions, états et erreurs ;
- `ai_document_sources` : dossier documentaire et traçabilité ;
- `ai_embeddings` : vecteurs binaires 768 dimensions ;
- `ai_similarities` : scores hybrides, ressemblances et différences.

Toutes les tables rattachées aux jeux utilisent des clés étrangères avec suppression en cascade. Aucune table existante du moteur historique n’est remplacée.

### Contrôle manuel

Après validation du lot :

1. **Tester Ollama** vérifie la présence de `qwen3:32b` et `embeddinggemma`.
2. **Lancer l’analyse** traite les profils séquentiellement.
3. **Suspendre** termine le jeu courant puis arrête proprement le lot.
4. **Reprendre** ignore les profils déjà valides et continue les profils restants ou en erreur.
5. La progression et les quatre états sont visibles dans l’interface.

Un redémarrage transforme une analyse de jeu interrompue en état reprenable et marque l’exécution globale comme interrompue.

### Fiches de jeux

Les fiches affichent désormais :

- les voisins du lot analysé ;
- le score global, le score d’embedding et le score de profil ;
- les ressemblances et différences les plus significatives ;
- **Jouer** via `steam://run/APPID` ;
- **Installer** via `steam://install/APPID` ;
- **Voir sur Steam** via la page publique du magasin.

### Configuration

Copier `.env.example` vers `.env`, conserver l’adresse Ollama par défaut ou l’adapter, puis renseigner éventuellement :

```dotenv
OLLAMA_BASE_URL=http://192.168.1.77:11434
OLLAMA_ANALYSIS_MODEL=qwen3:32b
OLLAMA_EMBEDDING_MODEL=embeddinggemma
SEARXNG_BASE_URL=http://adresse-searxng:port
```

Sur le PC Ollama :

```bash
ollama pull qwen3:32b
ollama pull embeddinggemma
```

Le port Ollama doit rester limité au réseau local et ne doit pas être publié sur Internet.

### Déploiement

```bash
cp .env.example .env
# Renseigner les secrets et, si disponible, SEARXNG_BASE_URL
docker compose up -d --build
```

Avant la mise à jour d’une instance existante, conserver une copie du dossier `data`. Les migrations V0.8 créent uniquement les nouvelles colonnes et tables manquantes.
