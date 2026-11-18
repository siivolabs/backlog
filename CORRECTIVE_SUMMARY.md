# Correctif V0.9.4.1 — résumé technique

## Cause corrigée

La première V0.9.4 était une application autonome centrée sur le laboratoire de similarité. En la déployant à la place de V0.9.3.2, elle masquait la bibliothèque complète, les fiches détaillées, l’administration IA et le jeton administrateur.

## Stratégie

- Base de code : V0.9.3.2 complète.
- Ajout : modules du réseau 0.9.4 isolés sous `lib/network-*` et `lib/similarity-experiment.js`, avec orchestration dans `lib/network-completion.js`.
- Intégration serveur : routes `/api/v09/network/*` sur le serveur existant.
- Intégration interface : onglet `Réseau de similarité` dans la navigation existante.
- Sécurité : toutes les mutations du réseau passent par le même `ADMIN_TOKEN`.
- Données : réutilisation idempotente des quatre tables `v094` et ajout de trois tables `v0941` pour les conversions et le suivi du lot.
- Conteneur : utilisateur `1000:1000`, racine en lecture seule et capacités supprimées.

## Non-régressions vérifiées

- bibliothèque et fiches ;
- profils, sources, historique et validation ;
- administration et jeton ;
- file de réanalyse ;
- erreurs détaillées ;
- données personnelles et retours historiques ;
- réseau expérimental intégré.

Le réseau peut lire un profil candidat pour l’expérimentation, mais ne change jamais son `lifecycle_state`.

## Complétion automatique

L’action **Compléter le réseau** applique, pour chaque jeu sélectionné :

1. réutilisation du profil et de l’embedding existants lorsqu’ils sont exploitables ;
2. conversion additive des anciens profils vers le socle comparable puis création du seul embedding manquant ;
3. régénération Qwen3 des profils insuffisants, vérification factuelle automatisée et embedding EmbeddingGemma ;
4. recalcul des similarités après traitement de tout le lot.

Les profils historiques ne sont jamais réécrits. Une régénération ajoute une version candidate et conserve la version active.
