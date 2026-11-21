# Rapport de validation — Backlog Core V1.1.2

Date : 21 novembre 2026

## Résultat

- 9 tests automatisés réussis sur 9.
- Vérification syntaxique Node réussie pour le serveur et l'interface.
- Démarrage HTTP réel réussi sur une base vide conforme V1.0.
- `/api/health` : SQLite `quick_check=ok`, aucune erreur de clé étrangère.
- Prévol, vérification de base et sauvegarde SQLite en ligne exécutés avec succès.
- `compose.yaml` et le workflow GitHub Actions analysés comme YAML valides.

## Parcours couverts

1. Conservation exacte des structures et données des tables V1.0 connues.
2. Ajout idempotent des deux seules tables de l'orchestrateur autonome.
3. Refus non destructif d'un schéma V1.1 incompatible (`name`/`developer`).
4. Import initial d'un inventaire historique sans connaissance IA.
5. File globale sans retraitement d'un profil existant.
6. Échec isolé, poursuite de campagne et relance explicite.
7. Suspension après le jeu courant.
8. Reprise après fermeture et réouverture réelles de SQLite.
9. Démarrage HTTP, bibliothèque, enrichissement, découverte et feedback de bout en bout.

## Limite de l'environnement de validation

Aucun moteur Docker n'était installé dans l'environnement de préparation. L'image n'a donc pas été construite localement. Le Dockerfile multi-étage exécute les mêmes tests pendant la construction, et le workflow fourni délègue la construction/publication à GitHub Actions et GHCR.
