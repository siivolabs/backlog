# Déploiement GitHub → GHCR → Dockge — V1.1.4

## 1. Sauvegarder sans modifier le NAS

Avant tout redéploiement :

1. sauvegardez le fichier SQLite actuellement utilisé par Backlog Core V1.1.3 ;
2. conservez l’identifiant ou le tag de l’image précédente pour le retour arrière ;
3. ne supprimez et ne déplacez pas le volume de données.

Contrôles facultatifs sur une copie de la base, avec Node 24 :

```bash
DATABASE_PATH=/chemin/copie/backlog-core.sqlite npm run preflight
DATABASE_PATH=/chemin/copie/backlog-core.sqlite BACKUP_PATH=/chemin/backups npm run backup
```

V1.1.4 n’ajoute aucune migration. Le même fichier `backlog-core.sqlite` doit être remonté dans `/data`.

## 2. Remplacer proprement le dépôt GitHub

L’archive est un **instantané complet**. Pour éviter que les anciens fichiers v0.4 (`server.js`, `test/`, etc.) continuent d’interférer :

1. dans GitHub Desktop, ouvrez **Repository → Show in Explorer** ;
2. supprimez tout le contenu du dossier, sauf `.git/` ;
3. copiez tout le contenu de l’archive V1.1.4, fichiers cachés compris ;
4. vérifiez que `test/` au singulier n’existe pas et que `tests/` contient la suite ES actuelle ;
5. validez puis poussez sur `main`.

Exemple en ligne de commande :

```bash
git rm -r .
# copier ici le contenu décompressé, y compris .github, .dockerignore et .env.example
git add -A
git commit -m "Release Backlog Core V1.1.4"
git push origin main
```

Le workflow utilise Node 24, exécute `npm test` et `npm run check`, construit l’image, puis publie `ghcr.io/siivolabs/backlog:dev`, `:latest` et un tag immuable `sha-*`.

## 3. Dockge

1. Conservez le volume et le `DATA_PATH` actuels.
2. Vérifiez que `ADMIN_TOKEN` reste défini avec la même valeur souhaitée.
3. Vérifiez l’existence du réseau externe `npm_default`.
4. Le Compose fourni utilise `ghcr.io/siivolabs/backlog:dev`, aligné sur le conteneur existant.
5. Une fois l’action GitHub réussie, faites **Pull**, puis recréez la stack.
6. N’exposez Backlog qu’au réseau local ou derrière la politique d’accès de Nginx Proxy Manager.

## 4. Vérifications fonctionnelles après redéploiement

```bash
curl http://backlog.home/healthz
```

La réponse doit annoncer `version: "1.1.4"` et `database: "ok"`.

Dans l’interface :

- confirmer le fond bleu, les couvertures et le nombre de jeux ;
- vérifier que le jeton administrateur fonctionne ;
- dans Résonances, rechercher un jeu par titre, studio puis AppID ;
- sélectionner une suggestion et vérifier que Découverte utilise son véritable AppID ;
- saisir rapidement plusieurs recherches et confirmer qu’une ancienne réponse ne remplace pas la plus récente ;
- ouvrir une carte enrichie dans la Bibliothèque et vérifier les champs du profil ;
- confirmer que la consultation d’une fiche ne change ni les compteurs ni l’état de l’enrichissement.

## 5. Retour arrière

1. Suspendre la campagne et attendre l’état `paused` si elle est active.
2. Arrêter la stack.
3. Revenir à l’image précédente conservée.
4. Réutiliser le même volume SQLite ; ne restaurer la sauvegarde que si le fichier a été endommagé indépendamment de V1.1.4.
5. Redémarrer la stack.
