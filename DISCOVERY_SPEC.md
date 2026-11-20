# Backlog Discovery V0.9.6 — spécification du prototype

## Hypothèse testée

À partir d’un jeu apprécié et des motivations que le joueur confirme, Backlog peut-il découvrir cinq jeux pertinents sans les réduire à une ressemblance de genre ou de mécanique ?

## Parcours

1. Le joueur sélectionne un jeu de sa bibliothèque et explique librement pourquoi il l’aime.
2. Qwen propose jusqu’à huit motivations expérientielles, chacune avec preuve tirée du texte, confiance et incertitude.
3. Le joueur corrige, retire, ajoute et confirme les motivations. Les interprétations non confirmées restent des brouillons.
4. Le joueur combine une ou plusieurs intentions confirmées et peut préciser ce qu’il recherche aujourd’hui.
5. EmbeddingGemma représente cette requête. Backlog compare cet embedding aux profils rapides ou actifs disponibles et complète le classement avec les métadonnées de la bibliothèque.
6. Les 40 meilleurs candidats sont conservés pour audit ; seuls les 12 premiers sont soumis à Qwen.
7. Qwen doit choisir exactement cinq jeux et fournir présentation, motivation visée, argument, différence, éléments connus, confiance et incertitude.
8. Le joueur qualifie chaque résultat : intérêt, inadéquation ou bonne piste expliquée pour la mauvaise raison.

## Invariants de sécurité et de compatibilité

- aucune écriture dans les profils, dossiers, embeddings, similarités ou campagnes existants ;
- six tables `discovery_*_v096` dédiées ;
- mutations protégées par le même `ADMIN_TOKEN` ;
- sortie Qwen contrainte par schéma JSON ;
- AppID recommandé obligatoirement présent parmi les candidats approfondis ;
- cinq AppID distincts et au moins une incertitude par résultat ;
- aucune collecte web supplémentaire pendant la découverte ;
- aucune interprétation présentée comme certaine avant confirmation humaine.

## Mesures enregistrées

- taille de la bibliothèque inspectée indirectement par la présélection ;
- nombre de candidats conservés et approfondis ;
- durée d’embedding de la requête ;
- durée de sélection des candidats ;
- durée d’analyse Qwen ;
- durée totale ;
- nombre de recommandations ;
- verdicts qualitatifs et cible de correction.

## Critères de décision

Le prototype doit être évalué sur les jeux déjà évoqués — Control, Persona, Ori, Man of Medan, Until Dawn et DmC — selon :

- **pertinence** : le jeu répond-il réellement à une motivation confirmée ?
- **découverte** : le résultat sort-il des rapprochements évidents ?
- **explication** : le lien, la différence et les limites sont-ils convaincants ?
- **coût** : la sélection large reste rapide et l’analyse profonde est bornée aux candidats prometteurs.

Aucune refonte générale ne doit être décidée avant cette évaluation.
