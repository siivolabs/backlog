# Migration vers Backlog 0.9.2

## Principe de sécurité

La migration est **additive et idempotente**. Au démarrage, Backlog 0.9.2 :

1. détecte le SQLite existant dans `/data` ou via `DATABASE_PATH` ;
2. conserve toutes les tables et lignes existantes ;
3. ajoute à `ai_profile_versions` les colonnes `profile_schema_version`, `profile_quality`, `profile_completeness_score`, `semantic_quality_score` et `evidence_coverage` ;
4. marque les lignes historiques sans version explicite comme schéma `legacy`, sans modifier leur `profile_json` ;
5. conserve les versions actives, candidates, rejetées, sources, corrections manuelles, embeddings, similarités et données joueur ;
6. conserve sous `ai_document_sources_legacy_v090` une éventuelle ancienne table documentaire incompatible ;
7. inscrit `schema_version=0.9.2` dans `ai_v09_meta` ;
8. ne crée aucune tâche d’analyse automatique.

La 0.9.2 ne convertit pas silencieusement les anciens profils. Une réanalyse individuelle crée une nouvelle version `schema_version: "2.0"` et laisse la version active en place jusqu’à validation humaine.

## Procédure recommandée

1. **Arrêter Backlog** pour fermer proprement le journal WAL.
2. Sauvegarder le volume complet :

   ```bash
   chmod +x scripts/backup-and-verify.sh
   ./scripts/backup-and-verify.sh /srv/docker/backlog/data
   ```

3. Si le fichier SQLite a un nom non standard, définir `DATABASE_PATH` explicitement.
4. Conserver le montage `./data:/data` et les adresses Ollama/SearXNG accessibles depuis le conteneur.
5. Publier les fichiers 0.9.2 à la racine du dépôt et reconstruire l’image.
6. Vérifier `/healthz` : la version doit être `0.9.2`.
7. Exécuter **Tester Ollama** et vérifier l’étape `completed`.
8. Comparer le nombre de jeux et de versions de profils avec la sauvegarde.
9. Réanalyser **uniquement Euro Truck Simulator 2** et inspecter la candidate.
10. Si elle est correcte, répéter avec **Control**, puis **Satisfactory**.

## Contrôles du pilote

- aucune caractéristique ne vaut seulement `documented`, `interpreted`, `unknown`, `contradictory` ou `human_corrected` ;
- les dimensions complexes sont rendues comme objets structurés ;
- une absence connue, telle qu’une narration centrale absente, est décrite comme caractéristique et non comme donnée inconnue ;
- les statuts et sources restent dans `field_status` ;
- la complétude documentaire et la complétude du profil sont affichées séparément ;
- les outils techniques ne dominent pas les éléments `core` ;
- les durées de périmètres différents ne sont pas présentées comme contradictoires ;
- l’ancienne version active reste disponible tant que la candidate n’est pas validée ;
- aucun embedding n’est créé pour un profil sémantiquement insuffisant.

## Retour arrière

1. Arrêter le conteneur 0.9.2.
2. Restaurer le dossier de sauvegarde complet dans `/data`.
3. Redéployer l’image précédente.

Un retour d’image seul ne supprime pas les colonnes additives 0.9.2 ; restaurer le volume garantit un état strictement identique.
