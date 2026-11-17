# Vérification du livrable 0.9.0

## Contrôles exécutés

- analyse syntaxique de `server.js`, `lib/database.js`, `lib/ai-engine.js` et `public/app.js` ;
- 6 tests automatisés réussis ;
- migration d’une base factice 0.8 avec jeux, profil, embedding et source ;
- conservation de la table de jeux historique ;
- création d’une version candidate sans écraser la version active ;
- validation d’une candidate et classement de l’ancienne version en `superseded` ;
- séparation des retours de similarité et de l’expérience personnelle ;
- démarrage HTTP sur une base existante ;
- vérification de `/healthz`, du tableau de bord, du filtre `ready`, de la fiche complète et de la page HTML.

## Résultat

```text
tests 6
pass 6
fail 0
```

## Vérification visuelle

Le HTML, les styles et le JavaScript ont été vérifiés statiquement et servis par le serveur d’intégration. Le navigateur Playwright présent dans l’environnement ne disposait pas de son binaire Chromium, donc aucune capture rendue n’a pu être produite dans cet environnement.

## Vérification à faire sur les données réelles

Le schéma SQLite réel du NAS n’était pas accessible depuis l’environnement de construction. La migration utilise donc une détection non destructive des noms de tables et colonnes courants. Avant déploiement définitif :

1. sauvegarder le volume ;
2. démarrer 0.9 sur une copie du volume ;
3. comparer le nombre de jeux et de profils avec 0.8 ;
4. vérifier au moins un profil, ses sources et une similarité ;
5. n’effectuer une réanalyse qu’après ces contrôles.
