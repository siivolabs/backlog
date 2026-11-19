# Backlog V0.9.4.2 — correctif `uncertainties` et résilience du lot

Cette livraison conserve l’intégration complète de V0.9.4.1 et corrige l’échec `path_repair` provoqué par `uncertainties: []` associé à un statut `documented`.

Lorsqu’aucune incertitude pertinente n’est identifiée, Backlog conserve la liste vide et normalise uniquement sa provenance vers `unknown`, sans créer d’incertitude artificielle. Les autres dimensions restent soumises à la validation stricte.

## Ce qui est préservé

- tableau de bord IA ;
- bibliothèque complète et pagination ;
- fiches détaillées ;
- profils, sources, historique et révision ;
- réanalyse complète ou par étape ;
- administration IA et jeton `ADMIN_TOKEN` ;
- Ollama, SearXNG et file de tâches ;
- données SQLite existantes.

## Ce qui est ajouté

Un sixième onglet **Réseau de similarité** permet de :

- sélectionner le périmètre expérimental (50 jeux par défaut) ;
- utiliser le meilleur profil `active` ou `draft` sans le promouvoir ;
- compléter tout le réseau en une seule opération : réutilisation, conversion des anciens profils, régénération Qwen3 si nécessaire et embeddings EmbeddingGemma ;
- suivre le traitement jeu par jeu sans validation manuelle obligatoire ;
- calculer toutes les paires du périmètre ;
- consulter le Top 5, les ressemblances et les différences ;
- enregistrer une évaluation séparée des goûts personnels ;
- suivre la couverture horizontale et la qualité verticale.

Les fiches détaillées conservent leur onglet **Similarités** et y affichent également les voisins du réseau expérimental lorsqu’ils existent.

## Migration SQLite

La migration est additive. Elle crée ou réutilise uniquement :

- `similarity_experiment_games`
- `similarity_edges_v094`
- `recommendation_feedback_v094`
- `similarity_runs_v094`
- `similarity_profile_adapters_v0941`
- `similarity_completion_runs_v0941`
- `similarity_completion_items_v0941`

Elle ne supprime aucune table et ne promeut aucun profil. Les anciens profils convertibles restent inchangés : leur représentation comparable est enregistrée séparément dans `similarity_profile_adapters_v0941`. Le champ `embedding_json` n’est mis à jour que pour un profil exploitable dépourvu de vecteur. Une régénération Qwen3 crée une version supplémentaire `draft` lorsqu’une version active existe.

Les tables déjà créées par la première V0.9.4 sont réutilisées de façon idempotente.

## Déploiement

1. Sauvegarder la base :

   ```bash
   cp ./data/backlog.sqlite ./data/backlog.sqlite.bak-$(date +%Y%m%d-%H%M%S)
   ```

2. Remplacer les sources de l’image par cette archive puis reconstruire l’image `dev`.
3. Conserver le même montage : `./data:/data`.
4. Conserver le jeton `ADMIN_TOKEN` et les URL Ollama/SearXNG.
5. Recréer le conteneur, pas seulement le redémarrer.

Le `compose.yaml` fourni exécute le conteneur avec `user: "1000:1000"`, `read_only: true`, `cap_drop: ALL` et un `/tmp` en `tmpfs`.

Vérification après déploiement :

```bash
docker inspect backlog-test --format 'User={{.Config.User}} CapDrop={{json .HostConfig.CapDrop}} ReadOnly={{.HostConfig.ReadonlyRootfs}}'
docker logs --tail 30 backlog-test
```

Résultat attendu :

```text
User=1000:1000 CapDrop=["ALL"] ReadOnly=true
```

## Premier parcours

1. Vérifier la bibliothèque et ouvrir quelques fiches.
2. Ouvrir **Administration IA**, saisir le jeton et tester Ollama.
3. Ouvrir **Réseau de similarité**.
4. Vérifier ou modifier la sélection de 50 jeux.
5. Lancer **Compléter le réseau**. L’opération réutilise ce qui est déjà exploitable, convertit les profils historiques reconnus, régénère uniquement les profils insuffisants, crée les embeddings manquants puis recalcule les similarités.
6. Utiliser **Recalculer le réseau** uniquement après une modification manuelle de la sélection ou des profils.
7. Évaluer les cinq voisins de quelques jeux connus.

## Variables du réseau

| Variable | Défaut | Rôle |
|---|---:|---|
| `EXPERIMENT_SIZE` | `50` | taille de la sélection initiale |
| `USE_DRAFT_PROFILES` | `true` | autoriser les candidats dans le laboratoire |
| `NETWORK_USABLE_THRESHOLD` | `0.45` | complétude minimale du socle comparable avant régénération |
| `NETWORK_JOB_POLL_MS` | `500` | intervalle interne de suivi d’une régénération Qwen3 |
| `NETWORK_GAME_TIMEOUT_MS` | `2700000` | délai maximal d’une régénération par jeu |
| `USEFUL_SIMILARITY_THRESHOLD` | `0.55` | seuil provisoire de densité utile |
| `AI_EMBEDDING_TIMEOUT_MS` | `120000` | délai maximal par requête d’embedding |

Toutes les mutations du réseau utilisent le même contrôle `ADMIN_TOKEN` que le reste de Backlog.

## Tests

```bash
npm test
npm run check
```

La livraison comprend **52 tests** couvrant les fonctions historiques, l’intégration du réseau, la conversion des profils V1, la régénération Qwen3, la création d’embeddings EmbeddingGemma, la non-promotion des candidats, la reprise idempotente, la migration SQLite additive, la normalisation de `uncertainties: []`, la validation stricte des dimensions principales et la poursuite du lot après un échec individuel.
