# Journal des changements

## 1.2.1 — 2026-11-23

### Corrigé
- Migration additive adaptée à la structure Core réelle avec inspection préalable des colonnes.
- Création des index reportée après la normalisation des tables existantes.
- Prise en charge additive de `games.app_id`, de l'ancien `games.appid`, de `enrichment_queue.game_id`, de `recommendation_history.app_id` et des anciennes dates `updated_at`.
- Transaction avec rollback intégral et message d'échec explicite.
- Sauvegarde SQLite cohérente automatique avant la première migration.
- Chemin Docker unifié sur `/data/backlog-core.sqlite`.
- Publication GHCR alignée entre `dev`, `latest` et la version.

### Validé
- Migration d'une fixture de 4 321 jeux et 4 321 profils sans modification de l'empreinte métier.
- Idempotence, compatibilité `games.appid`, rollback, filtrage documentaire, exclusion des jeux terminés, Surprends-moi et HTTP.

## 1.2.0
- Fiabilité documentaire, diversification, historique, Surprends-moi et statut Terminé.
