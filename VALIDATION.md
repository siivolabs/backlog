# Validation de Backlog Core V1.2.2

Date : 23 novembre 2026

## Résultat

- vérification syntaxique : réussie ;
- tests automatisés : **7/7 réussis** ;
- fixture de non-régression : **4 321 jeux et 4 321 profils** au schéma historique V1.1.4 ;
- empreinte métier de `games` et `profiles` : identique avant/après initialisation V1.2 ;
- base absente : démarrage refusé, aucun fichier créé ;
- base non reconnue : démarrage refusé, aucune table ajoutée ;
- conflit `DATABASE_PATH` / `DB_PATH` : démarrage refusé ;
- ajout V1.2 : uniquement `game_user_state` et `recommendation_history` ;
- migration : transactionnelle, idempotente et annulée entièrement sur table incompatible ;
- sauvegarde : créée une seule fois avant le premier ajout V1.2 ;
- jaquette Steam de repli, description de profil et fiche enrichie : validées ;
- statut Terminé : persistant après réouverture de SQLite ;
- exclusion de Découverte : validée immédiatement après marquage et après redémarrage ;
- réouverture : rend le jeu de nouveau éligible ;
- endpoint Terminé sans jeton : refus HTTP 401 ;
- endpoint Terminé avec jeton : succès HTTP 200 ;
- diagnostic lecture seule : `quick_check=ok` et `unchanged=true` ;
- test Docker : non exécuté, moteur Docker absent de l'environnement de construction.

## Commandes exécutées

```text
npm install --package-lock-only --ignore-scripts
npm run check
npm test
npm run diagnose-db -- <fixture-1.1.4>
```

## Limite explicite

La base réelle du NAS n'a pas été ouverte, copiée, migrée ni modifiée. Les contrôles ont été exécutés sur des fixtures temporaires reproduisant le schéma historique et, pour la non-régression principale, les volumes de 4 321 jeux et 4 321 profils.
