# Sécurité et confidentialité

- Définissez `ADMIN_TOKEN` pour protéger le lancement, la suspension et la reprise des enrichissements ainsi que le réimport d'inventaire.
- N'exposez pas directement le port 3000 à Internet sans reverse proxy, TLS et contrôle d'accès.
- Les textes envoyés à Ollama restent dirigés vers l'URL configurée dans `OLLAMA_BASE_URL`.
- L'API officielle Steam n'est consultée que pendant un enrichissement et peut être désactivée avec `STEAM_FETCH_ENABLED=false`.
- Aucune télémétrie n'est intégrée.
