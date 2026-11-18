# Changelog

## 0.9.4.1 — correctif d’intégration

- Restaure intégralement l’interface et les capacités de V0.9.3.2.
- Ajoute le réseau expérimental comme sixième onglet au lieu de remplacer l’application.
- Conserve l’administration et le contrôle `ADMIN_TOKEN` pour toutes les mutations.
- Réutilise les tables créées par la première V0.9.4 sans supprimer de données.
- Remplace le remplissage limité des embeddings par **Compléter le réseau**, un traitement par lot des jeux sélectionnés.
- Réutilise les profils et embeddings déjà exploitables.
- Convertit les anciens profils V1 reconnus vers un socle commun auditable, sans réécrire leur JSON source.
- Régénère uniquement les profils réellement insuffisants avec Qwen3 et crée leurs embeddings avec EmbeddingGemma.
- Enregistre les régénérations comme versions supplémentaires sans promotion ni validation jeu par jeu.
- Recalcule automatiquement toutes les paires après le lot et conserve l’historique détaillé de chaque exécution.
- Utilise les profils candidats à titre expérimental sans les promouvoir.
- Porte la suite à 49 tests, dont conversion V1, orchestration du lot, scénario complet de 50 jeux/1 225 paires, reprise idempotente et opération IA réseau.

## 0.9.3.2 — Consolidation sûre des preuves dupliquées

- Un seul `claim` est conservé par chemin après normalisation des alias et après réparation Qwen.
- Les preuves compatibles fusionnent leurs `source_ids` sans perdre les notes ; `direct` prévaut sur `indirect` et la confiance retenue reste la plus prudente.
- Les collisions créées par `atmosphere_theme.*` → `atmosphere_themes.*` ou par une réparation Qwen sont consolidées avant la validation stricte.
- Une preuve `contradictory` n’est jamais fusionnée silencieusement avec une preuve qui soutient la valeur.
- Une correction `human` n’est jamais confondue avec une preuve documentaire sur le même chemin.
- Les incompatibilités retournent le code structuré `CONFLICTING_EVIDENCE_CLAIMS`, avec dimension, chemin, supports, sources et motif visibles dans l’interface.
- Le prompt demande désormais explicitement à Qwen de regrouper toutes les sources d’un même chemin dans une seule preuve.
- Schéma de profil 2.1 et schéma SQLite 0.9.3 inchangés ; aucune donnée historique réécrite.
- Tests de non-régression portés de 35 à 41 cas.

## 0.9.3.1 — Correctif des chemins de preuve

- Alias explicite `atmosphere_theme.*` → `atmosphere_themes.*` avant validation.
- Contrôle de l’existence réelle des chemins de preuve, y compris les indices de listes.
- Une seule tentative Qwen pour les chemins non couverts par un alias connu.
- Réparations bornées aux cibles autorisées de la même dimension ; aucune valeur du profil ne peut être modifiée.
- Validation stricte relancée après réparation et rejet si un chemin reste invalide.
- Erreurs structurées avec étape, code, dimension, chemin reçu et chemin attendu lorsque celui-ci est connu.
- Détail complet visible dans la fiche du jeu et dans la vue **Erreurs**.
- Schéma SQLite 0.9.3 inchangé ; aucune donnée historique réécrite.
- Tests de non-régression portés de 28 à 35 cas.

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
