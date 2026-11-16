# Backlog v0.7.1

Backlog V0.7.1 est un correctif ciblé de migration. Il conserve sans changement l’interface, les recommandations, la classification, les fiches détaillées, les corrections manuelles et l’enrichissement Steam Store + IGDB de la V0.7.0.

## Régression corrigée

La V0.7.0 contenait ce comportement lors d’une migration depuis une version antérieure :

```sql
UPDATE games
SET metadata_status = 'pending', metadata_error = NULL, next_retry_at = NULL
WHERE metadata_status IN ('synced', 'unavailable');
```

Les métadonnées et le cache SQLite restaient présents, mais les jeux terminés redevenaient artificiellement éligibles à l’enrichissement. Ce bloc a été supprimé.

## Réparation automatique V0.7.1

Au premier démarrage, V0.7.1 exécute une réparation transactionnelle et idempotente :

1. Un jeu `pending` possédant une source terminée (`steam_store` ou `igdb`) et une date de métadonnées redevient `synced`.
2. Un jeu `pending` sans source directe, mais disposant d’une correspondance IGDB exacte et trouvée dans `metadata_cache`, redevient `synced`. Les données du cache ne remplissent que les champs absents : les données existantes ne sont pas écrasées.
3. Un jeu `pending` dont le traitement était terminé, sans source, et dont le cache IGDB contient une absence exacte (`found = 0`) devient `unavailable`, affiché dans l’interface comme **Métadonnées introuvables**.
4. Les `temporary_error` restent inchangés et conservent leur prochaine date de tentative.
5. Les anciens `syncing` deviennent toujours `pending` après une interruption. Ils ne sont pas confondus avec les statuts endommagés par la migration.

Une marque `migration_071_status_repair` est écrite dans `settings` dans la même transaction que la réparation. La réparation destructive ne peut donc pas être rejouée à chaque démarrage. Une transaction interrompue est entièrement annulée et sera reprise au démarrage suivant.

## Données préservées

Le correctif ne supprime et ne réinitialise pas :

- les noms, genres, thèmes, plateformes et types d’applications ;
- les sources et identifiants Steam/IGDB ;
- `metadata_cache` et ses entrées négatives ;
- les corrections de `game_manual_overrides` ;
- les associations de `igdb_manual_matches` ;
- les recommandations et autres tables applicatives ;
- les erreurs temporaires légitimes.

Aucune requête Steam ou IGDB n’est effectuée pendant la migration.

## Effet attendu sur la base observée

Pour une base contenant 4 321 jeux, 4 321 entrées de cache, 4 258 jeux avec genres et les statuts `3893 pending / 402 synced / 26 temporary_error`, V0.7.1 recalcule les statuts depuis les sources persistées et le drapeau `found` du cache.

Le nombre exact de jeux `synced` et `unavailable` dépend donc des correspondances réellement trouvées dans `metadata_cache`. Les jeux réparés ne restent plus `pending` et ne sont pas ré-enrichis inutilement. Les 26 erreurs temporaires restent inchangées.

## Déploiement depuis V0.7.0

1. Suspendre un éventuel enrichissement encore actif.
2. Sauvegarder `data/backlog.sqlite`.
3. Publier les fichiers V0.7.1 dans le dépôt GitHub.
4. Attendre la reconstruction de `ghcr.io/siivolabs/backlog:dev`.
5. Dans Dockge, effectuer **Pull**, puis recréer le conteneur.
6. Ouvrir Backlog et contrôler la répartition des statuts avant de relancer manuellement un enrichissement.

Aucune variable d’environnement ni modification du Compose n’est nécessaire.

## Contrôle SQLite facultatif

Après le premier démarrage V0.7.1 :

```sql
SELECT metadata_status, COUNT(*)
FROM games
GROUP BY metadata_status
ORDER BY metadata_status;

SELECT value
FROM settings
WHERE key = 'migration_071_status_repair';
```

La seconde requête renvoie le bilan JSON de la réparation : jeux restaurés depuis leur source, jeux restaurés depuis le cache et métadonnées introuvables.

## Tests

```bash
npm test
node --check server.js
node --check public/app.js
```

La suite couvre notamment :

- la migration d’une base V0.6.1 entièrement enrichie ;
- la réparation d’une base V0.7.0 dont les statuts ont été réinitialisés ;
- la distribution observée de 4 321 jeux ;
- l’idempotence sur plusieurs redémarrages ;
- la reprise des anciens `syncing` ;
- la préservation du cache, des métadonnées, des corrections manuelles et des associations IGDB ;
- l’absence de jeux terminés encore éligibles à un enrichissement inutile ;
- toutes les non-régressions V0.7.0.
