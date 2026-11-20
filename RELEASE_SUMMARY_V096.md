# Backlog V0.9.6 — résumé technique

Cette version ajoute **Backlog Discovery** à V0.9.5.0, sans modifier le fonctionnement existant.

## Livré

- parcours en trois étapes : jeu apprécié → motivations confirmées → cinq découvertes ;
- mémoire des motivations corrigées par le joueur ;
- combinaison contextuelle d’intentions provenant de plusieurs jeux ;
- présélection par métadonnées et embeddings ;
- analyse Qwen réservée aux candidats prometteurs ;
- explications argumentées, différences, preuves disponibles et incertitudes ;
- retours qualitatifs sur la recommandation et sa justification ;
- tableau de mesure des exécutions et durées ;
- stockage dans six tables SQLite additives.

## Compatibilité

Les vues, API, profils, dossiers, réseaux, campagnes, embeddings et retours de V0.9.5.0 sont conservés. La V0.9.6 lit les profils et embeddings existants pour former des candidats, mais n’écrit que dans `discovery_*_v096`.

## Validation

Voir `VERIFICATION.md` pour les contrôles exécutés et `DISCOVERY_SPEC.md` pour l’hypothèse produit, les invariants et les critères de décision.
