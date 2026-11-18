# Vérification du livrable 0.9.3

## Contrôles automatisés exécutés

- syntaxe de `server.js`, `lib/database.js`, `lib/ai-engine.js` et `public/app.js` ;
- schéma JSON 2.1 et nouvelles définitions de topologie, génération de carte et persistance ;
- preuves par chemin, union exacte des `source_ids` et rejet des sources inexistantes ;
- pénalisation des preuves trop larges ou répétées ;
- seconde passe factuelle avec rapport strict `passed`, `warnings` ou `failed` ;
- refus de validation et d’embedding si la vérification n’est pas réussie ;
- réutilisation des notes de profil et des corrections de champs ;
- migration additive 0.9.3 sans réécriture des profils historiques ;
- conservation de la version active pendant une réanalyse ;
- pilotes de contrat pour Euro Truck Simulator 2, Control et Satisfactory.

## Résultat

```text
npm run check : succès
tests 28
pass 28
fail 0
```

## Test de démarrage HTTP

Le serveur a été démarré avec un SQLite neuf et isolé. Les assertions ont réussi :

```json
{"status":"ok","version":"0.9.3","database":"backlog.sqlite"}
```

L’endpoint de configuration a également renvoyé `version: "0.9.3"`, `qwen3:32b`, `embeddinggemma` et 768 dimensions.

## Limites de la vérification locale

- Docker n’est pas installé dans l’environnement de fabrication ; le `Dockerfile` est contrôlé statiquement mais l’image n’est pas construite ici.
- Ollama, SearXNG, Steam, IGDB et les pages externes du NAS ne sont pas utilisés pendant les tests hors ligne.
- La vérification factuelle réelle dépend de Qwen3 et doit être contrôlée sur une copie du volume du NAS.
- Aucune analyse des 50 ou 4 321 jeux n’est lancée automatiquement.
