# Vérification de Backlog V0.9.4.3

## Résultats automatisés

- `npm run check` : réussi sur le serveur, les modules et l’interface.
- `npm test` : **58 tests réussis sur 58**.
- Migration additive et idempotente vérifiée sur bases temporaires.
- Recherche numérique par Steam AppID exact vérifiée.
- Points de reprise, résultats intermédiaires, durées et journal SQLite vérifiés.
- Priorité, retrait sans suppression et relance ciblée de la file vérifiés.
- Suspension puis reprise du même lot vérifiées.
- Reconstruction complète vérifiée : les versions actives restent présentes et les nouvelles analyses sont candidates.
- Classification d’une interruption Ollama en panne d’infrastructure avec suspension automatique vérifiée.
- Scénario de 50 jeux vérifié : 50 embeddings, 1 225 paires et aucune validation manuelle jeu par jeu.
- Protection `ADMIN_TOKEN` vérifiée.
- Démarrage réel du serveur, `/healthz`, configuration, tableau réseau, recherche AppID et création de campagne testés sur une base SQLite temporaire.

## Compatibilité

Les 52 tests de V0.9.4.2 restent présents et réussissent. Les 6 tests V0.9.4.3 couvrent les nouvelles fonctions. Les migrations ne suppriment aucune table ni ligne historique.

## Limite de l’environnement de validation

Le client Docker n’est pas installé dans l’environnement de construction. Le `Dockerfile` et le script shell ont été contrôlés statiquement ; le serveur Node 24 a été démarré directement avec une base temporaire.

## Intégrité de livraison

`MANIFEST.sha256` contient l’empreinte de chaque fichier de l’archive, hors manifeste lui-même. L’archive ZIP et son empreinte externe sont vérifiées après création.
