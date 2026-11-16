# Journal des versions

## 0.7.0 — Recommandations explicables et fiches détaillées

- Premier moteur de recommandation déterministe `explainable-v1`.
- Scores et raisons fondés sur le statut joué, le temps Steam, les genres, thèmes, plateformes, sources et types.
- Exclusion par défaut des applications techniques et non jouables.
- Classification persistante : jeu, démo, bêta, prototype, test public, serveur, outil, DLC et composant multijoueur.
- Filtre de bibliothèque par type d’application.
- Libellé « Métadonnées introuvables » pour les possessions sans fiche correspondante.
- Fiche détaillée accessible depuis la grille et la liste.
- Corrections manuelles protégées par `ADMIN_TOKEN`, persistées séparément des valeurs sources.
- Restauration individuelle des valeurs Steam/IGDB.
- Préparation SQLite du futur rapprochement manuel IGDB, sans correspondance approximative.
- Badges de synchronisation remplacés par des icônes discrètes, avec infobulle et libellé lecteur d’écran.

## 0.6.1 — IGDB secondaire et enrichissement accéléré

- Authentification Twitch Client Credentials côté serveur.
- Rapprochement IGDB par Steam AppID exact, requêtes groupées et cache SQLite.
- Steam Store conservé comme source primaire.
- Enrichissement Steam concurrent et reprise persistante.
