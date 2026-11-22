# Journal des versions

## 1.1.4 — 22 novembre 2026

- Recherche Résonances indépendante par titre, studio ou Steam AppID.
- Résolution d’un résultat vers son véritable AppID avant l’appel à Découverte.
- Annulation des requêtes de suggestions précédentes et rejet des réponses obsolètes.
- Ouverture au clic ou au clavier des fiches des jeux enrichis depuis la Bibliothèque.
- Affichage générique des champs de profil et des structures JSON imbriquées.
- Route de profil en lecture seule, sans migration ni modification du pipeline d’enrichissement.
- Publication GHCR simultanée sous `dev`, `latest` et `sha-*` pour rester compatible avec la stack Dockge existante.
- Ajout de tests de régression V1.1.4.

## 1.1.3

- Retour à l'identité visuelle bleue et aux comportements Backlog Core V1.0.
- Utilisation directe et non destructive du schéma SQLite V1.0.
- Restauration des couvertures avec repli vers la jaquette Steam.
- Restauration de la saisie et de la vérification du jeton administrateur.
- Fusion Bibliothèque/Enrichissement.
- Campagne globale côté serveur, persistante, suspendable et reprise après redémarrage.
- Suivi détaillé et relance des erreurs.
- Conservation des profils, sessions et corrections de Découverte.
- Nettoyage des anciens tests CommonJS; suite unique `tests/` sous Node 24.
- Workflow GitHub Actions/GHCR et Compose Dockge inclus.
