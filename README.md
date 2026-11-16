# Backlog v0.4

Backlog v0.4 réunit dans le même conteneur :

- l’interface HTML/CSS/JavaScript de la bibliothèque Steam ;
- l’import local d’un export `GetOwnedGames` (`response.txt` ou JSON) ;
- les jaquettes Steam ;
- la recherche, les filtres, le tri, les statistiques et deux modes d’affichage ;
- un proxy local vers la fiche Steam d’un jeu ;
- un enrichissement volontairement limité à **10 jeux par lot**.

## Limites volontaires de cette version

- Le fichier Steam reste uniquement dans la mémoire du navigateur.
- Les genres enrichis disparaissent au rechargement de la page.
- Aucun enrichissement automatique des 4 321 jeux n’est effectué.
- Le cache du serveur est uniquement en mémoire et expire après 30 minutes.
- L’application n’intègre ni compte utilisateur ni authentification.

Le cache persistant, la file d’attente globale et la synchronisation complète restent réservés à une version ultérieure.

## Arborescence

```text
backlog/
├── public/
│   ├── index.html
│   ├── styles.css
│   └── app.js
├── test/
│   └── server.test.js
├── .dockerignore
├── compose.yaml
├── Dockerfile
├── package.json
├── README.md
└── server.js
```

Le workflow GitHub Actions déjà présent dans `.github/workflows/` ne doit pas être supprimé.

Tests locaux, sans dépendance externe :

```bash
npm test
```

## Publication via GitHub Web

1. Décompresser l’archive v0.4.
2. Dans le dépôt `siivolabs/backlog`, remplacer `server.js`, `Dockerfile`, `compose.yaml` et `README.md`.
3. Ajouter `.dockerignore`, `package.json`, le dossier `public` et, si souhaité, le dossier `test`.
4. Conserver `.github/workflows/docker-publish.yml`.
5. Valider avec un message comme `Integrate Backlog v0.4 UI`.
6. Attendre que l’action GitHub reconstruise `ghcr.io/siivolabs/backlog:dev`.

## Déploiement avec Dockge

Le `compose.yaml` fourni suppose que :

- Nginx Proxy Manager utilise le réseau Docker externe `npm_default` ;
- le Proxy Host transmet vers `backlog-test` sur le port interne `3000` ;
- aucun port Backlog n’est publié sur le NAS.

Dans Dockge :

1. effectuer **Pull** pour récupérer la nouvelle image `dev` ;
2. recréer/redéployer le conteneur ;
3. ouvrir `http://backlog.home/` ;
4. tester l’AppID `400` ;
5. importer `response.txt` ;
6. lancer un seul lot de 10 jeux et vérifier les genres.

## Vérifications rapides

```bash
curl http://127.0.0.1:3000/healthz
curl http://127.0.0.1:3000/api/steam/400
```

La première commande doit renvoyer `{"status":"ok","version":"0.4.0"}`. La seconde dépend de l’accès Internet à Steam.

Si aucun port n’est publié sur l’hôte, exécuter ces commandes depuis le conteneur ou tester via le Proxy Host Nginx.

## Sécurité

Le conteneur :

- fonctionne avec l’utilisateur non privilégié `node` ;
- accepte un système de fichiers en lecture seule ;
- n’utilise aucun volume ni secret Steam ;
- retire les capacités Linux supplémentaires ;
- applique des en-têtes HTTP restrictifs ;
- valide les AppID et limite les requêtes de métadonnées.

Le Proxy Host doit rester limité au réseau local ou protégé par une règle d’accès. Un réseau Docker partagé contrôle le chemin réseau, mais ne remplace pas l’authentification.
