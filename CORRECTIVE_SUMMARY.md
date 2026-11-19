# Backlog V0.9.4.4 — résumé technique

Cette version corrige la fiabilité de la génération Qwen3 et la supervision des campagnes sans refonte, sans suppression de données et sans modification destructive de SQLite.

- Les analyses, réparations de chemins et vérifications Qwen utilisent désormais le **streaming NDJSON Ollama**. Le délai est un délai d’inactivité réarmé à chaque fragment, ce qui évite qu’une réponse active soit coupée par un chronomètre global autour de 300 secondes.
- Les étapes SQLite déjà terminées sont réutilisées lors d’une relance. Les réponses Qwen validées, profils réparés, vérifications, embeddings et recalculs terminés ne sont pas refaits.
- Pour le seul réseau expérimental, une incohérence documentaire secondaire peut être mise en quarantaine : la caractéristique du jeu est conservée, la preuve douteuse est exclue et l’embedding reste possible si le profil sémantique est exploitable. La génération complète de la base de connaissances conserve sa validation stricte.
- Une erreur réseau ponctuelle ne suspend plus une campagne. Backlog vérifie d’abord `/api/tags`; la suspension automatique n’est appliquée que si Ollama est réellement indisponible.
- Les erreurs de service conservent le fournisseur, l’URL, le statut HTTP, le corps de réponse et la cause technique.
- Le journal de campagne lit les événements SQLite, reste ouvert pendant les rafraîchissements et affiche le nom du jeu avec son AppID.

Les profils existants, embeddings, similarités, versions candidates/actives, données utilisateur et tables SQLite sont conservés.
