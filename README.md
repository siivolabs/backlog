# Backlog v0.6

Backlog est une bibliothèque Steam auto-hébergée. La V0.6 se concentre sur les **imports depuis un profil public** et sur l’**enrichissement progressif** des métadonnées.

## Nouveautés

- plus d’import de `response.txt` ;
- synchronisation avec un SteamID64, un nom personnalisé ou une URL de profil Steam ;
- clé Web API utilisée uniquement côté serveur ;
- prise en charge de n’importe quel profil dont les **détails de jeux sont publics** ;
- lancement et suspension manuels de l’enrichissement ;
- progression globale et badge d’état par jeu ;
- reprise des jeux en attente après redémarrage ;
- sauvegarde automatique avant chaque réinitialisation ;
- migration de la base V0.5 sans perte des jeux ni genres déjà présents.

## Configuration requise dans Dockge

Dans l’éditeur de la stack, renseigner deux variables d’environnement :

```yaml
environment:
  STEAM_API_KEY: ta_cle_web_api_steam
  ADMIN_TOKEN: un_secret_long_et_aleatoire
```

La clé Steam se crée sur <https://steamcommunity.com/dev/apikey>. `ADMIN_TOKEN` protège les imports, l’enrichissement et les réinitialisations. Aucun des deux secrets n’est renvoyé par `/api/config` ni inscrit dans les journaux.

Le compose complet fourni conserve le montage :

```yaml
volumes:
  - ./data:/data
```

Si le conteneur ne peut pas écrire dans `./data`, créer le dossier depuis le répertoire de la stack et l’attribuer à l’UID 1000 :

```bash
mkdir -p data
sudo chown 1000:1000 data
```

## Déploiement

1. Examiner les fichiers de l’archive.
2. Remplacer les fichiers du dépôt GitHub par cette version en conservant la branche `main`.
3. Renseigner `STEAM_API_KEY` et `ADMIN_TOKEN` dans la stack Dockge.
4. Attendre la reconstruction de `ghcr.io/siivolabs/backlog:dev`.
5. Dans Dockge, effectuer **Pull**, puis recréer le conteneur.
6. Ouvrir `http://backlog.home/`.
7. Saisir le jeton d’administration, puis synchroniser le profil.

La première ouverture migre automatiquement la base V0.5. Faire malgré tout une copie de `data/backlog.sqlite` avant le déploiement est recommandé.

## Synchroniser un profil public

Sont acceptés :

```text
7656119xxxxxxxxxx
mon-nom-personnalise
https://steamcommunity.com/profiles/7656119xxxxxxxxxx
https://steamcommunity.com/id/mon-nom-personnalise
```

La synchronisation remplace la bibliothèque active par celle du profil demandé. Les métadonnées déjà obtenues sont conservées pour les AppID présents dans les deux bibliothèques. Steam ne renvoie la liste que si l’option **Détails des jeux** du profil est publique.

## Enrichissement

L’enrichissement ne démarre jamais tout seul. Le bouton **Lancer** traite les jeux en attente un par un. La temporisation par défaut est de 1 500 ms et peut être réglée avec :

```yaml
METADATA_DELAY_MS: 1500
```

Les états persistés sont :

- `pending` : en attente ;
- `syncing` : requête en cours ;
- `synced` : métadonnées récupérées ;
- `temporary_error` : réessai ultérieur possible ;
- `unavailable` : aucune fiche disponible.

Un état `syncing` interrompu par un redémarrage repasse automatiquement à `pending`.

## Réinitialisations et sauvegardes

L’interface propose :

- métadonnées uniquement ;
- bibliothèque uniquement ;
- toutes les données applicatives.

Une copie cohérente de la base est créée avant l’opération dans :

```text
data/backups/
```

La clé API et le jeton restent dans l’environnement du conteneur : une réinitialisation SQLite ne les efface pas.

## Pourquoi SteamDB semble ne pas avoir de limite ?

SteamDB n’effectue pas une requête Store par jeu à chaque visiteur. Le service maintient sa propre base, utilise SteamKit et le flux de changements de Steam, met les résultats en cache et ne rafraîchit que les applications modifiées. SteamDB indique aussi qu’il parse certaines pages Store et qu’il interdit le scraping automatisé de son propre site. Backlog ne doit donc pas utiliser SteamDB comme API.

Le Store Steam ne publie pas de quota contractuel précis pour l’endpoint `appdetails`. Backlog applique par prudence une file séquentielle, une temporisation, la gestion de `429 Retry-After` et des reprises. La Web API officielle, elle, est utilisée pour `GetOwnedGames` avec la clé configurée.

## API principale

| Méthode | Route | Protection | Fonction |
|---|---|---|---|
| `GET` | `/healthz` | publique | Santé et version |
| `GET` | `/api/config` | publique, sans secrets | État de configuration |
| `GET` | `/api/library` | publique | Bibliothèque persistée |
| `POST` | `/api/import/steam` | `X-Admin-Token` | Synchroniser un profil |
| `GET` | `/api/enrichment/status` | publique | Progression |
| `POST` | `/api/enrichment/start` | `X-Admin-Token` | Démarrer |
| `POST` | `/api/enrichment/pause` | `X-Admin-Token` | Suspendre |
| `POST` | `/api/enrichment/retry-errors` | `X-Admin-Token` | Replacer les erreurs en attente |
| `POST` | `/api/admin/reset` | `X-Admin-Token` + confirmation | Réinitialiser avec sauvegarde |

## Tests

```bash
npm test
```

Les tests n’appellent pas Steam : les réponses amont sont simulées.
