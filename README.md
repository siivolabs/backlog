# Backlog Core V1.1.3

Évolution conservatrice de **Backlog Core V1.0**. Elle préserve son identité bleue, son modèle SQLite, les couvertures, les profils, les corrections de Découverte et la protection par jeton administrateur. Les deux seules évolutions produit sont :

1. **Bibliothèque et enrichissement réunis** sur la page Bibliothèque.
2. **Enrichissement global autonome**, exécuté côté serveur, persistant, suspendable et repris après redémarrage Docker.

## Garanties de compatibilité

- `games.app_id` reste `TEXT`; `games.title`, `games.studio`, `games.cover_url` et toutes les colonnes V1.0 sont utilisées directement.
- `profiles`, `discovery_feedback` et `discovery_sessions` gardent leur structure V1.0.
- La migration ne crée que `core_background_campaign` et `core_background_queue`; aucune table métier existante n'est renommée, convertie ou supprimée.
- Une base au schéma V1.1 incompatible est refusée explicitement plutôt que transformée.
- Toutes les mutations administratives exigent `ADMIN_TOKEN`. Sans configuration du jeton, elles restent verrouillées.
- Les anciens fichiers `test/*.test.js` CommonJS ne sont pas inclus. La seule suite est `tests/`, en modules ES.

## Démarrage local

Prérequis : Node.js 24.

```bash
cp .env.example .env
set -a; . ./.env; set +a
npm test
npm run check
npm start
```

Ouvrir `http://localhost:3000`. Le navigateur demande le jeton d'administration et le garde uniquement dans `sessionStorage`.

## API principale

- `GET /healthz`
- `GET /api/library`
- `POST /api/library/import` — administrateur
- `GET /api/enrichment/status`
- `GET /api/enrichment/errors`
- `POST /api/enrichment/start|pause|resume|retry-failed` — administrateur
- `POST /api/discovery`
- `POST /api/discovery/feedback` — administrateur

Le jeton se transmet par `X-Admin-Token` ou `Authorization: Bearer …`.

## Déploiement

Voir [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md). **Cette archive ne déploie rien sur le NAS.**
