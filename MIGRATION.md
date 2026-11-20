# Migration vers Backlog V0.9.6

La migration depuis V0.9.5.0 est **additive, isolée et non destructive**. Elle ne supprime ni ne réécrit aucune version de profil, preuve, dossier, embedding, similarité, campagne, expérience ou retour existant.

## Avant le déploiement

1. Arrêter le conteneur.
2. Sauvegarder le fichier SQLite monté dans `/data`.
3. Publier le contenu de l’archive dans le dépôt puis reconstruire l’image.
4. Recréer le conteneur en conservant exactement le même volume `/data`.
5. Vérifier `/healthz` : la réponse doit annoncer `0.9.6`.
6. Ouvrir l’onglet **Découverte** et exécuter un premier parcours contrôlé.

## Schéma ajouté

Au premier démarrage, Backlog crée de façon idempotente :

- `discovery_interpretations_v096` : explication libre et interprétation encore modifiable ;
- `discovery_intentions_v096` : motivations explicitement confirmées ;
- `discovery_runs_v096` : exécutions, modèles, durées et erreurs ;
- `discovery_candidates_v096` : présélection hybride, scores et périmètre approfondi ;
- `discovery_recommendations_v096` : cinq recommandations, arguments, différences et incertitudes ;
- `discovery_feedback_v096` : retours qualitatifs et cible de correction.

Ces tables sont séparées des tables `ai_*`, `similarity_*`, `network_*` et `fast_semantic_*`. La V0.9.6 lit les métadonnées et embeddings existants mais ne les modifie pas.

## Variables ajoutées

- `DISCOVERY_LIBRARY_LIMIT` : 5000 jeux inspectés au maximum.
- `DISCOVERY_CANDIDATE_LIMIT` : 40 candidats conservés.
- `DISCOVERY_DEEP_CANDIDATES` : 12 candidats analysés par Qwen.
- `DISCOVERY_INTERPRET_MAX_TOKENS` : 1600.
- `DISCOVERY_ANALYSIS_MAX_TOKENS` : 3600.
- `DISCOVERY_INACTIVITY_TIMEOUT_MS` : 240000 ms.

## Retour arrière

Une image V0.9.5.0 peut relire la même base : elle ignore les six tables `discovery_*_v096`. Les données Discovery restent alors inutilisées. Ne restaurez la sauvegarde que si vous souhaitez également retirer les résultats expérimentaux créés après la migration.
