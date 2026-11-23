# API

- `GET /healthz` — état, version, version de schéma et compteurs.
- `GET /api/library?q=&completed=&limit=&offset=` — bibliothèque.
- `GET /api/games/:appId` — jeu, profil, sources, modèles et embedding.
- `PATCH /api/games/:appId/completed` — `{ "completed": true|false }`.
- `POST /api/discovery` — requête, AppID de référence, embedding fourni ou `surprise`.
- `POST /api/discovery/feedback` — retour positif/négatif.
- `POST /api/import/steam` — import non destructif, jeton administrateur requis.
- `GET /api/enrichment/status` — état de la file.
- `POST /api/enrichment/run` — lot Ollama, jeton administrateur requis.

Le jeton est accepté via `X-Admin-Token` ou `Authorization: Bearer …`.
