# Backlog Core V1.2.2

Intégration complète des fonctions attendues pour la V1.2 sur **la base SQLite historique V1.1.4**. L'application n'utilise et ne crée aucune base de remplacement.

## Garanties de continuité

- chemin historique prioritaire : `DATABASE_PATH=/data/backlog-core.sqlite` ;
- volume historique inchangé : `${DATA_PATH:-./data}:/data` ;
- démarrage refusé si le fichier SQLite n'existe pas, est vide, incohérent ou ne contient pas `games` et `profiles` ;
- refus si `DATABASE_PATH` et l'alias `DB_PATH` ciblent des fichiers différents ;
- aucune suppression, reconstruction ou modification des lignes de `games` et `profiles` ;
- aucune base SQLite incluse dans l'archive ;
- ré-enrichissement désactivé par défaut.

Au premier démarrage, et seulement si l'état V1.2 n'existe pas encore, Backlog crée une sauvegarde de sécurité `backlog-core.sqlite.pre-v1.2.2-….bak`, puis ajoute **dans le même fichier historique** deux tables isolées :

- `game_user_state` : état manuel et réversible « Terminé » ;
- `recommendation_history` : renouvellement des propositions.

Cette migration est additive, transactionnelle et idempotente. Les lignes des 4 321 jeux et profils ne sont pas recopiées dans une nouvelle base.

## Fonctions V1.2 intégrées

1. **Qualité documentaire** : les profils insuffisants ou spéculatifs sont exclus.
2. **Deux indicateurs** : proximité sémantique et fiabilité documentaire restent séparées.
3. **Renouvellement** : les résultats récemment présentés sont temporairement dépriorisés.
4. **Terminé** : le statut persiste, est réversible et retire immédiatement le jeu de Découverte.
5. **Surprends-moi** : sélection diversifiée sans embedding de requête.
6. **Affichage historique restauré** : jaquette enregistrée ou repli Steam, description du jeu ou résumé de profil, fiche complète, sources, modèles et embedding.

Un jeu terminé peut toujours être consulté et servir de jeu de référence. Il est uniquement exclu comme candidat dans les recommandations.

## Déploiement Dockge / Docker Compose

1. Arrêter l'ancienne version.
2. Conserver le dossier de données V1.1.4 à son emplacement actuel.
3. Copier `.env.example` vers `.env` et renseigner un `ADMIN_TOKEN` long.
4. Vérifier que `DATA_PATH` pointe vers le dossier qui contient déjà `backlog-core.sqlite`.
5. Lancer `docker compose up -d`.
6. Vérifier `/healthz` avant d'utiliser l'interface.

```bash
cp .env.example .env
# Adapter uniquement DATA_PATH et ADMIN_TOKEN si nécessaire.
docker compose up -d
curl http://127.0.0.1:3000/healthz
```

Résultat attendu : version `1.2.2`, `database: historical-existing`, capacités `completion` et `recommendationHistory` actives, et les compteurs historiques attendus.

> Ne créez pas un nouveau dossier `data` vide. Si `backlog-core.sqlite` est absent, Backlog refuse de démarrer au lieu de créer une base.

## Test du bouton « Terminé »

1. Saisir le jeton administrateur dans l'interface.
2. Ouvrir Découverte et noter un jeu proposé.
3. Cliquer **Terminé** sur sa carte : la carte disparaît immédiatement.
4. Relancer la même découverte : le jeu ne doit plus apparaître.
5. Dans Bibliothèque, filtrer sur **Terminés** et vérifier sa présence.
6. Cliquer **Rouvrir** : le jeu redevient éligible aux recommandations.
7. Redémarrer le conteneur et confirmer que le statut a persisté.

## Développement et validation

Node.js 24 est recommandé (`node:sqlite`).

```bash
npm ci
npm run check
npm test
```

Le diagnostic en lecture seule n'initialise pas l'état V1.2 :

```bash
npm run diagnose-db -- /chemin/vers/backlog-core.sqlite
```

## Sécurité des écritures

Le bouton Terminé, les retours Pertinent/Écarter, l'import et le pilotage de l'enrichissement exigent `ADMIN_TOKEN`. Le navigateur conserve ce jeton dans `sessionStorage`, pas dans l'archive.

## Retour arrière

1. arrêter le conteneur ;
2. conserver la base courante pour diagnostic ;
3. si nécessaire, remettre la sauvegarde `.pre-v1.2.2-….bak` sous le nom `backlog-core.sqlite` ;
4. redémarrer l'ancienne image avec le même volume.
