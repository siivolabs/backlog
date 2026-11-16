# Journal des versions

## 0.7.1 — Correctif de migration des statuts

- Suppression de la réinitialisation destructive `synced`/`unavailable` vers `pending`.
- Réparation transactionnelle et idempotente depuis les sources persistées et `metadata_cache`.
- Restauration distincte des statuts `synced` et `unavailable`.
- Conservation des erreurs temporaires et remise des anciens `syncing` à `pending`.
- Préservation intégrale des métadonnées, corrections manuelles et associations IGDB.
- Marque de migration et bilan JSON persistés dans `settings`.
- Tests de migration V0.6.1, base V0.7.0 endommagée et distribution de 4 321 jeux.
- Aucun changement d’interface ni de fonctionnalité.

## 0.7.0 — Recommandations explicables et fiches détaillées

- Premier moteur de recommandation déterministe `explainable-v1`.
- Scores et raisons fondés sur le statut joué, le temps Steam, les genres, thèmes, plateformes, sources et types.
- Exclusion par défaut des applications techniques et non jouables.
- Classification persistante : jeu, démo, bêta, prototype, test public, serveur, outil, DLC et composant multijoueur.
- Filtre de bibliothèque par type d’application.
- Libellé « Métadonnées introuvables » pour les possessions sans fiche correspondante.
- Fiche détaillée accessible depuis la grille et la liste.
- Corrections manuelles protégées par `ADMIN_TOKEN`, persistées séparément des valeurs sources.
- Restauration individuelle des valeurs Steam/IGDB.
- Préparation SQLite du futur rapprochement manuel IGDB, sans correspondance approximative.
- Badges de synchronisation remplacés par des icônes discrètes, avec infobulle et libellé lecteur d’écran.

## 0.6.1 — IGDB secondaire et enrichissement accéléré

- Authentification Twitch Client Credentials côté serveur.
- Rapprochement IGDB par Steam AppID exact, requêtes groupées et cache SQLite.
- Steam Store conservé comme source primaire.
- Enrichissement Steam concurrent et reprise persistante.

## 0.8.0-poc

- Ajoute une interface dédiée de sélection des jeux à analyser par le POC IA.
- Permet la recherche dans toute la bibliothèque et la sélection manuelle par cases à cocher.
- Affiche un compteur explicite et bloque l'analyse tant que la sélection n'est pas validée.
- Propose un échantillon diversifié de 50 jeux, modifiable et jamais confirmé automatiquement.
- Persiste uniquement une sélection explicitement validée par l'utilisateur.
- Documente que la limite de 50 est temporaire et propre au POC, sans contrainte sur l'architecture future.


### Moteur d’analyse effectif

- Connexion configurable à Ollama, par défaut `http://192.168.1.77:11434`.
- Profils d’expérience structurés avec `qwen3:32b`, température 0, graine 42 et prompt versionné.
- Dossiers local-first avec descriptions Steam, résumé/synopsis IGDB et recours optionnel à SearXNG seulement si nécessaire.
- Les URL SearXNG sont conservées pour la traçabilité mais ne sont jamais envoyées à Qwen.
- Embeddings `embeddinggemma` contrôlés à 768 dimensions et stockés en BLOB SQLite.
- Tables dédiées aux exécutions, profils, sources, vecteurs et similarités ; moteur historique préservé.
- Similarités hybrides, ressemblances et différences dans les fiches.
- Boutons Steam Jouer, Installer et Voir sur Steam.
- Lancement, suspension et reprise manuels avec progression et récupération après interruption.
- Verrous empêchant la synchronisation, l’enrichissement ou la modification des sources pendant une analyse IA.
- Tests d’intégration Ollama/SearXNG simulés, contrôle des dimensions et vérification qu’aucune URL documentaire n’est transmise au modèle.
