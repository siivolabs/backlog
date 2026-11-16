# Journal des modifications

## 0.6.0 — Imports et enrichissement progressif

- Remplacement de l’import manuel `response.txt` par une synchronisation serveur via `GetOwnedGames`.
- Prise en charge d’un SteamID64, d’une URL `/profiles/`, d’une URL `/id/` ou d’un nom personnalisé.
- Clé Steam Web API conservée uniquement dans `STEAM_API_KEY`, jamais renvoyée au navigateur.
- Protection des mutations par `ADMIN_TOKEN`.
- Synchronisation atomique d’un profil public, avec conservation des métadonnées des jeux communs.
- Lancement et suspension manuels de l’enrichissement progressif.
- Temporisation entre les requêtes, gestion de HTTP 429, erreurs temporaires et reprises.
- Barre de progression et badge d’état par jeu.
- Sauvegarde SQLite avant réinitialisation des métadonnées, de la bibliothèque ou de toutes les données.
- Migration non destructive de la base V0.5.
- Conservation de l’interface visuelle et correction durable de l’état vide.
