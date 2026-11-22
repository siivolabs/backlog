# Rapport de validation — Backlog Core V1.1.4

Date : 22 novembre 2026  
Runtime : Node.js 24.22.1  
npm : 11.21.1

## Résultat final

- `npm ci --ignore-scripts` : **réussi**, 0 vulnérabilité signalée.
- `npm test` : **15/15 tests réussis**.
- `npm run check` : **réussi**, 21 fichiers JavaScript vérifiés.
- `node --check public/app.js` et `public/reference-search.js` : **réussi**.
- `compose.yaml` et `.github/workflows/docker-publish.yml` : **YAML valide**.
- Cohérence GHCR/Dockge : le workflow publie `dev`, `latest` et `sha-*`; le Compose utilise `dev`.
- Démarrage d’un étage runtime reconstitué avec les fichiers copiés par le Dockerfile : **réussi**.
- `GET /healthz` : `status=ok`, `version=1.1.4`, `database=ok`.
- `GET /api/config` : version `1.1.4`, jeton administrateur détecté.
- Vérification du manifeste SHA-256 après extraction : **réussie**, 37 fichiers contrôlés.

## Corrections V1.1.4 couvertes

1. Recherche de bibliothèque par titre, studio et Steam AppID.
2. Résolution d’un titre sélectionné vers le véritable AppID.
3. Annulation de la recherche précédente avec `AbortController`.
4. Rejet déterministe d’une réponse asynchrone devenue obsolète, même si le transport ignore l’annulation.
5. Sélecteur Résonances indépendant des résultats paginés de la Bibliothèque.
6. Ouverture au clic et au clavier des cartes enrichies.
7. Route de profil avec validation de l’AppID, réponses 400/404 et lecture réussie.
8. Vérification qu’une consultation de profil ne change ni `games`, ni `profiles`, ni `discovery_feedback`.
9. Affichage des champs de profil, y compris les structures JSON imbriquées.

## Non-régressions V1.1.3

Les modules suivants sont byte-à-byte identiques à la source V1.1.3 :

- `src/db.js` — schéma et migrations SQLite ;
- `src/worker.js` — file et campagne autonomes ;
- `src/processor.js` et `src/ollama.js` — enrichissement, profils et embeddings ;
- `src/discovery.js` — Résonances, sessions et corrections ;
- `src/auth.js` — jeton administrateur.

La suite existante confirme également la conservation des couvertures, l’import non destructif, la migration additive réexécutable, la reprise après redémarrage, la pause après le jeu en cours et l’isolation des erreurs.

## Anomalie détectée pendant l’intégration

Le kit V1.1.4-rc.1 appliqué tel quel aux sources réelles V1.1.3 produisait une erreur de syntaxe dans `public/app.js` : la fonction `feedback` contenait `await` sans être déclarée `async`. La promotion en V1.1.4 a été bloquée, l’erreur a été corrigée, puis tous les contrôles ci-dessus ont été relancés avec succès. Le numéro de version runtime, resté à `1.1.3` dans `src/config.js`, a également été corrigé et vérifié par le smoke test.

## Propreté de la livraison

La vérification finale refuse la présence de :

- l’ancien dossier `test/` ;
- `node_modules/` ;
- bases ou journaux SQLite ;
- `data/`, `backups/`, `coverage/` ;
- sauvegarde `.backlog-hotfix-*` ;
- fichier `.env` ou archive imbriquée.

## Limites déclarées

Aucun moteur Docker/Podman n’est installé dans l’environnement de préparation : `docker build` n’a donc pas été exécuté localement. L’étage runtime a été reconstitué suivant les `COPY` du Dockerfile et démarré avec succès. Le workflow GitHub Actions fourni doit encore exécuter la construction Docker réelle et la publication GHCR après le remplacement du dépôt.

Aucun test n’a été exécuté sur la base SQLite réelle du NAS et **aucun déploiement NAS n’a été effectué**. Les tests utilisent des bases temporaires reproduisant le schéma attendu ; la procédure de déploiement demande de conserver et sauvegarder le volume actuel.
