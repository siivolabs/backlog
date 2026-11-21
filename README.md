# Backlog Core V1.0

Backlog Core remplace l'ancienne interface par trois espaces cohérents :

1. **Bibliothèque** — importe le véritable inventaire Steam depuis `/data/backlog.sqlite`.
2. **Enrichissement** — sélection libre de 50 jeux et pipeline unique produisant de nouveaux profils homogènes.
3. **Découverte** — rencontre entre les profils neufs, les motivations exprimées et la mémoire des corrections.

## Garantie de migration

- La base historique `/data/backlog.sqlite` est ouverte **en lecture seule**.
- Une nouvelle base `/data/backlog-core.sqlite` est créée.
- Seul l'inventaire fiable est copié : AppID, titre, studio, genres, couverture, temps de jeu et dernière utilisation lorsqu'ils sont disponibles.
- **Aucun** ancien profil IA, dossier documentaire, embedding, réseau, score de qualité ou historique de campagne n'est importé.
- Si aucune table d'inventaire compatible n'est détectée, l'application démarre vide et l'indique clairement. Elle ne fabrique jamais 4 321 entrées de démonstration.

## Déploiement recommandé — remplacement réversible

```bash
unzip backlog-core-v1.0.0.zip
cd backlog-core-v1.0.0
cp .env.example .env
nano .env                         # renseigner surtout DATA_PATH
./scripts/preflight.sh
./scripts/deploy.sh
```

Le script :

1. vérifie la présence de la vraie base historique ;
2. crée une sauvegarde SQLite cohérente ;
3. arrête et renomme l'ancien conteneur sans le supprimer ;
4. construit et lance Core sous le nom `backlog-test` ;
5. attend que le contrôle de santé réussisse ;
6. restaure automatiquement l'ancien conteneur si le démarrage échoue.

Ouvrez ensuite `http://ADRESSE_DU_NAS:3000` et vérifiez le nombre ainsi que quelques titres de la bibliothèque **avant tout enrichissement**.

## Retour arrière

```bash
./scripts/rollback.sh
```

Le conteneur précédent est renommé puis redémarré. La base historique n'a jamais été remplacée.

## Déploiement manuel avec Dockge

1. Décompressez l'archive dans le dossier de stacks.
2. Copiez `.env.example` vers `.env` et renseignez un chemin absolu `DATA_PATH` vers l'ancien volume `/data`.
3. Collez `docker-compose.yml` dans Dockge ou importez le dossier.
4. Lancez la stack.
5. Vérifiez `/api/status` et la page Bibliothèque.

**Important :** si un conteneur `backlog-test` existe déjà, arrêtez-le et renommez-le avant de lancer la stack, ou utilisez `scripts/deploy.sh` qui le fait de manière réversible.

## Modèles locaux

Valeurs par défaut :

- analyse : `qwen3:32b` ;
- embeddings : `embeddinggemma` ;
- Ollama : `http://host.docker.internal:11434`.

Adaptez `.env` aux modèles déjà installés. Le pipeline est séquentiel, suspendable et persistant. Les profils sont construits à partir des métadonnées d'inventaire et, si disponible, d'une collecte fraîche de l'API officielle Steam.

## GitHub Actions et GHCR (facultatif)

Le workflow `.github/workflows/publish.yml` construit et publie l'image lors d'un tag `v*`. Modifiez `VOTRE_COMPTE` dans `docker-compose.ghcr.yml`, puis utilisez ce fichier dans Dockge.

## Tests locaux

```bash
npm test
npm run check
```

Aucune dépendance npm externe n'est requise. Node.js 22.5 ou ultérieur suffit.
