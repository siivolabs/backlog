# Livraison Backlog Core V1.1.4

Cette archive est un **instantané complet** construit à partir de la livraison V1.1.3 vérifiée, puis corrigé avec le périmètre du kit V1.1.4-rc.1.

## Inclus

- application complète Backlog Core V1.1.4 ;
- interface bleue, couvertures et jeton administrateur préservés ;
- base SQLite compatible sans nouvelle migration ;
- pipeline d’enrichissement autonome V1.1.3 inchangé ;
- profils, embeddings, Découverte, sessions et corrections préservés ;
- recherche Résonances indépendante par titre, studio ou AppID ;
- sélection du véritable AppID et protection contre les réponses asynchrones obsolètes ;
- consultation en lecture seule des profils enrichis depuis la Bibliothèque ;
- tests Node 24, contrôle statique, Dockerfile, workflow GHCR et Compose Dockge ;
- documentation de déploiement, validation et retour arrière.

## Nettoyage du dépôt

L’archive ne contient aucun dossier `test/` hérité, aucune donnée, aucune base SQLite, aucun `node_modules` et aucune sauvegarde du kit correctif. Elle doit remplacer complètement le contenu suivi du dépôt, en conservant uniquement `.git/` localement.

Le workflow publie `ghcr.io/siivolabs/backlog:dev`, `:latest` et `:sha-*`. Le Compose fourni utilise `:dev`, comme la stack Dockge existante.

## Déploiement

Aucun déploiement NAS n’a été effectué. Sauvegarder puis conserver le volume SQLite actuel lors du redéploiement : V1.1.4 ne requiert aucune migration supplémentaire.
