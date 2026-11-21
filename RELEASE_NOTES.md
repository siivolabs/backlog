# Notes de livraison — Backlog Core V1.1.1

## Incident corrigé

Le démarrage de V1.1 échouait sur `CREATE INDEX ... games(name)` lorsqu’une base V1.0 possédait encore `title` et `studio`, avec un App ID de type texte. V1.1.1 transforme le schéma avant de créer les index.

## Garanties vérifiées

- conversion de `games` avec toutes les valeurs d’inventaire conservées ;
- profils et embeddings existants conservés ;
- motivations, verdicts et notes conservés ;
- tables héritées inchangées ;
- sauvegarde pré-migration lisible ;
- intégrité SQLite et clés étrangères valides ;
- seconde exécution sans duplication ni nouvelle sauvegarde ;
- App ID invalide : annulation complète et source intacte ;
- campagne en arrière-plan, isolement d’une erreur et reprise testés ;
- API de santé, bibliothèque et compatibilité testée.

## Résultat automatisé

```text
5 tests réussis sur 5
0 échec
```

Les appels Steam et Ollama sont simulés dans les tests. La latence réelle dépendra du NAS, du réseau et des modèles Ollama installés.

## Périmètre

Aucune connexion et aucune modification du NAS n’ont été réalisées pendant la préparation de cette archive. Le livrable est destiné à être déployé manuellement via GitHub Actions, GHCR et Dockge.
