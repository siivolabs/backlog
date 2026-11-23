# Validation de Backlog Core V1.2.1

Date : 2026-11-23

## Résultat

- Vérification syntaxique : réussie.
- Tests : 6/6 réussis.
- Fixture principale : 4 321 jeux et 4 321 profils.
- Empreinte complète des lignes `games` + `profiles` : identique avant/après migration.
- Migration répétée : idempotente.
- Rollback sur schéma incompatible : validé.
- Démarrage HTTP : validé ; `/healthz` renvoie `version=1.2.1` et `schemaVersion=1201`.

## Tests exécutés

```text

> backlog-core@1.2.1 test
> node --test --test-reporter=spec test/*.test.js

✔ migre la structure Core réelle de 4 321 jeux sans modifier les jeux ni les profils (537.43462ms)
✔ adapte aussi une table historique games.appid de façon additive (9.5261ms)
✔ annule intégralement une migration incompatible (0.836017ms)
✔ exclut les profils spéculatifs et les jeux terminés (18.263255ms)
✔ le mode Surprends-moi fonctionne sans embedding cible (8.557239ms)
✔ démarre, expose healthz et permet de marquer un jeu terminé (108.403731ms)
ℹ tests 6
ℹ suites 0
ℹ pass 6
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 1261.71992
```

## Limite

La base privée de production de 53 Mo n'était pas disponible dans l'environnement de construction. La migration a été validée sur une copie synthétique reproduisant les colonnes observées de la base Core et les mêmes volumes (4 321 + 4 321). Exécuter `scripts/verify-database.mjs` sur une copie locale avant le remplacement définitif reste recommandé.
