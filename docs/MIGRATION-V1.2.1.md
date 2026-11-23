# Migration SQLite V1.2.1

## Cause de l'échec V1.2.0

`CREATE TABLE IF NOT EXISTS` ne modifie pas une table existante. La migration V1.2.0 enchaînait des créations d'index et des requêtes en supposant que les tables V1.1 possédaient déjà le schéma V1.2. Sur la base réelle, plusieurs tables historiques utilisaient encore d'autres noms ou ne possédaient pas les nouvelles colonnes. SQLite levait alors `no such column` avant la phase additive.

## Ordre garanti en V1.2.1

- sauvegarde cohérente ;
- transaction `BEGIN IMMEDIATE` ;
- détection des tables et colonnes ;
- ajout des colonnes ;
- recopie additive des identifiants/dates historiques ;
- index seulement après vérification ;
- initialisation de `game_user_state` ;
- remise en attente des tâches abandonnées ;
- `user_version=1201` et commit.

Aucune table existante n'est supprimée ou renommée. Les tables de campagnes et d'enrichissement autonomes V1.1 restent intactes.
