# Migration vers Backlog 0.9.3.1

## Depuis Backlog 0.9.3

Le correctif 0.9.3.1 ne modifie aucune table ni colonne. La valeur `schema_version=0.9.3` dans `ai_v09_meta` reste volontairement inchangée : elle décrit le schéma SQLite, commun aux versions 0.9.3 et 0.9.3.1. Le remplacement des fichiers applicatifs ne réécrit ni les profils, ni les dossiers, ni les tâches, ni les embeddings existants.

## Principe de sécurité

La migration est **additive et idempotente**. Au démarrage, Backlog 0.9.3 :

1. détecte le SQLite existant dans `/data` ou via `DATABASE_PATH` ;
2. conserve toutes les tables et lignes existantes ;
3. ajoute à `ai_profile_versions` les colonnes `evidence_precision`, `factual_quality`, `factual_accuracy_score`, `verification_json` et `verification_prompt_version` ;
4. ne convertit ni ne réécrit les `profile_json` 2.0 ou historiques ;
5. conserve versions actives, candidates, rejetées, sources, corrections, embeddings, similarités et données joueur ;
6. inscrit `schema_version=0.9.3` dans `ai_v09_meta` ;
7. ne crée aucune tâche d’analyse automatique.

Une réanalyse individuelle crée une version `schema_version: "2.1"`. La version active reste en place jusqu’à validation humaine. Les profils 2.0 restent consultables, mais seules les nouvelles candidates bénéficient des preuves précises et de la vérification factuelle.

## Procédure recommandée

1. Arrêter Backlog afin de fermer proprement le journal WAL.
2. Sauvegarder le volume complet :

   ```bash
   chmod +x scripts/backup-and-verify.sh
   ./scripts/backup-and-verify.sh /srv/docker/backlog/data
   ```

3. Si le fichier SQLite a un nom non standard, définir `DATABASE_PATH` explicitement.
4. Conserver le montage `./data:/data` et les adresses Ollama/SearXNG accessibles depuis le conteneur.
5. Publier les fichiers 0.9.3.1 à la racine du dépôt et reconstruire l’image.
6. Vérifier `/healthz` : la version doit être `0.9.3.1`.
7. Exécuter **Tester Ollama** et vérifier l’étape `completed`.
8. Comparer le nombre de jeux et de versions de profils avec la sauvegarde.
9. Réanalyser uniquement Euro Truck Simulator 2, Control et Satisfactory.
10. Contrôler le rapport factuel avant toute validation ou extension au lot pilote.

## Contrôles du pilote

- ETS2 et Satisfactory : `map_generation: fixed`, jamais `topology: procedural` ;
- Control et Satisfactory : `save_persistence: saved_between_sessions` ;
- Satisfactory : `reset_model: none` et narration non classée linéaire à cause des seuls objectifs ;
- les preuves détaillées citent des chemins et des sources spécifiques ;
- les mêmes dix sources ne sont pas répétées sur chaque dimension ;
- les notes « À corriger » réapparaissent dans la réanalyse suivante ;
- tout avertissement ou échec factuel bloque l’embedding et le bouton de validation ;
- l’ancienne version active reste disponible tant que la candidate n’est pas validée.

## Retour arrière

1. Arrêter le conteneur 0.9.3.1.
2. Restaurer le dossier de sauvegarde complet dans `/data`.
3. Redéployer l’image précédente.

Un retour d’image seul ne supprime pas les colonnes additives 0.9.3 ; restaurer le volume garantit un état strictement identique.
