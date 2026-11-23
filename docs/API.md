# API Backlog Core V1.2.2

- `GET /healthz` — version, compteurs, origine de la base et capacités.
- `GET /api/library?q=&completed=&limit=&offset=` — bibliothèque historique.
- `GET /api/games/:appId` — jeu, profil, sources, modèles et embedding.
- `PATCH /api/games/:appId/completed` — corps `{ "completed": true|false }`, jeton requis.
- `POST /api/discovery` — découverte par référence, embedding, texte ou mode surprise.
- `POST /api/discovery/feedback` — retour positif/négatif, jeton requis.
- `POST /api/import/steam` — import compatible avec le schéma historique, jeton requis.
- `GET /api/enrichment/status` — état disponible sans écriture.
- `POST /api/enrichment/run` — jeton requis et refusé tant que `ENRICHMENT_ENABLED=false`.

Le jeton est transmis par `X-Admin-Token` ou `Authorization: Bearer …`.
