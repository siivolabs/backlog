# Backlog Core V1.2.1 — correctif de reconnexion à la base historique 1.1.4

Ce livrable corrige uniquement la connexion de V1.2.1 à la base SQLite historique déjà enrichie. Il ne change pas l'architecture de Backlog, ne crée aucune base, ne reconstruit aucune table, n'exécute aucune migration et ne lance aucun ré-enrichissement.

## Diagnostic établi dans les sources

- V1.1.4 utilisait `DATABASE_PATH=/data/backlog-core.sqlite` et `${DATA_PATH:-./data}:/data`.
- V1.2.0 avait introduit `DATA_DIR=/app/data` et un défaut `backlog.sqlite`, donc un autre fichier et un autre point de montage.
- V1.2.1 a introduit le nouveau nom `DB_PATH` et exécutait une migration automatique au démarrage.
- L'interface V1.2.1 ne reconstruisait pas les jaquettes quand `cover_url` était vide et n'utilisait pas `profile_json.summary` comme description de repli.

Le correctif revient au contrat de connexion de V1.1.4 :

```yaml
environment:
  DATABASE_PATH: /data/backlog-core.sqlite
volumes:
  - ${DATA_PATH:-./data}:/data
```

`DATABASE_PATH` est prioritaire. `DB_PATH` reste accepté comme alias uniquement s'il cible exactement le même fichier. Si les deux diffèrent, le démarrage est refusé.

## Garde-fous

- le fichier SQLite doit déjà exister et être non vide ; sinon le démarrage échoue au lieu de créer une base ;
- les tables `games` et `profiles` et leurs colonnes essentielles sont contrôlées ;
- `PRAGMA quick_check` doit renvoyer `ok` ;
- aucune fonction de migration n'est appelée ;
- aucune table de V1.2 n'est créée si elle manque dans le schéma 1.1.4 ;
- le ré-enrichissement est désactivé par défaut avec `ENRICHMENT_ENABLED=false` ;
- les fonctions V1.2 dont les tables n'existent pas (par exemple `game_user_state`) sont signalées comme indisponibles au lieu de modifier le schéma.

## Diagnostic en lecture seule

À exécuter uniquement sur un chemin explicitement choisi :

```bash
node scripts/diagnose-database.mjs /chemin/vers/backlog-core.sqlite
```

Le script ouvre la base avec `readOnly: true`, affiche le chemin absolu, la taille, le SHA-256, `quick_check`, les nombres de jeux/profils/embeddings et vérifie que le SHA-256 du fichier n'a pas changé.

## Données restaurées à l'affichage

- jaquette enregistrée, ou repli Steam `header.jpg` calculé à partir de l'AppID ;
- description enregistrée, sinon `profile_json.summary`, sinon description de source ;
- fiche complète avec profil, sources, modèles et embedding ;
- Découverte sur les embeddings historiques, sans ré-enrichissement.

## Validation locale, sans NAS

```bash
npm run check
npm test
```

Les tests utilisent une base synthétique au schéma exact de V1.1.4 contenant 4 321 jeux et 4 321 profils. Ils vérifient notamment l'absence de création/migration, l'identité du fichier SQLite après les lectures HTTP, les jaquettes, descriptions, fiches et la réutilisation des embeddings.

Ce livrable n'a pas été déployé sur le NAS.
