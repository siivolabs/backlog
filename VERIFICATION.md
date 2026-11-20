# Vérification de Backlog V0.9.7

## Contrôles exécutés

```bash
npm run check
npm test
```

Résultat : **70 tests réussis sur 70**. Les 69 tests de la V0.9.6 restent présents ; un scénario V0.9.7 couvre la boucle d’apprentissage et le renouvellement.

## Scénario V0.9.7 couvert

- un premier run produit cinq recommandations avec le pipeline rapide existant ;
- un retour « bonne piste, mauvaise raison » est enregistré avec familiarité `played` ;
- une association exacte jeu–motivation est rejetée ;
- un run `refine` relit le commentaire et l’association ;
- les cinq jeux du run parent sont exclus ;
- l’analyse peut conserver une seule recommandation au lieu d’en forcer cinq ;
- toutes les motivations sont présentes comme `satisfied` ou `unsatisfied` ;
- le compteur de réutilisation et le dernier run consommateur sont persistés ;
- les profils historiques restent inchangés.

## Migration

- les six tables `discovery_*_v096` existent toujours ;
- quatre tables `discovery_*_v097` sont créées ;
- l’appel répété de la migration est idempotent ;
- aucune donnée de la bibliothèque n’est supprimée.

## Démarrage réel

Un démarrage sur une base SQLite temporaire a confirmé :

- `/healthz` renvoie `version: 0.9.7` ;
- le tableau Discovery renvoie `schemaVersion: backlog-discovery/1.1` ;
- les compteurs de mémoire sont disponibles ;
- la page principale affiche `BACKLOG 0.9.7` ;
- les deux actions de renouvellement sont présentes dans l’interface.

## Performance

La V0.9.7 ne crée aucun appel Qwen supplémentaire. Elle conserve une requête d’embedding, une présélection locale et une analyse Qwen limitée par défaut aux 12 meilleurs candidats. La lecture de mémoire est bornée à 40 retours qualitatifs par défaut.
