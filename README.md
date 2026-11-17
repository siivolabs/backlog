# Backlog 0.9.0

Backlog 0.9 transforme le POC d’analyse en une **base de connaissances vérifiable** sur les jeux et en un début de profil de préférences personnelles.

## Fonctionnalités livrées

- tableau de bord IA ;
- filtre de bibliothèque par statut IA ;
- profil complet et sources consultables ;
- réanalyse d’un jeu sans relancer le lot ;
- erreurs détaillées avec étape, message et tentatives ;
- historique des profils et validation humaine ;
- comparaison des similarités ;
- évaluation séparée de la similarité et de l’intérêt personnel ;
- saisie de l’expérience du joueur ;
- arrêt du polling dès qu’une tâche atteint un état terminal ;
- migration SQLite additive depuis 0.8.x.

## Pré-requis

- Node.js 24 ou l’image Docker fournie (SQLite est intégré à Node) ;
- Ollama accessible depuis le conteneur ;
- `qwen3:32b` et `embeddinggemma` installés, sauf si les variables de modèles sont adaptées ;
- SearXNG facultatif.

## Variables

| Variable | Défaut | Rôle |
|---|---|---|
| `PORT` | `3000` | Port HTTP interne |
| `DATA_DIR` | `/data` | Dossier persistant |
| `DATABASE_PATH` | détection automatique | Fichier SQLite existant |
| `ADMIN_TOKEN` | vide | Protège les mutations |
| `OLLAMA_BASE_URL` | `http://127.0.0.1:11434` | API Ollama |
| `AI_ANALYSIS_MODEL` | `qwen3:32b` | Modèle de profil |
| `AI_EMBEDDING_MODEL` | `embeddinggemma` | Modèle d’embedding |
| `AI_EMBEDDING_DIMENSIONS` | `768` | Dimension attendue |
| `SEARXNG_BASE_URL` | vide | Recherche documentaire |
| `SEARXNG_LANGUAGE` | `fr-FR` | Langue SearXNG |

## Vérification locale

```bash
npm test
npm run check
DATA_DIR=/tmp/backlog-v09 PORT=3000 node server.js
curl http://127.0.0.1:3000/healthz
```

Aucune dépendance npm tierce n’est nécessaire.

## Déploiement

Consulter [MIGRATION.md](MIGRATION.md) avant de reconstruire l’image. Conserver le workflow `.github/workflows/docker-publish.yml` déjà présent dans le dépôt.

## Compatibilité avec la base 0.8

La couche 0.9 découvre la table de bibliothèque grâce aux colonnes AppID + nom. Elle reconnaît les variantes courantes (`appid`, `app_id`, `steam_app_id`, `name`, `title`) et importe une table de profils historique contenant un AppID et une colonne JSON (`profile_json`, `profile`, `analysis_json`, etc.).

Si l’installation utilise des noms hors de cette liste, le démarrage reste non destructif et l’interface indique qu’aucune source de bibliothèque n’a été détectée. Il suffit alors d’étendre les listes de compatibilité dans `lib/database.js` ou de fournir un export de schéma SQLite pour ajouter le mapping exact.

## Limite volontaire

Le moteur classique n’est plus affiché dans l’interface principale, mais ses anciennes tables ne sont ni supprimées ni modifiées. Il reste donc disponible pour comparaison ou retour arrière.
