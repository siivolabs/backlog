# Notes de version — Backlog V0.9.4

## Orientation

Cette version remplace le contrôle bloquant profil par profil par une expérimentation à deux axes :

- **Couverture** : combien de jeux disposent d’un profil, d’un embedding et participent au réseau.
- **Qualité** : complétude commune, niveau A/B/C, dimensions manquantes et pertinence observée des voisins.

## Fonctionnalités livrées

1. Sélection persistante des jeux de l’expérience.
2. Lecture des profils actifs et candidats sans modification de leur état.
3. Normalisation de 11 dimensions communes.
4. Calcul complet des paires uniques et top 5 par jeu.
5. Score hybride sémantique/structuré avec repli documenté.
6. Explication des ressemblances et différences principales.
7. Évaluation humaine séparée des profils IA.
8. Tableau de bord couverture/qualité et diagnostic des dimensions absentes.
9. Complétion facultative des embeddings via Ollama/EmbeddingGemma.
10. Migration SQLite additive et historique des recalculs.

## Validation effectuée

- 6 tests automatisés réussis.
- Syntaxe vérifiée sur tous les modules serveur.
- Test de bout en bout sur une base de 50 jeux :
  - 50 profils sélectionnés ;
  - 1 225 paires uniques calculées ;
  - 50 jeux présents dans le réseau ;
  - 5 recommandations disponibles pour chacun des 50 jeux ;
  - page d’accueil et API HTTP accessibles.

## Décision de conception

Les sources de la V0.9.3.2 n’étant pas jointes au présent échange, la V0.9.4 est livrée comme extension autonome déployable à côté de Backlog et partageant sa base SQLite. Ce choix évite toute réécriture ou promotion implicite des profils existants.
