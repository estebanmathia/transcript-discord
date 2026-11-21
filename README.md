# Transcription Discord

Bot qui rejoint un salon vocal Discord et publie dans un salon textuel la
transcription des interventions, avec leur auteur.

## Installation

Il faut Node.js 22.12 ou plus récent, une clé API OpenAI et un bot Discord.

1. Dans le [portail Discord](https://discord.com/developers/applications),
   créez un bot et activez l'intention privilégiée **Message Content Intent**.
   Invitez-le sur le serveur avec les permissions de voir et envoyer des
   messages dans le salon textuel et de se connecter au salon vocal.
2. Installez les dépendances avec `npm ci`.
3. Configurez les variables d'environnement et démarrez le bot :

   ```sh
   export DISCORD_TOKEN="votre-token-discord"
   export OPENAI_API_KEY="votre-cle-openai"
   npm start
   ```

Ne partagez pas ces clés et ne les ajoutez pas au dépôt.

## Utilisation

Rejoignez un salon vocal, puis envoyez `!transcription rejoindre` dans le salon
textuel où les transcriptions doivent apparaître. Envoyez
`!transcription quitter` depuis ce même salon vocal pour arrêter. Une seule
transcription peut être active par serveur.

Les interventions sont découpées après une seconde de silence ou au bout
de 60 secondes ; leur ordre de publication peut varier selon le temps de
traitement. La reconnaissance vocale peut comporter des erreurs.

## Confidentialité

**Informez tous les participants et obtenez leur consentement avant de démarrer
la transcription**, notamment lorsque quelqu'un rejoint le salon en cours de
session. L'audio est envoyé à l'API OpenAI (modèle `whisper-1`, service payant) ;
consultez les conditions et la politique de conservation d'OpenAI. Les
transcriptions sont publiées dans le salon Discord choisi et restent soumises
à ses permissions et à sa politique de conservation. Le bot ne sauvegarde pas
localement les enregistrements.
