# Migration de Backlog 0.8.x vers 0.9.0

## Principe de sécurité

La migration est **additive**. Au démarrage, Backlog 0.9 :

1. détecte le fichier SQLite existant dans `/data` (ou utilise `DATABASE_PATH`) ;
2. crée uniquement les tables préfixées `ai_v09_*`, `ai_profile_*`, `ai_analysis_*`, `ai_similarity_*` et `player_game_experience` manquantes ;
3. repère une table historique de profils IA par introspection ;
4. importe chaque profil 0.8 comme **version 1 active, générée mais non validée** ;
5. enregistre la fin de l’import dans `ai_v09_meta`, ce qui rend l’opération idempotente.

Aucune table Steam, IGDB ou bibliothèque existante n’est supprimée ou modifiée.

## Procédure recommandée

1. **Arrêter Backlog** dans Dockge afin que SQLite ferme proprement son journal WAL.
2. Sauvegarder le volume complet :

   ```bash
   chmod +x scripts/backup-and-verify.sh
   ./scripts/backup-and-verify.sh /srv/docker/backlog/data
   ```

3. Vérifier le nom du fichier SQLite présent dans le volume.
4. Si le nom n’est pas standard, définir explicitement :

   ```yaml
   DATABASE_PATH: "/data/nom-existant.sqlite"
   ```

5. Conserver le même montage `./data:/data` et les variables Ollama/SearXNG actuelles.
6. Publier les fichiers 0.9 dans le dépôt en conservant `.github/workflows/docker-publish.yml`.
7. Attendre la construction de `ghcr.io/siivolabs/backlog:dev`, puis recréer le conteneur.
8. Ouvrir le tableau de bord et vérifier :
   - le nombre total de jeux ;
   - les profils importés ;
   - la table SQLite détectée ;
   - le test Ollama ;
   - un profil et ses sources ;
   - une réanalyse individuelle.

## Retour arrière

1. Arrêter le conteneur 0.9.
2. Restaurer le dossier de sauvegarde complet dans le volume `/data`.
3. Redéployer l’image 0.8.x précédente.

Les tables 0.9 n’entrent pas en conflit avec les anciennes tables ; un retour d’image seul est généralement possible, mais restaurer la sauvegarde garantit un état identique.

## Sémantique des versions

- Une première analyse sans version active peut devenir active, avec l’état `generated`.
- Une réanalyse crée une version `draft` et conserve la version active.
- `Valider cette version` rend la candidate active et classe l’ancienne en `superseded`.
- `Rejeter` conserve la version active précédente.
- Les sorties Qwen, corrections humaines et retours personnels restent séparés.
