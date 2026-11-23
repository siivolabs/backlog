# Validation du correctif historique V1.2.1-hotfix.1

## Résultat

- syntaxe : réussie ;
- tests : 6/6 réussis ;
- fixture : 4 321 jeux, 4 321 profils et 4 321 embeddings ;
- ouverture de la base 1.1.4 : réussie sans migration ;
- tables avant/après ouverture : identiques ;
- SHA-256 du fichier avant/après parcours HTTP de lecture : identique ;
- jaquette enregistrée : conservée ;
- jaquette absente : repli Steam restauré ;
- description enregistrée : conservée ;
- description absente : résumé du profil historique restauré ;
- fiche : profil, source, modèles et embedding présents ;
- Découverte : résultats produits à partir des embeddings 1.1.4, sans modification de `games` ni `profiles` ;
- fichier absent : démarrage refusé, aucune base créée ;
- chemins contradictoires : démarrage refusé ;
- déploiement NAS : non effectué.

## Commandes exécutées

```text
npm run check
npm test
npm run diagnose-db -- <fixture-1.1.4>
```

Le diagnostic en lecture seule a renvoyé `quick_check=ok`, `games=4321`, `profiles=4321`, `profiles_with_embedding=4321` et `unchanged=true`.
