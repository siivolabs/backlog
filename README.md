# Backlog 0.9.3.1

Backlog 0.9.3.1 est le correctif de fiabilité de la 0.9.3. Il conserve le schéma de profil 2.1 et les données SQLite existantes, tout en empêchant une faute de nomenclature dans un chemin de preuve de faire échouer inutilement une analyse.

## Correctifs 0.9.3.1

- normalisation déterministe des alias explicitement autorisés, dont `atmosphere_theme.*` vers `atmosphere_themes.*` ;
- validation stricte de l’existence réelle de chaque chemin dans le profil généré ;
- une seule tentative de réparation Qwen pour les chemins encore invalides, avec sortie limitée à des couples `from`/`to` ;
- application d’une réparation uniquement si la cible appartient aux chemins autorisés de la même dimension ;
- rejet inchangé du profil lorsqu’une réparation est absente, ambiguë, hors dimension ou hors schéma ;
- affichage du code, de l’étape et du détail complet de l’erreur dans la fiche du jeu et la vue **Erreurs** ;
- aucune modification du schéma SQLite 0.9.3 et aucune réécriture des profils existants.

La génération reste multidimensionnelle et la seconde passe contrôle les affirmations contre les sources citées et contre les corrections humaines déjà enregistrées.

## Nouveautés 0.9.3

- schéma de profil `2.1` avec définitions non ambiguës pour la topologie, la génération de carte, la linéarité, le modèle de session et la persistance ;
- séparation de `exploration.topology` et `exploration.map_generation` pour ne plus confondre monde ouvert et génération procédurale ;
- remplacement de `progression.persistence` par `save_persistence` et `reset_model` ;
- remplacement de `multiplayer.persistence` par `world_persistence` ;
- preuves attribuées à des chemins précis dans `field_status.<dimension>.claims` ;
- score distinct de **précision des preuves**, qui pénalise les citations trop larges et les mêmes listes de sources répétées partout ;
- seconde passe Qwen de vérification factuelle, avec anomalies `warning` ou `critical` ;
- refus de l’embedding et de la validation tant que la vérification factuelle n’est pas réussie ;
- réinjection des notes « À corriger » et des corrections de champs dans chaque réanalyse suivante ;
- interface enrichie avec le rapport de contrôle, les preuves par caractéristique et les scores factuels ;
- migration SQLite additive : aucune table, version, source, correction, donnée joueur ou embedding historique n’est supprimé.

## Schéma 2.1 — distinctions importantes

```json
{
  "schema_version": "2.1",
  "exploration": {
    "freedom": "open",
    "topology": "open_world",
    "map_generation": "fixed",
    "guidance": "player_directed",
    "rewards": ["ressources", "nouveaux sites"],
    "description": "Le joueur explore une carte conçue et stable pour trouver des ressources."
  },
  "progression": {
    "systems": ["paliers technologiques", "recettes", "logistique"],
    "scope": "technology",
    "pacing": "tiered",
    "save_persistence": "saved_between_sessions",
    "reset_model": "none",
    "description": "Les usines et les technologies restent enregistrées entre les sessions."
  }
}
```

`topology` décrit l’organisation spatiale. `map_generation` dit si la carte est fixe ou générée. `save_persistence` indique si les acquis sont sauvegardés entre les sessions. `reset_model` décrit leur éventuelle réinitialisation. `multiplayer.world_persistence` ne décrit que le monde partagé.

## Preuves par caractéristique

Chaque dimension conserve un résumé de provenance compatible avec la 0.9.2, mais ajoute des affirmations précises :

```json
{
  "field_status": {
    "exploration": {
      "status": "documented",
      "source_ids": ["SOURCE-1"],
      "confidence": "high",
      "note": "La source officielle décrit le monde ouvert.",
      "claims": [
        {
          "path": "exploration.map_generation",
          "source_ids": ["SOURCE-1"],
          "support": "direct",
          "confidence": "high",
          "note": "La carte est conçue et identique entre les parties."
        }
      ]
    }
  }
}
```

`source_ids` doit être exactement l’union des sources réellement utilisées par les `claims`. Une correction humaine peut utiliser `support: "human"` sans `SOURCE-N`.

## Pipeline de fiabilité

1. construction ou réutilisation du dossier documentaire ;
2. chargement des notes de révision et corrections antérieures du jeu ;
3. génération du profil 2.1 ;
4. validation déterministe du schéma, des chemins et des sources ;
5. vérification factuelle Qwen indépendante ;
6. calcul séparé de la sémantique, de la couverture, de la précision des preuves et de l’exactitude factuelle ;
7. embedding seulement si le dossier et le profil sont suffisants **et** si la vérification retourne `passed`.

Un profil peut donc être structurellement complet tout en restant bloqué pour anomalie factuelle.

## Corrections humaines

- Une note enregistrée avec **À corriger** est transmise aux générations suivantes du même jeu.
- Les corrections structurées de `ai_profile_field_reviews` avec `review_status=corrected` sont dédupliquées par chemin ; la plus récente est prioritaire.
- Si une correction et le dossier sont en tension, le générateur doit conserver la tension dans `uncertainties` au lieu de réintroduire silencieusement l’erreur.

## Pré-requis

- Node.js 24 ou l’image Docker fournie ;
- Ollama accessible depuis le conteneur ;
- `qwen3:32b` et `embeddinggemma`, sauf adaptation des variables ;
- SearXNG facultatif pour la recherche documentaire externe.

## Variables principales

| Variable | Défaut | Rôle |
|---|---:|---|
| `PORT` | `3000` | Port HTTP interne |
| `DATA_DIR` | `/data` | Dossier persistant |
| `DATABASE_PATH` | détection automatique | Fichier SQLite existant |
| `ADMIN_TOKEN` | vide | Protège les mutations |
| `OLLAMA_BASE_URL` | `http://127.0.0.1:11434` | API Ollama |
| `AI_ANALYSIS_MODEL` | `qwen3:32b` | Génération et vérification |
| `AI_EMBEDDING_MODEL` | `embeddinggemma` | Modèle d’embedding |
| `AI_ANALYSIS_TIMEOUT_MS` | `480000` | Délai de génération |
| `AI_VERIFICATION_TIMEOUT_MS` | `480000` | Délai de vérification |
| `AI_PATH_REPAIR_TIMEOUT_MS` | `120000` | Délai de l’unique tentative de réparation de chemins |
| `AI_EMBEDDING_TIMEOUT_MS` | `120000` | Délai d’embedding |
| `SEARXNG_BASE_URL` | vide | API SearXNG |

## Vérification locale

```bash
npm run check
npm test
DATA_DIR=/tmp/backlog-v0931 PORT=3000 node server.js
curl http://127.0.0.1:3000/healthz
```

Aucune dépendance npm tierce n’est nécessaire.

## Déploiement

1. Lire `MIGRATION.md`.
2. Sauvegarder le volume SQLite complet.
3. Publier le contenu de l’archive à la racine du dépôt.
4. Conserver le workflow GitHub existant et le montage `./data:/data`.
5. Reconstruire l’image puis redéployer avec Dockge.
6. Exécuter **Tester Ollama**.
7. Réanalyser individuellement Euro Truck Simulator 2, Control et Satisfactory ; ne pas lancer les 50 jeux avant validation du pilote.
