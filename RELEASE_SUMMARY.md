# Livraison Backlog Core V1.1.3

Cette livraison repart du contrat fonctionnel, visuel et SQLite de Backlog Core V1.0 et n'ajoute que la fusion Bibliothèque/Enrichissement et la campagne autonome persistante.

## Inclus

- application complète;
- interface bleue avec couvertures;
- import d'inventaire et recherche;
- saisie et vérification du jeton administrateur;
- campagne globale serveur avec pause, reprise et récupération au redémarrage;
- suivi et relance des erreurs;
- profils et Découverte V1.0;
- tests Node 24;
- Dockerfile;
- workflow GitHub Actions vers GHCR;
- Compose Dockge;
- documentation de déploiement, compatibilité et retour arrière.

## Nettoyage du dépôt

L'archive ne contient aucun dossier `test/` hérité. Le script `npm run check` échoue volontairement si ce dossier réapparaît. Pour supprimer les fichiers déjà suivis par GitHub, suivre la procédure `git rm -r .` de `docs/DEPLOYMENT.md` avant de copier l'instantané complet.

Aucun déploiement NAS n'a été effectué.
