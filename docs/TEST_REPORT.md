# Rapport de validation — Backlog Core V1.1.3

Date : 21 novembre 2026  
Runtime : Node.js 24.22.1

## Résultats

- `npm ci --ignore-scripts` : réussi.
- `npm test` : **11/11 tests réussis**.
- `npm run check` : réussi, 19 fichiers JavaScript vérifiés.
- YAML `compose.yaml` et `.github/workflows/docker-publish.yml` : analysé avec succès.
- Démarrage HTTP sur une base vierge : réussi.
- `GET /healthz` : `status=ok`, `database=ok`.
- Mutation sans jeton : refusée avec HTTP 401.
- Vérification du jeton correct : réussie.
- Simulation du contenu de l'étage runtime Docker puis démarrage : réussie.

## Non-régressions couvertes

1. Les définitions et données des tables métier V1.0 restent inchangées après migration additive.
2. La migration est réexécutable.
3. Un schéma V1.1 incompatible est refusé sans conversion.
4. Les profils existants sont ignorés par la file globale.
5. Une erreur de jeu est isolée.
6. La suspension attend la fin du jeu courant.
7. Une campagne active reprend après réouverture SQLite.
8. Les couvertures V1.0 sont conservées et une URL Steam sert de repli.
9. L'import ne supprime pas les profils.
10. Découverte réutilise les profils et corrections V1.0.
11. Les mutations sont protégées par `ADMIN_TOKEN`.
12. L'interface contient l'identité bleue, la saisie du jeton, l'import, les couvertures, Découverte et le suivi des erreurs.

## Limite d'environnement

Aucun moteur Docker/Podman n'était installé dans l'environnement de préparation. La commande `docker build` n'a donc pas pu être exécutée ici. Les deux commandes du stage de build (`npm test && npm run check`) ont été exécutées avec Node 24, le périmètre du stage runtime a été reconstruit et démarré, et le workflow GitHub Actions fourni effectue la construction Docker réelle avant publication GHCR. Cette limite est déclarée afin de ne pas présenter une construction non exécutée comme réussie.
