# Manuel admin Discord

## Commandes principales

- `/ot_config` : menu public de configuration, actions admin protégées.
- `/ot_health` : état du bot et métriques depuis le dernier démarrage.
- `/ot_slots ...` : gestion directe des créneaux.
- `/ot_games ...` : gestion directe des jeux et canaux.
- `/ot_tables ...` : gestion directe des tables par date et par jeu.
- `/ot_match ...` : création, validation, refus ou annulation d'une partie.

## Accueil `/ot_config`

L'accueil affiche :

- langue ;
- fuseau horaire ;
- jours de créneaux ;
- jeux actifs ;
- automatisations ;
- créneaux du mois, avec la répartition des tables par jeu quand elle est configurée.

Le menu expire au bout de 60 secondes et remplace son contenu par :
`💡 Les 60 secondes sont écoulées !`

## Créneaux

La catégorie “Créneaux” permet :

- générer le mois courant ;
- supprimer le mois courant ;
- supprimer une date précise ;
- configurer les jours actifs.

La génération crée les événements ouverts, applique les tables par défaut des
jeux actifs, puis crée les fils de discussion par jeu quand un canal est
configuré.

## Jeux & tables

La catégorie “Jeux & tables” permet :

- ajouter un jeu ;
- associer un canal Discord au jeu ;
- définir les tables par défaut ;
- activer ou désactiver un jeu ;
- choisir une date créée et définir les tables par jeu.

Un jeu doit avoir un canal. Un canal peut être partagé par plusieurs jeux, mais
les joueurs devront alors préciser le jeu si le bot ne peut pas le déduire.

## Fils de soirée

Chaque fil de soirée correspond à un jeu et une date :
`Soirée <jeu> le <date>`.

Dans un fil, les joueurs peuvent créer une partie avec :

```text
@Otto @Joueur1 vs @Joueur2
```

Le jeu est déduit automatiquement du fil. Le bot accepte aussi une mention, un
ID Discord ou un nom exact du serveur pour les joueurs.

## Actions admin dans un fil

Les boutons du fil permettent :

- `État` : voir le statut de la soirée, tables, parties et capacité restante ;
- `Tables` : modifier les tables du jeu pour cette date ;
- `Confirmer` : valider les parties en attente qui rentrent dans la capacité.

## Parties

Une partie passe par les statuts :

- `EN_ATTENTE` après création ;
- `VALIDE` après validation manuelle ou automatique ;
- `REFUSE` après refus admin ;
- `ANNULE` après annulation par admin ou joueur concerné.

Seules les parties en attente ou validées bloquent une nouvelle réservation
pour un joueur. Une partie refusée ou annulée libère les deux joueurs.

## Notifications

Les DM joueurs sont toujours envoyés quand c'est possible.
La catégorie “Notifications” permet d'activer ou désactiver le message de
validation dans le fil de soirée.

## Automatisations

Les valeurs par défaut sont :

- génération mensuelle : premier dimanche du mois à 09:00 ;
- récap parties : mercredi à 21:00 ;
- fenêtre d'analyse : 7 jours ;
- notifications finales : vendredi à 17:00 ;
- backup PostgreSQL : samedi à 23:00 ;
- rétention backup : 30 jours.

Ces valeurs se modifient dans `/ot_config` > “Automatisations”.
