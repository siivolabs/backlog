# Backlog V0.9.4 — Réseau expérimental de similarité

Cette livraison ajoute un laboratoire **non destructif** à Backlog V0.9.3.2. Elle utilise la même base SQLite, accepte les profils `active` et `draft`, construit un profil commun, calcule toutes les paires du périmètre et enregistre les évaluations humaines séparément des profils IA.

## Ce que fait cette version

- Sélection expérimentale configurable (50 jeux par défaut).
- Réutilisation automatique des profils existants, sans validation humaine obligatoire.
- Normalisation commune sur 11 dimensions : gameplay, narration, exploration, structure, rythme, progression, difficulté, ambiance, mode, perspective et identité.
- Niveau **A / B / C** calculé à partir de la complétude et de la présence d’un embedding.
- Score hybride initial :
  - 40 % similarité sémantique ;
  - 20 % gameplay ;
  - 20 % narration + ambiance ;
  - 15 % structure + exploration ;
  - 5 % autres dimensions.
- Repli automatique sur un score structuré lorsque les embeddings sont absents.
- Top 5, ressemblances, différences et mode de calcul pour chaque jeu.
- Évaluations : très similaire, partiellement similaire, peu similaire, non similaire, avec raison facultative.
- Tableau de bord couverture/qualité, densité utile et dimensions manquantes.
- Historique des recalculs.

## Garanties sur les données

La migration est additive. Elle ne supprime ni ne remplace aucune table de Backlog. Elle crée uniquement :

- `similarity_experiment_games`
- `similarity_edges_v094`
- `recommendation_feedback_v094`
- `similarity_runs_v094`

Le seul champ existant éventuellement mis à jour est `ai_profile_versions.embedding_json` lorsque vous cliquez volontairement sur **Compléter les embeddings**.

Avant tout déploiement, faites tout de même une sauvegarde :

```bash
cp ./data/backlog.sqlite ./data/backlog.sqlite.bak-$(date +%Y%m%d-%H%M%S)
```

## Déploiement recommandé à côté de Backlog

1. Décompressez l’archive dans un dossier `backlog-v0.9.4`.
2. Copiez `docker-compose.example.yml` en `docker-compose.yml`.
3. Dans `volumes`, indiquez le même dossier hôte que celui contenant `backlog.sqlite`.
4. Vérifiez l’URL d’Ollama. L’exemple utilise `http://192.168.1.77:11434`.
5. Lancez :

```bash
docker compose up -d --build
```

6. Ouvrez `http://localhost:3094`.

Le Backlog existant reste disponible sur son port actuel. Le laboratoire utilise le port 3094 afin d’éviter tout conflit.

## Si Backlog utilise un volume Docker nommé

Identifiez le volume :

```bash
docker inspect backlog-test --format '{{json .Mounts}}'
```

Puis remplacez la section `volumes` de l’exemple par le même volume :

```yaml
volumes:
  backlog-data:/data

volumes:
  backlog-data:
    external: true
```

## Premier test

1. Ouvrez le tableau de bord.
2. Vérifiez la sélection. Si aucune sélection historique n’existe, le laboratoire choisit jusqu’à 50 jeux ayant déjà un profil, en donnant la priorité aux embeddings existants et aux profils récents.
3. Cliquez sur **Compléter les embeddings** si nécessaire.
4. Cliquez sur **Recalculer le réseau**.
5. Ouvrez cinq jeux bien connus et évaluez leurs voisins.
6. Utilisez les statistiques pour décider s’il faut élargir la couverture ou corriger une dimension systématiquement faible.

Pour 50 profils exploitables, le réseau contient exactement **1 225 paires uniques**.

## Variables d’environnement

| Variable | Défaut | Utilité |
|---|---|---|
| `PORT` | `3094` | Port HTTP du laboratoire |
| `BACKLOG_DB` | `/data/backlog.sqlite` | Chemin de la base SQLite |
| `OLLAMA_URL` | `http://host.docker.internal:11434` | URL d’Ollama |
| `EMBEDDING_MODEL` | `embeddinggemma` | Modèle d’embedding |
| `EXPERIMENT_SIZE` | `50` | Nombre initial de jeux |
| `USE_DRAFT_PROFILES` | `true` | Autoriser les profils candidats |
| `USEFUL_SIMILARITY_THRESHOLD` | `0.55` | Seuil provisoire pour la densité utile |
| `OLLAMA_TIMEOUT_MS` | `120000` | Délai maximal par embedding |

## Limites connues

- Le laboratoire réutilise et compare les profils existants ; il ne déclenche pas la collecte documentaire ni la génération d’un nouveau profil, car ces routes ne sont pas présentes dans les pièces jointes. Les jeux sans profil restent explicitement signalés.
- Les pondérations et le seuil de densité sont des hypothèses expérimentales, pas des valeurs validées.
- Avant des évaluations humaines suffisantes, la « densité utile » est un proxy fondé sur le score calculé. Le score d’utilité issu des avis devient plus pertinent à mesure que les évaluations s’accumulent.
- Le choix automatique d’un profil favorise d’abord la complétude commune, puis la présence d’un embedding, puis la version la plus récente. Il ne modifie pas son état de cycle de vie.

## Tests

Avec Node.js 22.5 ou plus récent :

```bash
npm test
npm run check
```
