# Changelog

## 0.5.0 — 2026-11-16

### Ajouté
- Base SQLite persistante pour les jeux, l’état d’import et les métadonnées Steam.
- Restauration automatique de la bibliothèque au chargement de la page.
- Volume Docker nommé `backlog_data` monté sur `/data`.
- Routes `GET /api/library`, `POST /api/library/import`, `DELETE /api/library` et `POST /api/library/enrich`.
- Tests de persistance, de cache et de limite des lots.

### Corrigé
- Le message « La bibliothèque est vide » est masqué quand des jeux sont visibles.
- Un message distinct s’affiche lorsqu’une bibliothèque importée ne contient aucun résultat correspondant aux filtres.

### Conservé
- Présentation générale de la v0.4.
- Import Steam, jaquettes, statistiques, recherche, filtres, tri, pagination et affichages grille/liste.
- Test d’un AppID et enrichissement séquentiel limité à dix jeux.
