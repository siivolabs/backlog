# Politique de migration

## Importé depuis l'ancienne base

- identifiant Steam / AppID ;
- titre ;
- studio ou développeur lorsque disponible ;
- genres et catégories d'identification ;
- URL de couverture ;
- temps de jeu et dernière utilisation lorsque disponibles ;

L'importeur inspecte dynamiquement les tables et colonnes. Il privilégie `games`, `steam_games`, `library`, `game_library`, `backlog_games`, `apps` et `owned_games`, mais accepte une autre table si elle possède un identifiant Steam et un titre.

## Délibérément non importé

Les tables et champs relatifs aux dossiers documentaires, profils IA historiques, embeddings, similarités, campagnes, réseaux, évaluations et retours antérieurs ne sont jamais lus par l'importeur.
Les descriptions libres et les blocs JSON historiques sont également ignorés, car leur provenance pourrait être hétérogène. Les faits descriptifs sont recollectés depuis Steam lors du nouvel enrichissement.

## Idempotence

Au premier démarrage, l'import automatique ne s'exécute que si `games` est vide dans `backlog-core.sqlite`. Une réimportation manuelle de l'inventaire met à jour les métadonnées d'identification sans toucher aux profils Core déjà produits.
