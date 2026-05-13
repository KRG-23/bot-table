# Checklist d'acceptation finale

Objectif : valider le bot avant un déploiement durable ou avant ouverture à une association.

## Pré-requis

- Base PostgreSQL migrée.
- Bot démarré et connecté à Discord.
- Au moins un rôle admin ou un compte avec permission administrateur serveur.
- Au moins un jeu actif avec canal associé.
- Tables par défaut configurées sur le jeu.
- `ALLOW_BOT_PLAYERS=true` uniquement si le serveur de test n'a pas assez d'humains.

## Checks techniques

```bash
npm run check
MUNITORUM_ENV_FILE=.env.dev docker compose --env-file .env.dev -f docker-compose.prod.yml config
MUNITORUM_ENV_FILE=.env.dev docker compose --env-file .env.dev -f docker-compose.prod.yml build bot
```

Résultat attendu :

- lint OK ;
- build TypeScript OK ;
- tests OK ;
- configuration Compose prod valide ;
- image `munitorum-bot:prod` construite.

## Fuseau horaire et changement d'heure

Couvert par les tests automatisés `src/utils/dates.test.ts`.

Points validés :

- dates françaises parsées à minuit en `Europe/Paris` ;
- passage heure d'été 2026 ;
- passage heure d'hiver 2026 ;
- format `JJ/MM/AAAA`.

## Scénarios Discord

### 1. Santé

Action :

- lancer `/mu_health`.

Attendu :

- réponse éphémère ;
- statut opérationnel ;
- métriques affichées.

### 2. Configuration jeux et tables

Actions :

- lancer `/mu_config` ;
- ouvrir “Jeux & tables” ;
- vérifier qu'un jeu actif a un canal ;
- définir les tables par défaut ;
- choisir une date créée et modifier les tables du jeu.

Attendu :

- le jeu apparaît actif ;
- le canal est enregistré ;
- la capacité par date est visible dans “État” ou `/mu_tables show`.

### 3. Génération des créneaux

Actions :

- ouvrir `/mu_config` > “Créneaux” ;
- cliquer “Générer le mois”.

Attendu :

- événements du mois créés ;
- créneaux fermés ignorés ;
- fils `Soirée <jeu> le <date>` créés dans les canaux configurés ;
- message guide publié dans chaque fil.

### 4. Création de partie depuis un fil

Action dans un fil de soirée :

```text
@Munitorum @Joueur1 vs @Joueur2
```

Attendu :

- jeu déduit automatiquement du fil ;
- partie enregistrée en attente ;
- boutons `Valider`, `Refuser`, `Annuler` affichés ;
- DM envoyés si Discord l'autorise.

### 5. Refus doublon

Action :

- tenter une deuxième partie avec un joueur déjà en attente ou validé sur la même date.

Attendu :

- refus avec message doublon ;
- aucune deuxième partie active créée.

### 6. Validation manuelle

Action :

- cliquer `Valider` ou utiliser `/mu_match validate`.

Attendu :

- statut `VALIDE` ;
- DM joueurs ;
- message dans le fil si l'option “mention dans le fil” est activée.

### 7. Refus manuel

Action :

- cliquer `Refuser` ou utiliser `/mu_match refuse`.

Attendu :

- statut `REFUSE` ;
- joueurs libérés pour une nouvelle partie sur la même date.

### 8. Annulation et auto-validation

Pré-requis :

- une partie validée ;
- au moins une partie en attente du même jeu ;
- capacité suffisante après annulation.

Action :

- annuler la partie validée depuis le bouton ou `/mu_match cancel`.

Attendu :

- partie annulée ;
- joueurs libérés ;
- partie en attente auto-validée si toute la file rentre dans la capacité restante.

### 9. Notifications

Actions :

- activer “mention dans le fil” ;
- valider une partie ;
- désactiver “mention dans le fil” ;
- valider une autre partie.

Attendu :

- DM envoyés dans les deux cas ;
- message de fil uniquement quand l'option est active.

### 10. Automatisations

Actions :

- ouvrir `/mu_config` > “Automatisations” ;
- modifier une valeur ;
- réinitialiser les valeurs par défaut.

Attendu :

- valeurs sauvegardées ;
- scheduler rafraîchi sans redémarrage ;
- valeurs par défaut restaurées.

## Persistance et redémarrage

Actions :

```bash
docker compose --env-file .env.dev restart bot
docker compose --env-file .env.dev logs --tail 50 bot
```

Attendu :

- bot reconnecté ;
- commandes enregistrées ;
- jeux, tables, créneaux et parties déjà créés toujours visibles via `/mu_config`.

Pour tester une restauration :

```bash
docker compose --env-file .env.dev exec bot npm run backup:run
```

Puis suivre la procédure `docs/operations.md`.
