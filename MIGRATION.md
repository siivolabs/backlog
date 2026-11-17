# Migration vers Backlog 0.9.1.2

## Principe de sécurité

La migration est **additive et idempotente**. Au démarrage, Backlog 0.9.1.2 :

1. détecte le SQLite existant dans `/data` ou via `DATABASE_PATH` ;
2. conserve toutes les tables et lignes existantes ;
3. ajoute seulement les colonnes de qualité/provenance manquantes aux tables 0.9.0 ;
4. conserve sous `ai_document_sources_legacy_v090` toute ancienne table `ai_document_sources` incompatible, puis crée les tables versionnées `ai_document_dossiers` et `ai_document_sources` ;
5. conserve l’import historique 0.8 déjà effectué ;
6. marque dans `ai_v09_meta` le schéma `0.9.1` ;
7. ne crée aucune tâche d’analyse automatique.

Les versions actives et candidates 0.9.0 restent inchangées. Les anciens profils sans provenance sont affichés comme profils historiques ; le rendu récursif évite `[object Object]`.

## Procédure recommandée

1. **Arrêter Backlog** dans Dockge pour fermer proprement le journal WAL.
2. Sauvegarder le volume complet :

   ```bash
   chmod +x scripts/backup-and-verify.sh
   ./scripts/backup-and-verify.sh /srv/docker/backlog/data
   ```

3. Vérifier le fichier SQLite. Si son nom n’est pas standard, définir explicitement :

   ```yaml
   DATABASE_PATH: "/data/nom-existant.sqlite"
   ```

4. Conserver le montage `./data:/data` et l’adresse Ollama réellement joignable depuis le conteneur.
5. Publier les fichiers 0.9.1.2 à la racine du dépôt en conservant le workflow GitHub existant.
6. Attendre la construction de l’image, puis recréer le conteneur.
7. Vérifier `/healthz` : la version doit être `0.9.1.2`.
8. Dans **Administration IA**, exécuter **Tester Ollama**. Le diagnostic doit atteindre l’étape `completed`.
9. Comparer le nombre de jeux et de profils à la version précédente.
10. Actualiser uniquement le dossier d’Euro Truck Simulator 2, puis inspecter les sources avant d’analyser.
11. Répéter le pilote avec Control et Satisfactory.

## Contrôles du pilote

Pour chacun des trois jeux :

- les descriptions Steam non vides figurent dans le dossier ;
- les données IGDB de `provider_cache` sont reprises lorsqu’elles existent ;
- les pages de DLC et catalogues génériques ne dominent pas la sélection ;
- les sources indiquent leur confiance, leur pertinence et les champs justifiés ;
- toute dimension est documentée, interprétée, inconnue ou contradictoire ;
- aucun `[object Object]` n’apparaît ;
- un profil insuffisant n’a pas d’embedding définitif ;
- la version active reste disponible tant que la candidate n’est pas validée.

## Retour arrière

1. Arrêter le conteneur 0.9.1.2.
2. Restaurer le dossier de sauvegarde complet dans `/data`.
3. Redéployer l’image précédente.

Un retour d’image seul ne supprime pas les tables 0.9.1, mais restaurer le volume garantit un état strictement identique.
