# Backlog Core V1.2.1

Version corrective complète de Backlog V1.2, conçue pour migrer **sans destruction** la base Core V1.1.x réelle (`backlog-core.sqlite`).

## Correction critique

La migration V1.2.0 créait certains index avant d'avoir adapté les tables déjà présentes. Sur une base Core historique, `CREATE TABLE IF NOT EXISTS` conserve la table existante telle quelle ; une instruction suivante pouvait donc référencer une colonne absente (`app_id`, `candidate_app_id` ou `created_at`) et interrompre le démarrage.

V1.2.1 :

1. crée une sauvegarde SQLite cohérente avec `VACUUM INTO` avant toute modification ;
2. ouvre une transaction exclusive de migration ;
3. inspecte chaque table avec `PRAGMA table_info` ;
4. ajoute et peuple les colonnes canoniques avant de créer les index ;
5. ne supprime, ne renomme et ne reconstruit aucune table métier ;
6. annule toute la transaction au premier échec ;
7. initialise le statut utilisateur des jeux seulement après validation du schéma ;
8. rend la migration idempotente avec `PRAGMA user_version=1201`.

La fixture de régression reproduit la structure observée de `games` et **4 321 jeux + 4 321 profils**. Le test compare une empreinte de toutes les lignes métier avant/après migration.

## Fonctions incluses

- bibliothèque persistante et recherche par titre, studio ou AppID ;
- import Steam non destructif ;
- profils expérientiels, modèles, sources et embeddings consultables ;
- enrichissement Ollama par lots ;
- Découverte par similarité sémantique ;
- contrôle de fiabilité documentaire et exclusion des profils spéculatifs ;
- score séparant résonance et fiabilité ;
- retours **Pertinent** / **Écarter** ;
- historique et dépriorisation des jeux récemment présentés ;
- diversification des genres ;
- mode **Surprends-moi** ;
- bouton **Terminé**, réversible ;
- exclusion des jeux terminés des recommandations sans suppression du profil ;
- authentification des opérations d'administration par jeton.

## Déploiement Dockge

### 1. Sauvegarder le volume

Même si V1.2.1 crée sa propre sauvegarde avant migration, faites une copie externe du dossier `data`.

```bash
cp -a /srv/docker/backlog/data \
  /srv/docker/backlog/data.backup-$(date +%Y%m%d-%H%M%S)
```

### 2. Vérifier le chemin de la vraie base

Le Compose fourni utilise explicitement :

```yaml
DATA_DIR: /data
DB_PATH: /data/backlog-core.sqlite
volumes:
  - ./data:/data
```

Ne remplacez pas ce chemin par `/data/backlog.sqlite` : ce dernier correspond à l'ancienne base historique.

### 3. Publier l'archive dans GitHub

Remplacez le contenu du dépôt (sauf `.git` et vos secrets), puis poussez sur `main`. Le workflow fourni publie :

- `ghcr.io/siivolabs/backlog:dev` ;
- `ghcr.io/siivolabs/backlog:latest` ;
- `ghcr.io/siivolabs/backlog:1.2.1`.

### 4. Configurer `.env`

```bash
cp .env.example .env
```

Définissez au minimum `ADMIN_TOKEN`. Vérifiez `OLLAMA_URL`.

### 5. Pull et redéploiement

Dans Dockge : **Pull**, puis **Update/Up**. Au premier démarrage, le journal affiche le chemin de la sauvegarde `backlog-core.sqlite.pre-v1.2.1-….sqlite`.

### 6. Vérifier

```bash
curl http://127.0.0.1:3087/healthz
```

Résultat attendu :

```json
{"status":"ok","version":"1.2.1","schemaVersion":1201,"games":4321,"profiles":4321}
```

## Validation locale

Node.js 22.5+ est requis pour `node:sqlite`.

```bash
npm test
npm run check
```

Tester une copie d'une base sans toucher à l'original :

```bash
node scripts/verify-database.mjs /chemin/vers/backlog-core.sqlite
```

## Restauration

1. arrêter le conteneur ;
2. conserver la base ayant échoué pour diagnostic ;
3. recopier la sauvegarde `.pre-v1.2.1-….sqlite` vers `backlog-core.sqlite` ;
4. supprimer seulement les fichiers `backlog-core.sqlite-wal` et `backlog-core.sqlite-shm` associés à la tentative, conteneur arrêté ;
5. redémarrer l'ancienne image.

## Données et secrets

L'archive ne contient ni base SQLite, ni `.env`, ni jeton, ni `node_modules`.
