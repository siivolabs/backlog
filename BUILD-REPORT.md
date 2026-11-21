# Rapport de livraison — Backlog Core V1.0.0

## Périmètre livré

- Bibliothèque réelle importée dynamiquement depuis `/data/backlog.sqlite`.
- Nouvelle base indépendante `/data/backlog-core.sqlite`.
- Connaissance IA initialement vierge : aucun ancien profil, dossier, embedding, réseau ou score n'est importé.
- Sélection de 50 jeux maximum et pipeline unique.
- Collecte fraîche de faits officiels Steam, profil expérientiel homogène et embedding Ollama.
- Découverte par résonance, résultat variable de zéro à cinq jeux et mémoire des corrections.
- Interface responsive à trois espaces.
- Déploiement de remplacement réversible : sauvegarde, renommage du conteneur précédent et retour arrière.
- Fichiers Docker Compose local, Dockge/GHCR et workflow GitHub Actions.

## Validations exécutées

- `npm test` : 3 tests réussis sur 3.
  - import d'un inventaire SQLite réel simulé sans reprise de la table IA historique ;
  - enrichissement, profils, embeddings et découverte de bout en bout avec services simulés ;
  - serveur HTTP, état, inventaire et interface statique.
- `npm run check` : syntaxe Node.js validée pour le serveur, les modules et l'interface.
- `sh -n scripts/*.sh` : syntaxe des scripts de prévol, déploiement, vérification et retour arrière validée.

## Limite de l'environnement de construction

La vraie base SQLite du NAS et le moteur Docker du NAS ne sont pas présents dans l'environnement de construction. Le schéma historique est donc traité par un importeur introspectif et le déploiement Docker doit être validé sur le NAS avec `scripts/preflight.sh`, puis par le contrôle visuel de quelques titres avant tout enrichissement.
