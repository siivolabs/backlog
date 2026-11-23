# Journal des changements

## 1.2.2 — intégration V1.2 sur la base historique

### Intégré
- qualité documentaire avant recommandation ;
- proximité sémantique et fiabilité affichées séparément ;
- renouvellement par historique des présentations ;
- diversification des genres ;
- mode Surprends-moi ;
- statut Terminé persistant et réversible ;
- exclusion stricte des jeux terminés de toutes les recommandations.

### Corrigé sans régression
- restauration de `DATABASE_PATH=/data/backlog-core.sqlite` ;
- restauration du volume `${DATA_PATH:-./data}:/data` ;
- refus de créer une base absente ;
- refus des chemins SQLite contradictoires ;
- jaquettes Steam de repli ;
- descriptions issues des profils historiques ;
- fiches enrichies complètes ;
- protection des écritures par jeton administrateur.

### Migration minimale
- aucune modification de structure ou de contenu de `games` et `profiles` ;
- ajout transactionnel et idempotent de `game_user_state` et `recommendation_history` dans la même base ;
- sauvegarde de sécurité avant le premier ajout V1.2.
