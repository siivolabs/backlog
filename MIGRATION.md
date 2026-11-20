# Migration vers Backlog V0.9.7

La migration depuis V0.9.6 est **additive, idempotente et non destructive**. Les six tables Discovery V0.9.6 et toutes les données antérieures sont conservées.

## Avant le déploiement

1. Arrêter le conteneur.
2. Sauvegarder le fichier SQLite monté dans `/data`.
3. Publier le contenu de l’archive puis reconstruire l’image.
4. Recréer le conteneur en conservant le même volume `/data`.
5. Vérifier que `/healthz` annonce `0.9.7`.

## Schéma ajouté

- `discovery_run_context_v097` : mode `initial`, `refine` ou `explore`, run parent, exclusions et volume de mémoire relu ;
- `discovery_recommendation_intentions_v097` : état, confiance, justification et éléments connus pour chaque motivation ;
- `discovery_feedback_memory_v097` : familiarité, évaluations explicites et compteurs de réutilisation ;
- `discovery_game_intention_memory_v097` : association exacte validée, rejetée ou incertaine entre un jeu et une intention.

Les commentaires V0.9.6 existants sont relus directement depuis `discovery_feedback_v096`, même s’ils précèdent ces nouvelles tables. Ils restent attachés à leur AppID et aux intentions de la recommandation source.

## Retour arrière

Une image V0.9.6 peut relire la même base : elle ignore les quatre tables V0.9.7 et continue d’utiliser ses six tables. Les recherches créées par la V0.9.7 restent visibles dans les tables V0.9.6, tandis que les évaluations indépendantes et la mémoire ne sont simplement pas exploitées par l’ancienne image.
