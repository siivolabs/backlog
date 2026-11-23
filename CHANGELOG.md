# Journal des versions

## 1.2.0 — Fiabilisation de la découverte

### Ajouts
- Contrôle de la qualité documentaire avant recommandation ; un embedding seul ne suffit plus.
- Affichage séparé de la proximité sémantique et de la fiabilité du profil.
- Capacité explicite à s’abstenir lorsque les connaissances sont insuffisantes.
- Historique des propositions et pénalité de récence pour renouveler les résultats.
- Diversification légère des résultats sans introduire de tirage aléatoire.
- Bouton **Terminé**, réversible, dans la bibliothèque et les recommandations.
- Exclusion des jeux terminés de Découverte tout en conservant leurs profils.
- Mode **Surprends-moi** lorsqu’aucune envie n’est formulée.

### Conservé
- Base SQLite et migration additive sans suppression de données.
- Import d’inventaire, enrichissement autonome via Ollama, profils et embeddings existants.
- Recherche indépendante par titre, studio ou Steam AppID.
- Fiches enrichies complètes et lecture des structures JSON imbriquées.
- Retours Pertinent/Écarter et jeton administrateur.

### Terminologie
Le pourcentage est désormais présenté comme une **proximité sémantique** et non comme une probabilité d’appréciation.
