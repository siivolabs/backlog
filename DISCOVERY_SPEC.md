# Backlog Discovery V0.9.7 — apprentissage contextuel

## Hypothèse testée

Backlog peut-il réutiliser les corrections du joueur et renouveler ses propositions sans transformer une observation locale en règle générale ?

## Parcours

1. Le joueur confirme des motivations expérientielles comme en V0.9.6.
2. La recherche relit les retours pertinents et les associations exactes entre un AppID et une intention sélectionnée.
3. La présélection réutilise les embeddings et métadonnées existants ; la mémoire n’ajuste que le jeu auquel elle se rapporte.
4. Qwen reçoit au maximum 12 candidats et la mémoire locale, avec interdiction explicite de la généraliser.
5. Qwen évalue chaque motivation séparément : `satisfied`, `unsatisfied` ou `uncertain`.
6. Le moteur conserve de zéro à cinq jeux. Un jeu sans motivation satisfaite est écarté.
7. Le joueur peut qualifier le résultat, sa familiarité avec le jeu et chaque association jeu–motivation.
8. **Affiner ces recommandations** exclut la série courante. **Explorer d'autres jeux** exclut toutes les recommandations déjà vues avec le même jeu de référence et le même ensemble d’intentions.

## Portée de la mémoire

- Une association est indexée par `(app_id, intention_id)`.
- Un rejet sur Satisfactory ne modifie ni l’intention globale du joueur ni les autres jeux.
- Le commentaire qualitatif reste lié à la recommandation et à son AppID.
- Chaque réutilisation est comptée et le dernier run consommateur est enregistré.
- Les associations explicites remplacent la valeur précédente pour le même couple, tout en conservant la recommandation source dans les tables V0.9.6.

## Invariants de compatibilité

- les six tables `discovery_*_v096` sont conservées ;
- quatre tables `discovery_*_v097` sont ajoutées de façon idempotente ;
- aucune écriture dans les profils, dossiers, embeddings, similarités, réseaux ou campagnes ;
- aucun appel IA supplémentaire par recherche ;
- AppID recommandé obligatoirement présent parmi les candidats approfondis ;
- zéro à cinq AppID distincts ;
- toutes les motivations sélectionnées possèdent une évaluation indépendante ;
- mutations protégées par `ADMIN_TOKEN`.

## Mesures

Les durées V0.9.6 restent enregistrées. La V0.9.7 ajoute le mode du run, son parent, les AppID exclus, le nombre d’éléments de mémoire relus et les compteurs de réutilisation.
