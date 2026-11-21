# Journal des modifications

## 1.1.0

- Suppression de toute sélection manuelle et de la limite fonctionnelle de 50 jeux.
- Fusion de Bibliothèque et Enrichissement.
- Orchestrateur serveur séquentiel persistant dans SQLite.
- Démarrage, suspension après le jeu courant, reprise et relance des seuls échecs.
- Reprise automatique des campagnes actives après redémarrage du conteneur.
- Isolation des erreurs par jeu et non-retraitement des profils déjà prêts.
- Disponibilité immédiate des profils dans le moteur unique de Découverte.
- Progression globale, activité actuelle, estimation restante et états par jeu.
- Livraison GitHub Actions/GHCR/Dockge, sans déploiement distant.
