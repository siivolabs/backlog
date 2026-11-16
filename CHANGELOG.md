# Journal des versions

## 0.6.1 — IGDB secondaire et enrichissement accéléré

- Authentification Twitch Client Credentials exclusivement côté serveur.
- Rapprochement IGDB prioritaire par Steam AppID via `external_games`.
- Requêtes IGDB groupées et cache SQLite persistant, y compris pour les absences.
- Steam Store reste la source primaire dès que sa fiche existe.
- Bascule IGDB pour une fiche Store absente, sans erreur temporaire artificielle.
- Attribution explicite de la source dans l’API et les badges existants.
- Enrichissement Steam concurrent, pause/reprise préservées et ralentissement sur HTTP 429.
- Migration automatique des anciennes entrées `unavailable` pour les retester avec IGDB.
- Ajout de `TWITCH_CLIENT_ID`, `TWITCH_CLIENT_SECRET` et des réglages de performance.

## 0.6.0 — Imports et enrichissement progressif

- Synchronisation d’un profil Steam public sans `response.txt`.
- Enrichissement progressif, statuts persistants et reprise.
- Réinitialisations avec sauvegarde SQLite.
