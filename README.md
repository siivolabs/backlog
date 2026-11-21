# Backlog Core V1.1.1

Correctif de compatibilité SQLite entre Backlog Core V1.0 et V1.1. Cette version conserve la bibliothèque, les profils Core, les motivations et les corrections, puis permet à l’enrichissement global de continuer côté serveur.

## Correction principale

Une base V1.0 peut contenir `games.app_id TEXT`, `title` et `studio`, tandis que V1.1 utilisait directement `app_id INTEGER`, `name` et `developer`. `CREATE TABLE IF NOT EXISTS` ne transformant jamais une table existante, la création de l’index `games(name)` interrompait le démarrage.

V1.1.1 effectue désormais, avant la création des index :

1. détection du schéma réel ;
2. sauvegarde SQLite cohérente `backlog-core.pre-v1.1.1-*.sqlite` ;
3. validation de tous les App ID ;
4. conversion transactionnelle de `games` ;
5. conservation des colonnes V1.0 et ajout des colonnes V1.1 ;
6. mise en compatibilité non destructive des tables Core ;
7. `quick_check` et `foreign_key_check` avant validation ;
8. journalisation dans `schema_migrations` (`10101`).

La migration est réexécutable. Un second lancement ne recrée pas la sauvegarde et ne duplique aucune donnée.

## Données conservées

- jeux, couvertures, genres, descriptions, temps de jeu et dernière utilisation ;
- `inventory_metadata_json`, `source_table`, dates d’import et de mise à jour ;
- profils, sources, embeddings et versions de pipeline déjà générés ;
- campagne et tâches d’enrichissement ;
- motivations, sessions de découverte, verdicts et notes correctives ;
- données héritées des tables `enrichment_items`, `enrichment_runs`, `meta` et `work_batch`.

Les tables héritées qui ne sont plus utilisées par le moteur V1.1 restent présentes et intactes. Leur état est enregistré dans `migration_compatibility` pour diagnostic.

## Déploiement GitHub → GHCR → Dockge

### 1. Déposer le projet sur GitHub

Copiez le contenu de ce dossier à la racine du dépôt `siivolabs/backlog`, puis poussez sur `main`. Le workflow :

- exécute les tests sous Node.js 24 ;
- construit les images `linux/amd64` et `linux/arm64` ;
- publie `ghcr.io/<propriétaire>/backlog:latest`.

Si le paquet GHCR est privé, Dockge doit être authentifié auprès de `ghcr.io`.

### 2. Préparer Dockge

```sh
cp .env.example .env
```

Définissez au minimum :

```dotenv
DATA_PATH=/chemin/absolu/vers/le/dossier/contenant/backlog-core.sqlite
IMAGE_NAME=ghcr.io/siivolabs/backlog
IMAGE_TAG=latest
OLLAMA_BASE_URL=http://host.docker.internal:11434
AI_ANALYSIS_MODEL=qwen3:32b
AI_EMBEDDING_MODEL=embeddinggemma
```

`DATA_PATH` doit viser le dossier existant, pas le fichier SQLite lui-même.

### 3. Prévol et sauvegarde

```sh
./scripts/preflight.sh
```

Ce script vérifie le volume et valide le Compose. La migration crée automatiquement une sauvegarde SQLite cohérente juste avant toute conversion. Pour utiliser `scripts/backup.sh`, arrêtez d’abord le conteneur afin de ne pas copier une base active en mode WAL.

### 4. Déployer

Dans Dockge : **Pull**, puis **Up**. En ligne de commande :

```sh
docker compose pull
docker compose up -d
docker compose logs -f backlog
```

Le journal doit afficher `V1.1.1` et une migration réussie. Ouvrez ensuite `http://ADRESSE_DU_NAS:3000` et vérifiez le nombre de jeux, quelques couvertures et plusieurs profils avant de reprendre la campagne.

## Vérification après migration

Depuis la copie locale du projet :

```sh
docker compose exec backlog node scripts/verify-database.mjs /data/backlog-core.sqlite
```

Le résultat attendu contient :

```json
{
  "integrity": "ok",
  "foreignKeyErrors": []
}
```

L’endpoint `/api/compatibility` expose également le contrôle des tables effectué par la migration.

## Retour arrière

1. Arrêtez le conteneur V1.1.1.
2. Ne modifiez pas la sauvegarde `*.pre-v1.1.1-*.sqlite`.
3. Renommez la base migrée pour la conserver à des fins de diagnostic.
4. Copiez la sauvegarde sous le nom `backlog-core.sqlite`.
5. Redéployez l’ancienne image.

Exemple, conteneur arrêté :

```sh
cd "$DATA_PATH"
mv backlog-core.sqlite backlog-core.v1.1.1-diagnostic.sqlite
cp backlog-core.pre-v1.1.1-AAAA-MM-JJ*.sqlite backlog-core.sqlite
```

## Développement et tests

Prérequis : Node.js 24 ou plus récent.

```sh
npm ci
npm test
MOCK_AI=1 DATABASE_PATH=/tmp/backlog-core.sqlite npm start
```

Les tests créent une base V1.0 représentative avec toutes les tables signalées, migrent deux fois la base, comparent les données, contrôlent les clés étrangères, vérifient la sauvegarde et testent le worker autonome.
