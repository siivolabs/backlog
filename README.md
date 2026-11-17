# Backlog 0.9.1.2

Backlog 0.9.1.2 améliore la **qualité des dossiers documentaires** utilisés par Qwen3 et empêche qu’un profil trop pauvre soit présenté comme prêt.

## Correctifs 0.9.1.2

- le bouton **Tester Ollama** utilise désormais `/api/chat` avec `think: false` et une limite adaptée, ce qui évite les faux échecs « génération vide » avec Qwen3 ;
- une réponse sans contenu final indique explicitement si Ollama a seulement renvoyé du raisonnement ;
- une ancienne table `ai_document_sources` sans `dossier_id` est conservée intégralement avant la création du nouveau schéma documentaire ;
- la migration peut être relancée sans dupliquer ni écraser la table historique.

## Nouveautés 0.9.1

- diagnostic Ollama structuré : configuration, accès, modèles, génération minimale et durée ;
- récupération enrichie des descriptions, catégories et développeurs Steam ;
- réutilisation des données présentes dans `provider_cache`, notamment IGDB (résumé, synopsis, thèmes, plateformes, modes et perspective lorsqu’ils existent) ;
- quatre recherches SearXNG ciblées par jeu : gameplay, structure, expérience et sources officielles ;
- filtrage des DLC, pages commerciales, catalogues et simples mentions ;
- récupération bornée du contenu textuel des pages retenues, avec protection SSRF et contrôle des redirections ;
- dossier documentaire versionné et consultable, avec pertinence, confiance, état de récupération et dimensions justifiées ;
- schéma Qwen stable avec provenance par champ (`documented`, `interpreted`, `unknown`, `contradictory`, `human_corrected`) ;
- qualité `complete`, `partial` ou `insufficient` ;
- aucun embedding définitif pour un profil `insufficient` ;
- rendu récursif des objets historiques : plus de `[object Object]` ;
- collecte, analyse et embedding relançables séparément ;
- comparaison côte à côte de la version active et d’une candidate ;
- aucune analyse de masse au démarrage.

## Pilote recommandé

Valider d’abord le pipeline sur trois jeux différents :

1. Euro Truck Simulator 2 ;
2. Control ;
3. Satisfactory.

N’étendre le traitement qu’après vérification manuelle des sources, des champs inconnus, de la provenance et de la comparaison avec les anciens profils.

## Pré-requis

- Node.js 24 ou l’image Docker fournie ;
- Ollama accessible depuis le conteneur ;
- `qwen3:32b` et `embeddinggemma`, sauf adaptation des variables ;
- SearXNG pour la recherche documentaire externe.

## Variables

| Variable | Défaut | Rôle |
|---|---|---|
| `PORT` | `3000` | Port HTTP interne |
| `DATA_DIR` | `/data` | Dossier persistant |
| `DATABASE_PATH` | détection automatique | Fichier SQLite existant |
| `ADMIN_TOKEN` | vide | Protège les mutations |
| `OLLAMA_BASE_URL` | `http://127.0.0.1:11434` | API Ollama vue depuis le conteneur |
| `AI_ANALYSIS_MODEL` | `qwen3:32b` | Modèle de profil |
| `AI_EMBEDDING_MODEL` | `embeddinggemma` | Modèle d’embedding |
| `AI_EMBEDDING_DIMENSIONS` | `768` | Dimension attendue |
| `AI_DIAGNOSTIC_TIMEOUT_MS` | `15000` | Délai du test de disponibilité |
| `AI_DIAGNOSTIC_GENERATION_TIMEOUT_MS` | `60000` | Délai de la génération minimale |
| `AI_ANALYSIS_TIMEOUT_MS` | `480000` | Délai d’analyse Qwen |
| `AI_EMBEDDING_TIMEOUT_MS` | `120000` | Délai d’embedding |
| `SEARXNG_BASE_URL` | vide | API de recherche documentaire |
| `SEARXNG_LANGUAGE` | `fr-FR` | Langue SearXNG |
| `AI_MAX_WEB_PAGES` | `8` | Nombre maximal de pages récupérées par dossier |
| `AI_MAX_PAGE_BYTES` | `750000` | Taille maximale d’une page |
| `AI_PAGE_TIMEOUT_MS` | `15000` | Délai de téléchargement d’une page |

## Opérations indépendantes

Dans la fiche d’un jeu :

- **Actualiser le dossier** ne relance ni Qwen ni l’embedding ;
- **Analyser le dossier** crée un nouveau profil sans embedding ;
- **Générer l’embedding** travaille sur le profil affiché, sauf s’il est insuffisant ;
- **Réanalyse complète** enchaîne collecte, analyse et embedding lorsque la qualité le permet.

Une réanalyse complète reste strictement limitée au jeu sélectionné.

## Vérification locale

```bash
npm run check
npm test
DATA_DIR=/tmp/backlog-v091 PORT=3000 node server.js
curl http://127.0.0.1:3000/healthz
```

Aucune dépendance npm tierce n’est nécessaire.

## Déploiement

1. Lire [MIGRATION.md](MIGRATION.md).
2. Sauvegarder le volume SQLite.
3. Publier le contenu de l’archive à la racine du dépôt.
4. Conserver `.github/workflows/docker-publish.yml` déjà présent sur GitHub si le dépôt en contient un.
5. Reconstruire `ghcr.io/siivolabs/backlog:dev`, puis redéployer avec Dockge.
6. Exécuter **Tester Ollama** avant toute réanalyse.

Les anciennes tables, les profils 0.8/0.9.0, les corrections humaines et les préférences personnelles sont conservés.
