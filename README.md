# Backlog V0.9.4.1 — correctif d’intégration

Cette livraison corrige la régression de la première V0.9.4. Elle repart intégralement de **Backlog V0.9.3.2** et ajoute le réseau expérimental comme une section de la même application.

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
- compléter volontairement les embeddings manquants ;
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

Elle ne supprime aucune table et ne modifie aucun état `active`, `draft`, `superseded` ou `rejected`. Le champ `embedding_json` n’est mis à jour que lorsqu’un administrateur lance explicitement **Compléter les embeddings**.

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
5. Lancer **Compléter les embeddings** si nécessaire.
6. Lancer **Recalculer le réseau**.
7. Évaluer les cinq voisins de quelques jeux connus.

## Variables du réseau

| Variable | Défaut | Rôle |
|---|---:|---|
| `EXPERIMENT_SIZE` | `50` | taille de la sélection initiale |
| `USE_DRAFT_PROFILES` | `true` | autoriser les candidats dans le laboratoire |
| `USEFUL_SIMILARITY_THRESHOLD` | `0.55` | seuil provisoire de densité utile |
| `AI_EMBEDDING_TIMEOUT_MS` | `120000` | délai maximal par requête d’embedding |

Toutes les mutations du réseau utilisent le même contrôle `ADMIN_TOKEN` que le reste de Backlog.

## Tests

```bash
npm test
npm run check
```

La livraison comprend les 41 tests de V0.9.3.2 et 3 tests supplémentaires couvrant l’intégration, la non-promotion des candidats et l’idempotence de la migration V0.9.4.
