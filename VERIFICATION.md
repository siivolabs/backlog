# Vérification du correctif V0.9.4.1

## Contrôles automatisés

- syntaxe de tous les modules serveur, réseau et interface ;
- 44 tests réussis : 41 tests hérités de V0.9.3.2 et 3 tests d’intégration du réseau ;
- migration du réseau idempotente ;
- profil candidat utilisable sans changement de son état ;
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
