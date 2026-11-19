# Migration vers Backlog V0.9.4.3

La migration est additive et idempotente. Elle ne supprime aucune table, aucun profil, aucun dossier, aucune source, aucun embedding et aucun retour utilisateur.

## Avant le déploiement

Arrêter le conteneur puis sauvegarder `/srv/docker/backlog/data/backlog.sqlite`.

## Ajouts SQLite

- `ai_analysis_checkpoints_v0943` : sortie et durée de chaque étape terminée.
- `ai_analysis_events_v0943` : journal horodaté d’une tâche.
- Colonnes de priorité, reprise, campagne, catégorie d’erreur et durée dans `ai_analysis_jobs`.
- Colonnes de mode, pause, résumé et statistiques dans `similarity_completion_runs_v0941`.
- Colonnes de priorité, étape, tâche, tentatives, erreur, durées et journal dans `similarity_completion_items_v0941`.

Les campagnes qui étaient `running` au redémarrage deviennent `interrupted` et sont proposées à la reprise. Les profils historiques restent inchangés.

## Retour arrière

Une ancienne image peut continuer à lire les tables qu’elle connaît ; elle ignorera les tables V0.9.4.3. Restaurer la sauvegarde SQLite seulement si un retour complet des données est nécessaire.
