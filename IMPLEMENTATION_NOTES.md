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


## Moteur effectif ajouté

- `ai-engine.js` isole le pipeline IA du serveur et du moteur de recommandations historique.
- Le pipeline est local-first : données Steam/IGDB persistées, puis SearXNG uniquement lorsque les descriptions locales sont absentes ou que les signaux sont insuffisants.
- Le prompt Qwen exclut les URL et interdit explicitement toute navigation ; seuls les extraits textuels contrôlés sont fournis.
- Les profils sont normalisés et refusés s’ils contiennent trop peu de dimensions exploitables.
- Les vecteurs sont refusés si `embeddinggemma` ne renvoie pas exactement 768 valeurs numériques.
- Les vecteurs sont stockés en BLOB Float32, soit 3 072 octets par jeu.
- La similarité combine cosinus des embeddings (60 %) et dimensions structurées (40 %).
- Les opérations qui modifieraient la bibliothèque ou les sources sont verrouillées pendant l’analyse.
- Une reprise ignore les profils dont le modèle, la version de prompt, le modèle d’embedding et le hachage local sont encore valides.

## Limite de validation

L’environnement de construction ne peut pas atteindre l’adresse privée `192.168.1.77`. Les appels réels doivent être vérifiés après déploiement avec le bouton **Tester Ollama**. Les tests automatisés utilisent des doubles HTTP complets d’Ollama et de SearXNG et valident les contrats JSON, les 768 dimensions, la persistance et la reprise.
