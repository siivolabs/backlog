# Journal des changements

## 1.1.2

- Retour strict au contrat SQLite V1.0 (`games.app_id TEXT`, `title`, `studio`).
- Conservation directe des tables et données `profiles`, `discovery_feedback` et `discovery_sessions`.
- Ajout exclusivement additif de deux tables isolées pour l'état de l'enrichissement autonome.
- File globale côté serveur, pause, reprise Docker, erreurs isolées et nouvelle tentative explicite.
- Fusion Bibliothèque/Enrichissement et maintien d'un seul moteur de découverte.
- Aucun catalogue externe et aucune sélection manuelle.
