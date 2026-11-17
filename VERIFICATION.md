# Vérification du livrable 0.9.1

## Contrôles automatisés

- syntaxe de `server.js`, `lib/database.js`, `lib/ai-engine.js` et `public/app.js` ;
- calcul de similarité et construction du texte d’embedding ;
- pénalisation des DLC/pages commerciales par le classement documentaire ;
- blocage des adresses locales et privées lors de la récupération de pages ;
- diagnostic Ollama structuré en cas de modèle absent ;
- génération minimale Ollama sans streaming ;
- import non destructif d’une base 0.8 ;
- conservation de la version active pendant une réanalyse ;
- séparation des retours personnels ;
- détection du chemin SQLite ;
- versionnement indépendant des dossiers documentaires ;
- statut `insufficient` sans embedding ;
- migration additive d’un schéma 0.9.0 vers 0.9.1.

## Résultat

```text
tests 13
pass 13
fail 0
```

## Limites de la vérification locale

Les services réels Ollama, SearXNG, Steam et les pages externes du NAS ne sont pas accessibles pendant les tests automatisés. Les connecteurs sont donc couverts par des simulations et des contrôles unitaires. La validation fonctionnelle finale doit être réalisée sur une copie du volume réel avec le pilote Euro Truck Simulator 2, Control et Satisfactory.

Aucune analyse des 4 321 jeux n’est lancée automatiquement par cette version.
