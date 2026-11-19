# Migration vers Backlog V0.9.4.2

## Principe

V0.9.4.2 reprend la base V0.9.4.1 et corrige uniquement le traitement des profils où `uncertainties` est vide malgré un statut documentaire. Aucune nouvelle table et aucune migration de données ne sont ajoutées par ce correctif.

## Avant la mise à jour

```bash
cp ./data/backlog.sqlite ./data/backlog.sqlite.bak-$(date +%Y%m%d-%H%M%S)
```

Ne supprimez pas le dossier `data` et ne réinitialisez pas SQLite.

## Compatibilité

- Depuis V0.9.3.2 : les quatre tables de réseau initiales et trois tables additives de conversion/suivi sont ajoutées.
- Depuis la première V0.9.4 : les quatre tables existantes sont réutilisées, sans modification destructive.
- Aucune promotion de profil candidat n’est effectuée.
- Aucune réanalyse ou génération d’embedding n’est lancée au démarrage.
- **Compléter le réseau** doit être lancé explicitement avec le jeton administrateur. Les anciens profils restent intacts, les conversions sont stockées séparément et les régénérations créent des versions supplémentaires.
- Un échec sur un jeu est enregistré dans le suivi du lot et n’empêche pas le traitement des jeux suivants.

Tables nouvelles du correctif de complétion :

- `similarity_profile_adapters_v0941` : représentation comparable d’un profil historique ;
- `similarity_completion_runs_v0941` : bilan de chaque lot ;
- `similarity_completion_items_v0941` : état et résultat de chaque jeu du lot.

## Déploiement Dockge

Conservez les ports, réseaux et variables existants. Le service doit inclure :

```yaml
user: "1000:1000"
read_only: true
security_opt:
  - no-new-privileges:true
cap_drop:
  - ALL
tmpfs:
  - /tmp:rw,noexec,nosuid,size=64m
volumes:
  - ./data:/data
```

Enregistrez puis utilisez **Mettre à jour** afin de recréer le conteneur.

## Retour arrière

La migration étant additive, V0.9.3.2 ignore les tables du réseau. En cas de retour arrière, testez d’abord la copie sauvegardée et conservez les tables V0.9.4 : elles n’entravent pas V0.9.3.2.
