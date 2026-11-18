# Changelog

## 0.9.3 — Fiabilité factuelle et corrections apprenantes

- Schéma de profil 2.1 : séparation de la topologie et de la génération de carte.
- Persistance décomposée en sauvegarde intersession, modèle de réinitialisation et persistance du monde multijoueur.
- Preuves détaillées par chemin dans `field_status.<dimension>.claims`.
- Nouveau score de précision des preuves.
- Seconde passe de vérification factuelle avec anomalies structurées.
- Embeddings et validation bloqués lorsque le contrôle factuel n’est pas réussi.
- Notes « À corriger » et corrections de champs réinjectées dans les réanalyses suivantes.
- Migration SQLite additive vers 0.9.3.

## 0.9.2 — Profils d’expérience multidimensionnels

- Nouveau schéma de profil 2.0 avec objets stricts par dimension.
- Provenance documentaire maintenue exclusivement dans `field_status`.
- Rejet des statuts documentaires employés comme contenu de profil.
- Validation croisée des valeurs inconnues, des `SOURCE-N` et de la richesse sémantique.
- Scores séparés pour dossier, profil, sémantique et couverture des preuves.
- Refus de validation et d’embedding pour un profil sémantiquement insuffisant.
- Migration SQLite additive préservant intégralement les profils historiques.
- Pilotes de contrat pour Euro Truck Simulator 2, Control et Satisfactory.

## 0.9.1.2 — Correctif Ollama et migration documentaire

- Le diagnostic Ollama passe par `/api/chat`, désactive explicitement le raisonnement et accorde 64 tokens à la réponse minimale.
- La validation lit `message.content`, conformément à la réponse de l’API Chat Ollama.
- Le diagnostic distingue une réponse réellement vide d’une réponse contenant seulement du raisonnement.
- Une table `ai_document_sources` 0.9.0 incompatible est renommée et conservée avant la création du nouveau schéma.
- La conservation de la table historique et l’idempotence de la migration sont couvertes par des tests de régression.

## 0.9.1 — Dossiers documentaires fiables

### Diagnostic et exploitation
- Diagnostic Ollama structuré par étape, avec contrôle des modèles et génération minimale.
- Messages exploitables pour serveur inaccessible, modèle absent, délai dépassé ou génération en échec.
- Collecte, analyse et embedding relançables indépendamment, jeu par jeu.

### Collecte documentaire
- Descriptions, catégories et développeurs Steam enrichis.
- Réutilisation des métadonnées IGDB présentes dans `provider_cache`.
- Requêtes SearXNG ciblées sur gameplay, structure, expérience et sources officielles.
- Filtrage des DLC, pages commerciales et catalogues génériques.
- Récupération bornée du contenu des pages avec protection SSRF.
- Dossiers et sources versionnés avec pertinence, confiance et provenance.

### Profils et qualité
- Schéma Qwen stable avec état et sources par champ.
- Qualité `complete`, `partial` ou `insufficient`.
- Aucun embedding définitif pour un profil insuffisant.
- Comparaison côte à côte entre version active et candidate.
- Rendu récursif des objets historiques, sans `[object Object]`.

### Données
- Migration 0.9.0 vers 0.9.1 additive et idempotente.
- Aucune réanalyse en masse automatique.

## 0.9.0 — Connaissances IA vérifiables

### Interface
- Nouveau tableau de bord centré sur la couverture et la qualité IA.
- Bibliothèque filtrable par statut : prêt, validé, non analysé, en cours, erreur, réanalyse demandée.
- File de révision « Connaissances IA ».
- Fiche jeu en six onglets : vue générale, profil, sources, similarités, expérience, historique.
- Administration Ollama/SearXNG déplacée dans un panneau secondaire.

### Profils et provenance
- Affichage de toutes les dimensions du profil Qwen.
- Sources avec origine, URL, date, extrait et champs justifiés.
- Validation explicite et état « à corriger ».
- Versionnement : une réanalyse ne remplace jamais immédiatement une version active.

### Analyse
- Réanalyse d’un seul jeu.
- File persistante et diagnostic de l’étape en échec.
- Embedding et similarités recalculés après la nouvelle analyse.
- Polling limité à la durée de la tâche observée ; aucun polling global permanent en état terminal.

### Compréhension du joueur
- Similarité objective notée de 0 à 3.
- Pertinence personnelle enregistrée séparément.
- « Mon expérience » : j’aime/je n’aime pas, note, dimensions et commentaire libre.

### Données
- Migration SQLite additive et idempotente.
- Import automatique des profils 0.8 comme version initiale.
- Aucune réinitialisation des données existantes.
