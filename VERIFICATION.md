# Vérification de Backlog V0.9.6

## Résultats automatisés

- `npm run check` : syntaxe validée pour le serveur, tous les modules et les deux scripts d’interface.
- `npm test` : **69 tests réussis sur 69**.
- Les **67 tests de V0.9.5.0** restent présents et réussissent.
- Deux tests V0.9.6 valident le parcours Discovery et l’idempotence de sa migration.
- Le parseur HTML accepte l’interface mise à jour.

## Contrôles Discovery

- interprétation initiale stockée comme brouillon ;
- correction humaine conservée lors de la confirmation ;
- combinaison de plusieurs intentions confirmées ;
- embedding unique de la requête expérientielle ;
- présélection hybride avec scores d’embedding et de métadonnées ;
- seulement six candidats approfondis dans le scénario de test, pour sept candidats conservés ;
- cinq recommandations distinctes, chacune avec argument, différence, élément connu et incertitude ;
- retour qualitatif avec cible de correction ;
- aucun ajout, remplacement ou changement d’état dans `ai_profile_versions` ;
- création idempotente des six tables `discovery_*_v096`.

## Test d’intégration local

Le serveur a été démarré avec une base SQLite temporaire et une bibliothèque minimale. Les contrôles suivants ont réussi :

- `/healthz` annonce `0.9.6` ;
- `/api/v09/config` annonce `experientialDiscovery: true` tout en conservant `similarityNetwork` et `fastSemanticPipeline` ;
- `/api/v09/discovery/dashboard` répond avec le schéma `backlog-discovery/1.0` ;
- `/api/v09/discovery/games` retrouve le jeu de la bibliothèque ;
- la page principale livre l’onglet **Backlog Discovery** et le script `/discovery.js`.

## Limites de l’environnement de construction

Le serveur Ollama privé n’a pas été appelé depuis cet environnement. Les nouveaux tests utilisent des doubles déterministes pour Qwen et EmbeddingGemma ; les 67 tests historiques conservent leurs propres doubles. La pertinence réelle des cinq découvertes, les durées Qwen et la qualité des explications doivent donc être évaluées après déploiement avec le lot Control, Persona, Ori, Man of Medan, Until Dawn et DmC.

Le client Docker n’est pas disponible dans l’environnement de construction. Le `Dockerfile` et `compose.yaml` sont contrôlés statiquement ; l’exécution et les tests utilisent Node.js 24.

## Intégrité de livraison

`MANIFEST.sha256` contient l’empreinte SHA-256 de chaque fichier livré, hors manifeste. L’archive ZIP et son empreinte externe sont vérifiées après création.
