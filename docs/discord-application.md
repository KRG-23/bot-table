# Configuration de l'application Discord

Ce guide décrit la création ou la migration de l'application Discord utilisée par
Otto.

## Créer l'application

1. Ouvrir le Discord Developer Portal.
2. Créer une nouvelle application nommée `Otto`.
3. Renseigner la description :

```text
Otto est un bot Discord de réservation de tables de jeux. Il gère les créneaux, les jeux, les tables disponibles, les fils de discussion par soirée, les demandes de parties, leur validation, et les notifications aux joueurs. Simple, configurable et pensé pour les clubs.
```

4. Ajouter jusqu'à 5 tags :

```text
tabletop
reservations
club
scheduling
automation
```

5. Laisser vide :
   - `URL du point de terminaison des interactions` ;
   - `URL de vérification des rôles liés`.

Otto utilise `discord.js` via Gateway. Il n'expose pas de webhook ni de point
d'entrée HTTP pour les interactions.

## URLs légales

Renseigner les URLs publiques suivantes si le dépôt est public :

```text
Conditions d'utilisation : https://github.com/KRG-23/otto-table/blob/main/docs/terms-of-service.md
Politique de confidentialité : https://github.com/KRG-23/otto-table/blob/main/docs/privacy-policy.md
```

Si Discord refuse les pages Markdown GitHub, publier ces documents via GitHub
Pages et utiliser les URLs GitHub Pages.

## Bot et intents

Dans `Bot`, créer ou réinitialiser le token, puis activer les intents suivants :

- `SERVER MEMBERS INTENT` ;
- `MESSAGE CONTENT INTENT`.

`PRESENCE INTENT` n'est pas nécessaire.

Ces intents sont requis car Otto lit les messages dans les fils de soirée et peut
résoudre les joueurs par mention, ID Discord ou nom exact du serveur.

## Installation OAuth2

Dans `OAuth2` > `Générateur d'URL OAuth2`, cocher les scopes :

- `bot` ;
- `applications.commands`.

Cocher les permissions bot :

- `Voir les salons` ;
- `Envoyer des messages` ;
- `Créer des fils publics` ;
- `Envoyer des messages dans les fils` ;
- `Gérer les fils` ;
- `Voir les anciens messages` ;
- `Utiliser les commandes slash`.

Permissions optionnelles :

- `Ajouter des réactions` ;
- `Intégrer des liens`.

Ne pas cocher `Administrateur`.

Exemple d'URL d'installation :

```text
https://discord.com/oauth2/authorize?client_id=<DISCORD_APP_ID>&permissions=328565083200&integration_type=0&scope=bot+applications.commands
```

Ouvrir cette URL, choisir le serveur, puis autoriser l'application. Si Otto est
déjà présent sur le serveur, réutiliser l'URL met à jour les scopes et
permissions.

## Variables d'environnement

Mettre à jour l'env file utilisée par Docker :

```env
DISCORD_TOKEN=<token du bot Otto>
DISCORD_APP_ID=<application ID Otto>
DISCORD_PUBLIC_KEY=<public key Otto>
DISCORD_GUILD_ID=<ID du serveur Discord>
DISCORD_CHANNEL_ID=<ID du canal de notifications>
```

`DISCORD_TOKEN`, `DISCORD_APP_ID` et `DISCORD_PUBLIC_KEY` doivent venir de la
même application Discord.

## Redémarrer et vérifier

```bash
docker compose --env-file .env.dev up -d --force-recreate bot
docker compose --env-file .env.dev logs --tail 50 bot
```

Les logs attendus contiennent :

```text
Registering guild slash commands
Discord client ready
Scheduler job planned
```

Tester ensuite dans Discord :

```text
/ot_health
/ot_config
```

## Nettoyer l'ancien bot

Quand Otto fonctionne :

1. Aller dans `Paramètres du serveur` > `Intégrations`.
2. Retirer l'ancienne application.
3. Vérifier qu'un seul bot de réservation reste connecté.

Cela évite que deux bots répondent aux mêmes événements.

## Erreurs fréquentes

### `Used disallowed intents`

Les intents demandés par le code ne sont pas activés sur l'application Discord.
Activer dans `Bot` :

- `SERVER MEMBERS INTENT` ;
- `MESSAGE CONTENT INTENT`.

Sauvegarder, puis redémarrer le conteneur.

### `Missing Access` pendant l'enregistrement des commandes

L'application n'a pas accès au serveur ou n'a pas été installée avec le scope
`applications.commands`.

Vérifier :

- Otto est présent dans `Paramètres du serveur` > `Intégrations` ;
- l'URL d'installation contient `scope=bot+applications.commands` ;
- `.env.dev` contient le token et l'App ID de la même application Otto ;
- `DISCORD_GUILD_ID` correspond au serveur cible.

Réinviter Otto avec l'URL OAuth2 complète, puis redémarrer.

### Aucun webhook visible

C'est normal. Otto n'utilise pas de webhook Discord.
