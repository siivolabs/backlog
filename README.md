# Backlog v0.7.0

Backlog est une bibliothèque Steam auto-hébergée avec persistance SQLite. La V0.7.0 conserve l’interface, la synchronisation de profils publics et l’enrichissement Steam Store + IGDB de la V0.6.1, puis ajoute le premier moteur de recommandation, une classification plus précise et une fiche détaillée éditable.

## Premier moteur de recommandation

Le moteur `explainable-v1` est **déterministe** : aucune sélection aléatoire n’est utilisée. À données et options identiques, l’ordre et les scores restent identiques.

Il établit un profil depuis les jeux déjà lancés, pondéré par le temps de jeu Steam, puis explique chaque suggestion avec les facteurs disponibles :

- jeu jamais lancé ou déjà joué ;
- temps de jeu des titres ayant construit le profil ;
- genres communs ;
- thèmes communs ;
- plateformes cohérentes avec l’historique ;
- type d’application ;
- source des métadonnées et niveau de complétude.

Par défaut, les recommandations concernent les jeux complets jamais lancés. Deux options permettent d’inclure les jeux déjà lancés et, explicitement, les autres types d’applications. Les scores, raisons et facteurs du dernier calcul sont conservés dans `recommendation_cache`.

## Classification des entrées Steam

Backlog distingue :

- jeu complet ;
- démo ;
- bêta ;
- prototype ;
- test public ;
- serveur dédié ;
- logiciel ou outil ;
- DLC ;
- composant multijoueur ;
- type inconnu.

La priorité va aux types explicites Steam Store, puis aux types IGDB et à des signaux de nom limités. Une entrée ordinaire de `GetOwnedGames`, sans signal contraire, est classée jeu complet avec une confiance faible jusqu’à son enrichissement.

Les applications techniques et non jouables restent dans la bibliothèque, sont accessibles par le filtre **Type d’application**, mais sont exclues des recommandations par défaut.

Le statut auparavant présenté comme « Indisponible » est affiché comme **« Métadonnées introuvables »** : la possession Steam est conservée, mais aucune fiche Steam Store ni correspondance IGDB exacte n’a été trouvée.

## Métadonnées Steam et IGDB

Steam Store reste la source primaire. IGDB ajoute ou fournit, selon les données disponibles :

- genres ;
- thèmes ;
- plateformes ;
- type IGDB ;
- jaquette de secours.

Le rapprochement automatique IGDB reste strictement fondé sur le Steam AppID dans `external_games`. Aucun rapprochement approximatif par nom n’est effectué.

La table `igdb_manual_matches` et l’état exposé dans la fiche préparent un futur choix manuel explicite. Cette version n’invente et n’applique aucune correspondance incertaine.

## Fiche détaillée et corrections manuelles

Chaque carte ou ligne ouvre une fiche contenant au minimum :

- titre et jaquette ;
- AppID Steam ;
- temps de jeu et statut joué/jamais lancé ;
- type d’application ;
- genres, thèmes et plateformes ;
- sources des métadonnées ;
- état de synchronisation ;
- raison et confiance de la classification ;
- état du futur rapprochement manuel IGDB.

La fiche permet de corriger le titre affiché, le type, les genres, thèmes et plateformes. L’écriture exige `ADMIN_TOKEN`.

Les corrections sont stockées séparément dans `game_manual_overrides` :

- elles ont priorité dans l’interface, les filtres et les recommandations ;
- Steam et IGDB peuvent continuer à actualiser leurs valeurs sources ;
- les valeurs sources ne sont jamais écrasées par une correction manuelle ;
- l’action **Rétablir les valeurs sources** supprime uniquement les corrections du jeu concerné.

L’API rejette les champs inconnus, les types non autorisés, les listes non textuelles, vides, dupliquées, trop longues ou dépassant 30 éléments.

## Icônes d’état accessibles

Les badges textuels superposés aux jaquettes sont remplacés par de petites icônes :

- coche verte : synchronisé ;
- indicateur discret : en attente ;
- rotation bleue : en cours ;
- point d’alerte orange : erreur temporaire ;
- vigilance orange : métadonnées introuvables ou anomalie.

Le libellé complet, la source et l’erreur éventuelle restent disponibles dans l’infobulle et dans un texte réservé aux lecteurs d’écran.

## Configuration

Les variables de la V0.6.1 sont conservées :

```yaml
environment:
  STEAM_API_KEY: ta_cle_web_api_steam
  ADMIN_TOKEN: un_secret_long_et_aleatoire
  TWITCH_CLIENT_ID: identifiant_client_twitch
  TWITCH_CLIENT_SECRET: secret_client_twitch
```

Réglages facultatifs :

```yaml
STEAM_METADATA_CONCURRENCY: 4
STEAM_REQUEST_INTERVAL_MS: 150
IGDB_BATCH_SIZE: 100
IGDB_CACHE_TTL_HOURS: 720
IGDB_MISS_CACHE_TTL_HOURS: 24
METADATA_LANGUAGE: french
METADATA_COUNTRY: FR
```

Le montage persistant reste :

```yaml
volumes:
  - ./data:/data
```

## Migration depuis V0.6.1

1. Suspendre l’enrichissement.
2. Sauvegarder `data/backlog.sqlite`.
3. Publier les fichiers V0.7.0.
4. Laisser GitHub Actions reconstruire l’image `dev`.
5. Dans Dockge, effectuer **Pull**, puis recréer le conteneur.

La migration ajoute les champs et tables nécessaires sans supprimer la bibliothèque, les métadonnées ou le cache existants. Lors du premier démarrage V0.7, les entrées déjà traitées repassent une seule fois à `pending` afin de récupérer les types, thèmes et plateformes nécessaires à la classification et aux recommandations. Les corrections manuelles restent séparées et prioritaires.

## API ajoutée

| Méthode | Route | Protection | Fonction |
|---|---|---|---|
| `GET` | `/api/recommendations` | publique | Suggestions déterministes et explications |
| `GET` | `/api/games/:appid` | publique | Fiche détaillée, sources et corrections actives |
| `PATCH` | `/api/games/:appid/manual` | `X-Admin-Token` | Créer ou modifier les corrections |
| `DELETE` | `/api/games/:appid/manual` | `X-Admin-Token` | Rétablir les valeurs sources |

Paramètres de recommandation :

```text
limit=1..24
includePlayed=0|1
includeNonGames=0|1
```

## Tests

```bash
npm test
node --check server.js
node --check public/app.js
```

Les tests simulent Steam, Twitch OAuth et IGDB. Aucun secret ni appel réseau réel n’est requis.
