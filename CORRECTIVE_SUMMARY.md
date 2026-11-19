# Backlog V0.9.4.3 — résumé technique

Cette version étend V0.9.4.2 sans refonte et sans suppression de données. La supervision repose sur des points de reprise SQLite, un journal d’événements, une file persistante et un orchestrateur de campagne capable de suspendre, reprendre et reconstruire intégralement la sélection.

Le moteur IA réutilise chaque étape terminée d’une même tâche. Les interruptions Ollama sont distinguées des erreurs techniques, documentaires et de qualité. Une reconstruction complète force une nouvelle analyse mais stocke le résultat comme nouvelle version candidate.

Les API historiques restent présentes. Les nouveaux endpoints couvrent les campagnes, la pause/reprise, les priorités, le retrait d’un élément et la relance des erreurs.
