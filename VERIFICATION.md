# Vérification du correctif V0.9.4.1

## Contrôles automatisés

- syntaxe de tous les modules serveur, réseau et interface ;
- 49 tests réussis ;
- migration du réseau idempotente ;
- profil candidat utilisable sans changement de son état ;
- conversion d’un profil V1 imbriqué vers les 11 dimensions communes sans exploiter les métadonnées de source ;
- orchestration complète : réutilisation, conversion, embedding, régénération et recalcul des paires ;
- opération IA `network` vérifiée avec Qwen3 puis EmbeddingGemma, sans promotion de la candidate ;
- reprise idempotente sans nouvelle version de profil ;
- application complète et réseau sur la même base SQLite.

## Contrôles fonctionnels attendus

- onglets : Tableau de bord, Bibliothèque, Connaissances IA, Réseau de similarité, Erreurs, Administration IA ;
- jeton administrateur toujours mémorisé dans l’onglet du navigateur ;
- fiches détaillées, sources, historique, expérience et réanalyse toujours accessibles ;
- mutations du réseau protégées par `ADMIN_TOKEN` ;
- aucun traitement en masse au démarrage.

## Vérification après déploiement

```bash
docker inspect backlog-test --format 'User={{.Config.User}} CapDrop={{json .HostConfig.CapDrop}} ReadOnly={{.HostConfig.ReadonlyRootfs}}'
curl -fsS http://127.0.0.1:3000/healthz
docker logs --tail 30 backlog-test
```
