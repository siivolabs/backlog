# Backlog 0.9.2

Backlog 0.9.2 corrige le contrat des **profils d’expérience IA**. Les dimensions complexes ne sont plus de simples chaînes : elles utilisent un schéma JSON multidimensionnel strict, tandis que leur provenance documentaire reste isolée dans `field_status`.

## Nouveautés 0.9.2

- schéma de profil `2.0` pour narration, exploration, structure, ambiance, rythme, progression, difficulté, multijoueur, boucles et éléments distinctifs ;
- séparation stricte entre les caractéristiques du jeu et `field_status` ;
- rejet des valeurs réservées `documented`, `interpreted`, `unknown`, `contradictory` et `human_corrected` lorsqu’elles sont utilisées comme contenu ;
- représentation d’une dimension inconnue par `null` ou `[]`, jamais par une chaîne générique ;
- validation croisée du statut, des sources `SOURCE-N`, du type, des propriétés obligatoires et de la richesse descriptive ;
- distinction entre **complétude documentaire**, **complétude du profil**, **qualité sémantique** et **couverture des preuves** ;
- refus de l’embedding et de la validation lorsque le dossier ou le profil sémantique est insuffisant ;
- classement explicite des éléments distinctifs en `core`, `supporting`, `optional` ou `technical` ;
- instructions contre les fausses contradictions entre temps de jeu personnel, durée de session, campagne, objectif et complétion ;
- réanalyse d’un seul jeu conservée : dossier, analyse et embedding restent déclenchables séparément ;
- migration SQLite additive : profils, candidates, sources, corrections, embeddings et données joueur existants ne sont ni réécrits ni supprimés.

## Schéma 2.0 — exemple de rythme

```json
{
  "schema_version": "2.0",
  "pace": {
    "baseline": "slow",
    "variation": "calm_to_tense",
    "intensity": "low_to_moderate",
    "player_control": "high",
    "description": "Conduite contemplative ponctuée de manœuvres exigeant précision et concentration."
  },
  "field_status": {
    "pace": {
      "status": "documented",
      "source_ids": ["SOURCE-1", "SOURCE-6"],
      "confidence": "high",
      "note": "Le rythme et ses variations sont décrits par les sources citées."
    }
  }
}
```

`field_status` contient la provenance ; la valeur `pace` décrit l’expérience. Une information réellement inconnue utilise `pace: null`, `status: "unknown"` et `source_ids: []`.

## Pilote intégré

Les tests de contrat couvrent en priorité :

1. **Euro Truck Simulator 2** : narration très faible et émergente, réseau routier ouvert, contrats, rythme lent, progression économique et convoi facultatif ;
2. **Control** : narration centrale, exploration interconnectée, structure de missions et alternance exploration/combat ;
3. **Satisfactory** : extraction, automatisation, optimisation, monde ouvert et progression technologique par paliers.

Ces tests sont déterministes et hors ligne. La génération réelle Qwen3, les sources Steam/IGDB/SearXNG et l’embedding doivent ensuite être contrôlés sur le NAS selon `VERIFICATION.md`.

## Pré-requis

- Node.js 24 ou l’image Docker fournie ;
- Ollama accessible depuis le conteneur ;
- `qwen3:32b` et `embeddinggemma`, sauf adaptation des variables ;
- SearXNG pour la recherche documentaire externe.

## Variables principales

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
| `AI_ANALYSIS_TIMEOUT_MS` | `480000` | Délai d’analyse Qwen |
| `AI_EMBEDDING_TIMEOUT_MS` | `120000` | Délai d’embedding |
| `SEARXNG_BASE_URL` | vide | API de recherche documentaire |
| `SEARXNG_LANGUAGE` | `fr-FR` | Langue SearXNG |
| `AI_MAX_WEB_PAGES` | `8` | Nombre maximal de pages récupérées |

## Opérations individuelles

Dans la fiche d’un jeu :

- **Actualiser le dossier** ne relance ni Qwen ni l’embedding ;
- **Analyser le dossier** crée une nouvelle candidate sans écraser la version active ;
- **Générer l’embedding** utilise le profil affiché s’il passe les deux contrôles de qualité ;
- **Réanalyse complète** enchaîne collecte, analyse et embedding pour ce seul jeu.

Aucune analyse de masse n’est lancée au démarrage.

## Vérification locale

```bash
npm run check
npm test
DATA_DIR=/tmp/backlog-v092 PORT=3000 node server.js
curl http://127.0.0.1:3000/healthz
```

Aucune dépendance npm tierce n’est nécessaire.

## Déploiement

1. Lire `MIGRATION.md`.
2. Sauvegarder le volume SQLite.
3. Publier le contenu de l’archive à la racine du dépôt.
4. Conserver le workflow GitHub existant, s’il existe.
5. Reconstruire l’image puis redéployer avec Dockge.
6. Exécuter **Tester Ollama**.
7. Réanalyser individuellement Euro Truck Simulator 2, puis Control et Satisfactory.
