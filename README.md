# Backlog : test minimal du proxy Steam

## Rôle des fichiers
- `server.js` : sert une page de test et relaie **une fiche Steam à la fois**. Il ne lit aucune clé API.
- `Dockerfile` : construit une image Node.js et lance le service avec un utilisateur non privilégié.
- `compose.yaml` : publie le service uniquement sur le port 3087 de l'interface loopback du NAS.

## Avant de lancer
1. Lire les trois fichiers. Aucun volume, aucun accès privilégié, aucune clé Steam.
2. Le NAS doit avoir accès à Internet pour télécharger l'image Node.js et joindre Steam.
3. Copier le dossier sur le NAS, puis dans ce dossier : `docker compose config` pour inspecter la configuration.
4. Si elle te convient : `docker compose up --build -d`.
5. Sur le NAS, ouvrir `http://127.0.0.1:3087` ou tester `curl http://127.0.0.1:3087/api/steam/400`.
6. Depuis ton PC, le port n'est **pas accessible directement** : utilise un tunnel SSH `ssh -L 3087:127.0.0.1:3087 utilisateur@nas`, puis ouvre `http://127.0.0.1:3087` sur ton PC.
7. Voir les journaux : `docker compose logs -f` (Ctrl+C quitte l'affichage).
8. Arrêter et supprimer le conteneur : `docker compose down`.

## Limites
Ce test ne synchronise pas la bibliothèque, ne conserve aucune donnée et ne résout pas encore la question de l'enrichissement en masse. Le service ne doit pas être exposé publiquement sans authentification, quotas et cache. Si Steam refuse ou limite la requête, le message d'erreur sera visible.
