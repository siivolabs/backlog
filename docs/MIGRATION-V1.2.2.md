# Initialisation additive V1.2.2

Backlog ouvre exclusivement le fichier existant défini par `DATABASE_PATH`. Il refuse de créer un fichier absent.

Après validation de `games`, `profiles` et `PRAGMA quick_check`, le premier démarrage :

1. crée une sauvegarde cohérente `.pre-v1.2.2-….bak` avec `VACUUM INTO` ;
2. ouvre une transaction `BEGIN IMMEDIATE` ;
3. crée uniquement `game_user_state` et `recommendation_history` si elles manquent ;
4. vérifie toutes leurs colonnes avant de créer les index ;
5. valide par `COMMIT`, ou annule intégralement par `ROLLBACK` au premier échec.

La migration ne remplit pas `game_user_state` avec 4 321 lignes : l'état reste parcimonieux et une ligne n'est écrite que lorsqu'un jeu est marqué Terminé ou rouvert. Les tables `games`, `profiles`, les campagnes, la file historique et les enrichissements restent inchangés.
