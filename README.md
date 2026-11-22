# Backlog Core V1.1.4

Version complète fondée sur **Backlog Core V1.1.3**. Elle conserve l’interface bleue, les couvertures, le jeton administrateur, le modèle SQLite, les profils et embeddings existants, la Découverte et le pipeline autonome d’enrichissement.

## Corrections V1.1.4

1. **Jeu de référence dans Résonances**
   - recherche indépendante par titre, studio ou Steam AppID ;
   - résolution explicite vers le véritable AppID avant l’appel à Découverte ;
   - annulation des recherches précédentes et rejet des réponses asynchrones obsolètes.
2. **Fiches enrichies depuis la Bibliothèque**
   - les cartes enrichies sont consultables au clic ou au clavier ;
   - tous les champs du profil sont affichés, y compris les objets et tableaux JSON ;
   - la consultation est strictement en lecture seule.

## Garanties de compatibilité

- Aucune migration n’est ajoutée par V1.1.4.
- `games.app_id` reste `TEXT`; les tables `games`, `profiles`, `discovery_feedback` et `discovery_sessions` ne changent pas.
- `core_background_campaign` et `core_background_queue` restent celles de V1.1.3.
- Le pipeline d’enrichissement, les profils, embeddings, sessions et corrections existants restent inchangés.
- Toutes les mutations administratives exigent `ADMIN_TOKEN`.
- L’archive ne contient ni ancien dossier `test/`, ni données SQLite, ni sauvegarde du kit correctif, ni `node_modules`.

## Démarrage local

Prérequis : Node.js 24.

```bash
cp .env.example .env
set -a; . ./.env; set +a
npm ci --ignore-scripts
npm test
npm run check
npm start
```

Ouvrir `http://localhost:3000`. Le navigateur garde le jeton uniquement dans `sessionStorage`.

## API principale

- `GET /healthz`
- `GET /api/library` — paramètres `search`, `status`, `page`, `pageSize`
- `GET /api/library/profile?appId=...` — profil enrichi en lecture seule
- `POST /api/library/import` — administrateur
- `GET /api/enrichment/status`
- `GET /api/enrichment/errors`
- `POST /api/enrichment/start|pause|resume|retry-failed` — administrateur
- `POST /api/discovery`
- `POST /api/discovery/feedback` — administrateur

Le jeton se transmet par `X-Admin-Token` ou `Authorization: Bearer ...`.

## Publication et déploiement

Voir [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md). Le workflow publie les tags GHCR `dev`, `latest` et `sha-*`; le Compose Dockge fourni reste aligné sur le tag `dev` déjà utilisé par la stack.

**Cette archive ne déploie rien sur le NAS.**
