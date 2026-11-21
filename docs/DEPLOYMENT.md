# Déploiement GitHub → GHCR → Dockge

## 1. Avant toute chose

1. Revenez à une copie de la base **Backlog Core V1.0**, pas à une base transformée par V1.1/V1.1.1.
2. Sauvegardez le fichier SQLite et conservez l'image Docker V1.0 disponible pour le retour arrière.
3. N'écrasez jamais la seule copie de la base.

Contrôle facultatif en local ou dans un conteneur Node 24 :

```bash
DATABASE_PATH=/chemin/backlog-core.sqlite npm run preflight
DATABASE_PATH=/chemin/backlog-core.sqlite BACKUP_PATH=/chemin/backups npm run backup
```

## 2. Remplacer proprement le dépôt GitHub

L'archive est un **instantané complet**. Pour éviter que d'anciens fichiers continuent d'interférer :

1. Clonez le dépôt dans un dossier de travail.
2. Supprimez son contenu suivi, en conservant seulement `.git/`.
3. Copiez **tout** le contenu de l'archive, fichiers cachés compris.
4. Vérifiez que `test/` au singulier n'existe pas et que `tests/` contient la suite ES actuelle.
5. Validez puis poussez sur `main`.

Exemple :

```bash
git rm -r .
# copier ici le contenu décompressé, y compris .github, .dockerignore et .env.example
git add -A
git commit -m "Restore Core V1.0 and add persistent background enrichment"
git push origin main
```

Le workflow utilise Node 24, exécute `npm test` et `npm run check`, construit l'image, puis publie `ghcr.io/siivolabs/backlog:latest` et un tag `sha-*`.

## 3. Dockge

1. Copiez `.env.example` vers `.env` dans la stack.
2. Renseignez un `ADMIN_TOKEN` long et unique.
3. Réglez `DATA_PATH` sur le **dossier qui contient `backlog-core.sqlite`**. Ne changez pas ce chemin entre V1.0 et cette version.
4. Vérifiez l'existence du réseau Docker externe `npm_default`.
5. Faites **Pull**, puis **Up**.
6. N'exposez Backlog qu'au réseau local ou derrière la politique d'accès de Nginx Proxy Manager.

## 4. Vérifications avant enrichissement

```bash
curl http://backlog.home/healthz
```

Dans l'interface :

- confirmer le fond bleu;
- saisir le jeton administrateur;
- contrôler le nombre de jeux et plusieurs couvertures;
- ouvrir Découverte et vérifier les profils existants;
- contrôler « Suivi des erreurs »;
- seulement ensuite, lancer l'enrichissement global.

La pause termine le jeu courant. Une campagne `running` est reprise automatiquement après redémarrage du conteneur; un item interrompu repasse de `processing` à `pending`.

## 5. Retour arrière

1. Suspendre la campagne et attendre l'état `paused`.
2. Arrêter la stack.
3. Restaurer la copie SQLite effectuée avant déploiement.
4. Revenir au tag d'image V1.0 conservé.
5. Redémarrer la stack avec le même volume.
