# Backlog V0.8.0 POC — sélection des jeux à analyser

## Comportement livré

- Recherche parmi toute la bibliothèque chargée.
- Sélection manuelle au moyen de cases à cocher.
- Compteur visible `n / 50`.
- Liste récapitulative avec retrait individuel.
- Proposition déterministe et diversifiée de 50 jeux maximum.
- Proposition modifiable et non persistée tant que l’utilisateur ne la valide pas.
- Validation explicite protégée par le jeton d’administration.
- Aucun lancement automatique d’analyse après validation.
- État serveur `analysisAllowed` faux jusqu’à la validation.

## Diversification de la proposition

L’algorithme glouton privilégie la couverture de nouveaux genres, thèmes et plateformes, puis diversifie les états de métadonnées et quatre classes de temps de jeu. Il favorise les jeux complets et les métadonnées synchronisées sans imposer la proposition.

## Limite du POC

`AI_PILOT_POC_LIMIT = 50` est un garde-fou temporaire de la preuve de concept. La limite est explicitement signalée comme temporaire dans l’API et l’interface. Elle ne définit pas la capacité de l’architecture future.

## API ajoutée

- `GET /api/ai-pilot/selection`
- `GET /api/ai-pilot/sample?limit=50`
- `POST /api/ai-pilot/selection/confirm`

La route de proposition ne persiste rien. La route de validation exige `x-admin-token` et vérifie que tous les AppID existent dans la bibliothèque.

## Validation

- Syntaxe Node.js vérifiée pour le serveur et le client.
- 21 tests automatisés réussis.
- Tests dédiés : proposition non persistée, validation explicite, protection administrative, rejet des AppID absents et garde-fou temporaire de 50 jeux.
