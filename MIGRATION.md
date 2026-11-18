# Migration vers Backlog V0.9.4.1

## Principe

V0.9.4.1 est une correction de la première V0.9.4 autonome. Elle restaure l’application complète V0.9.3.2 et intègre le laboratoire de similarité dans la même interface et sur le même port.

## Avant la mise à jour

```bash
cp ./data/backlog.sqlite ./data/backlog.sqlite.bak-$(date +%Y%m%d-%H%M%S)
```

Ne supprimez pas le dossier `data` et ne réinitialisez pas SQLite.

## Compatibilité

- Depuis V0.9.3.2 : quatre tables de réseau sont ajoutées.
- Depuis la première V0.9.4 : les quatre tables existantes sont réutilisées.
- Aucune promotion de profil candidat n’est effectuée.
- Aucune réanalyse ou génération d’embedding n’est lancée au démarrage.

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
