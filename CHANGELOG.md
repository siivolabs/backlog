# Journal des changements

## 0.4.0

- Sert l’interface Backlog depuis le même conteneur et le même domaine que l’API.
- Conserve l’import local de l’export Steam et le catalogue à jaquettes.
- Ajoute l’affichage en grille ou en liste, la recherche, les tris, les filtres et la pagination.
- Ajoute le test manuel d’une fiche Steam par AppID.
- Ajoute l’enrichissement séquentiel et explicite de 10 jeux visibles au maximum.
- Affiche les genres récupérés et permet de filtrer les genres déjà enrichis.
- Ajoute un cache mémoire temporaire, la coalescence des requêtes identiques et une limitation simple du débit.
- Ajoute une route de santé et des en-têtes HTTP de sécurité.
- Renforce l’image Docker non privilégiée et la configuration Compose sans port publié.
