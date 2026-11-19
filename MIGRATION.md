# Migration vers Backlog V0.9.4.4

La migration depuis V0.9.4.3 est **sans changement de schéma**. Elle ne supprime ni ne réécrit aucune table, ligne, version de profil, source, embedding, similarité ou donnée utilisateur.

## Avant le déploiement

1. Arrêter le conteneur.
2. Sauvegarder le fichier SQLite monté dans `/data`.
3. Publier les fichiers de l’archive dans le dépôt puis reconstruire l’image.
4. Recréer le conteneur en conservant exactement le même volume `/data`.

Les tables de supervision V0.9.4.3 (`ai_analysis_checkpoints_v0943` et `ai_analysis_events_v0943`) sont conservées. Les campagnes et tâches interrompues restent reprenables ; les points de reprise terminés sont réutilisés.

## Variables ajoutées

- `AI_ANALYSIS_INACTIVITY_TIMEOUT_MS` : 480000 ms.
- `AI_PATH_REPAIR_INACTIVITY_TIMEOUT_MS` : 120000 ms.
- `AI_VERIFICATION_INACTIVITY_TIMEOUT_MS` : 480000 ms.
- `AI_OLLAMA_HEALTH_TIMEOUT_MS` : 10000 ms.
- `AI_OLLAMA_TOTAL_TIMEOUT_MS` : facultatif, désactivé par défaut ; permet d’imposer un plafond total si nécessaire.

## Retour arrière

Une image V0.9.4.3 peut relire la même base, car V0.9.4.4 n’ajoute aucun schéma SQLite. Restaurer la sauvegarde uniquement si un retour complet de l’état applicatif est souhaité.
