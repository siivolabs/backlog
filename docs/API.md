# API du correctif historique

- `GET /healthz` : compteurs, version et capacités détectées ;
- `GET /api/library` : bibliothèque issue de `games` et `profiles` ;
- `GET /api/games/:appId` : fiche, profil, sources, modèles et embedding ;
- `POST /api/discovery` : découverte à partir des embeddings existants ;
- `POST /api/discovery/feedback` : retour utilisateur si la table historique compatible existe ;
- `PATCH /api/games/:appId/completed` : disponible seulement si `game_user_state` existe déjà ; aucune table n'est créée ;
- `POST /api/enrichment/run` : refusé tant que `ENRICHMENT_ENABLED=false`.
