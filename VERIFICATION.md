# Vérification du livrable 0.9.3.1

## Provenance

Le correctif a été construit à partir de l’archive publiée `backlog-v0.9.3.zip`, dont le SHA-256 a été vérifié avant extraction :

```text
a6a6a3e0349e5e85ddea9de1238cb0cef2c194e0efbad47327677db1b1002999
```

L’archive source a passé `unzip -t` sans erreur.

## Contrôles automatisés exécutés

- syntaxe de `server.js`, `lib/database.js`, `lib/ai-engine.js` et `public/app.js` ;
- normalisation de l’alias connu `atmosphere_theme.*` vers `atmosphere_themes.*` ;
- absence de mutation de la réponse brute pendant la normalisation ;
- validation stricte de l’existence réelle d’un chemin dans la dimension et le profil généré ;
- tentative Qwen unique et à température zéro pour un chemin non couvert par un alias ;
- application limitée à une cible présente dans `allowed_paths` pour la même dimension ;
- rejet d’une cible hors dimension ou hors schéma ;
- conservation des contrôles de type, contenu, sources, preuves, qualité et vérification factuelle 0.9.3 ;
- rendu du code, de l’étape et du détail de l’erreur dans la fiche du jeu et la vue **Erreurs** ;
- migrations SQLite historiques, conservation des profils actifs, candidates, sources, corrections, embeddings et données joueur.

## Résultat

```text
npm run check : succès
tests 35
pass 35
fail 0
```

## Test de démarrage HTTP

Le serveur a été démarré avec un SQLite neuf et isolé. Les assertions ont réussi :

```json
{"status":"ok","version":"0.9.3.1","database":"backlog.sqlite"}
```

L’endpoint de configuration a également renvoyé `version: "0.9.3.1"`, `qwen3:32b`, `embeddinggemma` et le nom du fichier SQLite attendu.

## Compatibilité SQLite

Le correctif ne modifie pas `lib/database.js`. La valeur `schema_version=0.9.3` reste volontairement le marqueur du schéma SQLite partagé par 0.9.3 et 0.9.3.1. Les tests ouvrent et migrent des bases historiques, vérifient les comptes et le contenu existants, et confirment qu’une réanalyse conserve la version active jusqu’à validation humaine.

## Limites de la vérification locale

- Docker n’est pas installé dans l’environnement de fabrication ; le `Dockerfile` est contrôlé statiquement mais l’image n’est pas construite ici.
- Ollama, SearXNG, Steam, IGDB et les pages externes du NAS ne sont pas utilisés pendant les tests hors ligne.
- La réparation Qwen est testée avec des réponses déterministes simulées ; un essai réel avec `qwen3:32b` doit être effectué sur le NAS.
- Aucune analyse en masse n’est déclenchée automatiquement.
