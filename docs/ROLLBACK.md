# Retour arrière

La V1.1.2 ne renomme, ne convertit et ne supprime aucune table V1.0. Un retour vers l'image V1.0 reste donc possible.

1. Suspendez la campagne dans l'interface et attendez la fin du jeu courant.
2. Arrêtez la stack : `docker compose down`.
3. Dans `.env`, remplacez `IMAGE` par le tag ou digest de l'image V1.0.
4. Relancez : `docker compose pull && docker compose up -d`.

Les deux tables `autonomous_enrichment_control` et `autonomous_enrichment_items` seront simplement ignorées par la V1.0. Ne les supprimez pas si vous souhaitez réutiliser la V1.1.2 plus tard.
