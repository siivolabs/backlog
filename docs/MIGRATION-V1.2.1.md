# Migration désactivée dans le correctif historique

Ce correctif n'exécute aucune migration SQLite.

La base utilisée est le fichier existant défini par `DATABASE_PATH`, avec le même contrat que Backlog 1.1.4. Si le fichier manque, si sa structure n'est pas reconnue ou si `quick_check` échoue, l'application refuse de démarrer sans créer ni modifier de base.
