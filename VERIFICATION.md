# Vérification du livrable 0.9.2

## Contrôles automatisés exécutés

- syntaxe de `server.js`, `lib/database.js`, `lib/ai-engine.js` et `public/app.js` ;
- schéma JSON 2.0 et objets multidimensionnels ;
- rejet des statuts documentaires utilisés comme contenu ;
- représentation d’une dimension inconnue par `null` ou `[]` ;
- validation des identifiants `SOURCE-N` et de leur borne ;
- score de complétude fondé sur la qualité sémantique, séparé du score documentaire ;
- construction du texte d’embedding à partir des objets imbriqués ;
- refus de validation d’un profil sémantiquement insuffisant ;
- refus d’embedding lorsque le dossier ou le profil est insuffisant ;
- migration additive 0.9.2 et conservation byte-for-byte du `profile_json` historique dans la fixture ;
- conservation de la version active pendant une réanalyse individuelle ;
- fonctionnement des opérations séparées dossier/analyse/embedding ;
- protections documentaires, diagnostic Ollama et SSRF hérités des versions précédentes ;
- pilotes de contrat pour Euro Truck Simulator 2, Control et Satisfactory.

## Résultat

```text
npm run check : succès
tests 25
pass 25
fail 0
```

## Test de démarrage HTTP

Le serveur a été démarré avec un SQLite neuf et isolé. Résultats :

```json
{"status":"ok","version":"0.9.2","database":"backlog.sqlite"}
```

L’endpoint de configuration a également renvoyé `version: "0.9.2"`, `qwen3:32b`, `embeddinggemma` et 768 dimensions.

## Limites de la vérification locale

- Docker n’est pas installé dans l’environnement de fabrication de l’archive ; le `Dockerfile` a été contrôlé statiquement, mais l’image n’a pas été construite ici.
- Les services réels du NAS — Ollama, SearXNG, Steam, IGDB et les pages externes — ne sont pas accessibles depuis cet environnement. Les connecteurs sont couverts par simulations et tests unitaires.
- Les trois jeux pilotes sont validés par des fixtures de contrat représentatives. La génération réelle Qwen3 doit être vérifiée sur une copie du volume du NAS, dans l’ordre Euro Truck Simulator 2, Control, Satisfactory.
- Aucune analyse des 4 321 jeux n’est lancée automatiquement.
