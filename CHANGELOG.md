# Journal des changements

## 1.2.1-hotfix.1 — reconnexion historique, sans migration

- rétablit `DATABASE_PATH` et le montage `/data` de V1.1.4 ;
- refuse les chemins `DATABASE_PATH` / `DB_PATH` contradictoires ;
- refuse de démarrer si le fichier historique n'existe pas ;
- supprime toute migration automatique au démarrage ;
- valide en lecture seule la structure historique et `PRAGMA quick_check` ;
- restaure les jaquettes Steam de repli, les résumés de profils et les fiches enrichies ;
- réutilise les embeddings historiques pour Découverte ;
- désactive le ré-enrichissement par défaut ;
- ne crée pas les tables V1.2 absentes du schéma 1.1.4.
