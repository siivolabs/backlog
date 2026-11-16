# Backlog v0.5

Backlog v0.5 conserve l’interface et l’ergonomie de la v0.4, mais déplace la bibliothèque Steam et les métadonnées enrichies dans une base **SQLite persistante**.

## Ce qui change en v0.5

- La bibliothèque importée est restaurée automatiquement après un rechargement, une nouvelle session ou un redémarrage du conteneur.
- Les genres récupérés auprès de Steam sont enregistrés dans SQLite et restent disponibles entre les sessions.
- Le volume Docker nommé `backlog_data` conserve `/data/backlog.sqlite` lors du remplacement de l’image ou de la recréation du conteneur.
- Le message **« La bibliothèque est vide »** disparaît dès que des résultats sont affichés.
- Si une bibliothèque existe mais qu’un filtre ne renvoie rien, l’interface affiche **« Aucun jeu ne correspond à vos critères »**.

L’apparence, les cartes, les statistiques, la recherche, les filtres, le tri, la pagination, l’affichage grille/liste et le lot d’enrichissement limité à dix jeux restent dans la continuité de la v0.4.

## Arborescence

```text
backlog/
├── .github/workflows/docker-publish.yml
├── public/
│   ├── index.html
│   ├── styles.css
│   └── app.js
├── test/server.test.js
├── .dockerignore
├── CHANGELOG.md
├── compose.yaml
├── Dockerfile
├── package.json
└── server.js
```

## Stockage SQLite

Par défaut :

```text
/data/backlog.sqlite
```

Le fichier principal et ses éventuels fichiers WAL restent dans le volume `backlog_data`. Ne retire pas ce volume lors d’un simple déploiement d’une nouvelle image.

Sauvegarde facultative depuis le NAS :

```bash
docker run --rm \
  -v backlog_backlog_data:/data:ro \
  -v "$PWD":/backup \
  alpine sh -c 'tar czf /backup/backlog-data.tgz -C /data .'
```

Le nom réel du volume peut être préfixé par le nom de la stack Dockge. Vérifie-le avec `docker volume ls`.

## Publication avec GitHub Web

1. Décompresse l’archive.
2. Remplace les fichiers correspondants dans `siivolabs/backlog`.
3. Conserve ton workflow existant s’il est déjà opérationnel ; le workflow fourni est compatible avec le tag `dev`.
4. Valide avec un message comme :

```text
Add SQLite persistence in Backlog v0.5
```

5. Attends la réussite de GitHub Actions.

## Déploiement dans Dockge

Le `compose.yaml` fourni suppose que Nginx Proxy Manager et Backlog partagent le réseau externe `npm_default`, et que le Proxy Host transmet vers `backlog-test:3000`.

1. Remplace la configuration Compose par celle de la v0.5.
2. Dans Dockge, effectue **Pull**.
3. Recrée le conteneur.
4. N’utilise pas une option qui supprime les volumes.
5. Ouvre `http://backlog.home/`.

Le nouveau volume sera créé automatiquement au premier lancement.

## Recette recommandée

1. Ouvrir `/healthz` et vérifier `{"status":"ok","version":"0.5.0","storage":"sqlite"}`.
2. Importer `response.txt` et vérifier les nombres habituels.
3. Confirmer que **« La bibliothèque est vide »** n’est plus visible quand les cartes sont affichées.
4. Recharger la page : la bibliothèque doit revenir sans nouvel import.
5. Enrichir jusqu’à dix jeux.
6. Recharger la page puis redémarrer le conteneur : les genres doivent toujours être présents.
7. Appliquer une recherche impossible : seul **« Aucun jeu ne correspond à vos critères »** doit apparaître.
8. Tester l’AppID `400` et un AppID invalide.

## Développement local

Backlog n’a aucune dépendance npm externe. Il utilise `node:sqlite`, disponible à partir de Node 22.5 ; l’image fournie utilise Node 24.

```bash
npm test
npm run check
DB_PATH=./backlog.sqlite npm start
```

## Sécurité et limites

- Conteneur non privilégié, capacités Linux retirées et système de fichiers racine en lecture seule.
- Écriture limitée au volume `/data` et à un petit `tmpfs`.
- Validation des AppID, limite de taille d’import et limite de requêtes vers Steam.
- Aucun compte utilisateur ni authentification : garde le Proxy Host sur ton réseau local ou protège-le.
- Aucun enrichissement massif automatique : un lot reste limité à dix jeux.
