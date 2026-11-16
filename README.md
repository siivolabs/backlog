# Backlog v0.6.1

Backlog est une bibliothèque Steam auto-hébergée. La V0.6.1 conserve la synchronisation des profils publics, la reprise, les badges et l’interface V0.6, puis ajoute **IGDB comme source secondaire** et accélère l’enrichissement.

## Hiérarchie des sources

1. **Steam Store reste prioritaire.** Si la fiche `appdetails` existe, son nom et ses genres sont conservés, avec la source `Steam Store`.
2. Avant les requêtes Store, Backlog rapproche les jeux avec IGDB par **Steam AppID exact**, via `external_games` et la source externe Steam.
3. Les AppID sont envoyés à IGDB par lots (100 par défaut) et les réponses sont conservées dans SQLite.
4. Si Steam indique explicitement que la fiche est absente, Backlog utilise le résultat IGDB déjà mis en cache.
5. Si Steam et IGDB ne connaissent pas le jeu, le badge devient `Indisponible`. L’absence d’une fiche Steam n’est jamais transformée, à elle seule, en erreur temporaire.
6. Si Steam échoue temporairement mais qu’IGDB est disponible, les données IGDB peuvent être affichées avec un état d’erreur temporaire ; le prochain essai garde ainsi la possibilité de remplacer ces données par Steam.

Le badge d’un jeu synchronisé affiche clairement `Steam Store` ou `IGDB`. Les identifiants et secrets Twitch ne sont jamais envoyés au navigateur.

## Accélération

- Préchargement IGDB groupé au lieu d’une requête par jeu.
- Cache SQLite persistant des résultats et des absences IGDB.
- Quatre requêtes Steam Store simultanées par défaut, configurables de 1 à 8.
- Temporisation entre les vagues de requêtes et ralentissement automatique selon `Retry-After` en cas de HTTP 429.
- Les jeux déjà synchronisés et les entrées IGDB encore valides ne sont pas retéléchargés.
- Le bouton **Suspendre** attend uniquement les requêtes déjà en vol ; les jeux non commencés restent reprenables.

## Configuration Dockge

Crée une application dans le portail développeur Twitch, de type **Confidential**, puis génère un Client Secret. Ajoute ensuite :

```yaml
environment:
  STEAM_API_KEY: ta_cle_web_api_steam
  ADMIN_TOKEN: un_secret_long_et_aleatoire
  TWITCH_CLIENT_ID: identifiant_client_twitch
  TWITCH_CLIENT_SECRET: secret_client_twitch
```

Les quatre valeurs restent côté serveur. `/api/config` renvoie uniquement des booléens indiquant si Steam, IGDB et l’administration sont configurés.

### Réglages facultatifs

```yaml
STEAM_METADATA_CONCURRENCY: 4       # 1 à 8
STEAM_REQUEST_INTERVAL_MS: 150      # pause entre deux vagues
IGDB_BATCH_SIZE: 100                # 1 à 200 AppID par requête groupée
IGDB_CACHE_TTL_HOURS: 720           # 30 jours pour une correspondance
IGDB_MISS_CACHE_TTL_HOURS: 24       # 24 h pour une absence
METADATA_LANGUAGE: french
METADATA_COUNTRY: FR
```

`METADATA_DELAY_MS` reste accepté comme alias de compatibilité si `STEAM_REQUEST_INTERVAL_MS` n’est pas défini.

Le montage persistant ne change pas :

```yaml
volumes:
  - ./data:/data
```

Si nécessaire :

```bash
mkdir -p data
sudo chown 1000:1000 data
```

## Migration depuis V0.6

1. Suspendre l’enrichissement en cours.
2. Sauvegarder `data/backlog.sqlite`.
3. Publier les fichiers V0.6.1 et ajouter les variables Twitch.
4. Laisser GitHub Actions reconstruire `ghcr.io/siivolabs/backlog:dev`.
5. Dans Dockge, effectuer **Pull**, puis recréer le conteneur.
6. Relancer l’enrichissement.

La migration SQLite est automatique et non destructive :

- les jeux `syncing` repassent à `pending` ;
- les jeux déjà `synced` en V0.6 sont attribués à `Steam Store` ;
- les anciens jeux `unavailable` repassent à `pending` afin qu’IGDB puisse les examiner ;
- une table `metadata_cache` conserve les correspondances IGDB et leur expiration.

## États conservés

- `pending` : en attente ;
- `syncing` : requête en cours ;
- `synced` : métadonnées récupérées depuis Steam Store ou IGDB ;
- `temporary_error` : un service a échoué temporairement et pourra être retenté ;
- `unavailable` : aucune fiche Steam Store et aucune correspondance IGDB exacte.

Un état `syncing` interrompu par un redémarrage repasse automatiquement à `pending`.

## Réinitialisations

- **Métadonnées uniquement** : remet les jeux en attente et vide le cache fournisseur.
- **Bibliothèque uniquement** : supprime les jeux, mais conserve le cache IGDB pour un futur réimport.
- **Toutes les données** : supprime jeux, historique, réglages internes et cache.

Une copie cohérente de SQLite est toujours créée dans `data/backups/` avant l’opération.

## Tests

```bash
npm test
node --check server.js
node --check public/app.js
```

Les tests simulent Steam, Twitch OAuth et IGDB : aucun secret ni appel réseau réel n’est nécessaire.
