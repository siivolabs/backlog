# Vérification de Backlog V0.9.4.4

## Résultats automatisés

- `npm run check` : syntaxe validée pour le serveur, tous les modules et l’interface.
- `npm test` : **65 tests réussis sur 65**.
- Les 58 tests de V0.9.4.3 restent présents et réussissent.
- Streaming Qwen NDJSON : réassemblage des fragments et délai d’inactivité réarmé vérifiés.
- Erreurs HTTP : statut, corps, URL et cause technique conservés dans le détail vérifié.
- Validation stricte de la base de connaissances conservée.
- Réseau expérimental : exclusion d’une preuve secondaire invalide sans modification des caractéristiques du profil vérifiée.
- Profil fondamentalement insuffisant : blocage maintenu.
- Reprise du même lot et réutilisation des points de reprise SQLite vérifiées.
- Erreur réseau ponctuelle avec Ollama disponible : la campagne continue.
- Ollama réellement indisponible : suspension automatique sûre vérifiée.
- Journal en direct : source SQLite, panneau ouvert et noms des jeux vérifiés.
- Scénario historique de 50 jeux : 50 embeddings et 1 225 paires vérifié.
- Migrations additives et conservation des profils, candidats, embeddings et similarités vérifiées sur bases temporaires.

## Limites de l’environnement

Le client Docker n’est pas disponible dans l’environnement de construction. Le `Dockerfile` et `compose.yaml` sont contrôlés statiquement ; l’exécution et les tests utilisent Node.js 24. Aucun appel au serveur Ollama privé n’a été effectué : le protocole HTTP/NDJSON et les pannes sont testés avec des doubles déterministes.

## Intégrité de livraison

`MANIFEST.sha256` contient l’empreinte SHA-256 de chaque fichier livré, hors manifeste. L’archive ZIP et son empreinte externe sont vérifiées après création.
