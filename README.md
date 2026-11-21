# Transcription Discord

Bot qui rejoint un salon vocal Discord, transcrit les interventions avec leur
auteur **sur votre ordinateur** (Whisper, sans service externe) et produit un
fichier texte par session, envoyé dans le salon textuel à la fin.

## Installation

Il faut Node.js 22.12 ou plus récent et un bot Discord. Aucune clé d'API n'est
nécessaire.

1. Dans le [portail Discord](https://discord.com/developers/applications),
   créez une application. Dans son onglet **Bot**, cliquez sur
   **Réinitialiser le token** et copiez le token, puis activez l'intention
   privilégiée **Message Content Intent** et enregistrez.
2. Dans l'onglet **OAuth2**, cochez `bot` dans le générateur d'URL, puis les
   permissions **Voir les salons**, **Envoyer des messages**,
   **Joindre des fichiers**, **Voir les anciens messages** (indispensable pour
   répondre aux commandes) et **Se connecter**. Ouvrez l'URL générée pour
   inviter le bot sur le serveur. L'URL équivalente est
   `https://discord.com/oauth2/authorize?client_id=VOTRE_ID&permissions=1149952&scope=bot`.
3. Installez les dépendances avec `npm ci`.
4. Configurez le token et démarrez le bot :

   ```powershell
   # PowerShell (Windows)
   $env:DISCORD_TOKEN = "votre-token-discord"
   npm start
   ```

   ```sh
   # Linux / macOS
   export DISCORD_TOKEN="votre-token-discord"
   npm start
   ```

Ne partagez pas ce token et ne l'ajoutez pas au dépôt.

Au premier démarrage, le modèle Whisper (`onnx-community/whisper-large-v3-turbo`,
environ 1,6 Go) est téléchargé depuis Hugging Face dans le dossier `models/` ;
les démarrages suivants fonctionnent hors ligne. Le bot affiche
« Modèle de transcription prêt. » puis se connecte à Discord.

### Configuration

Ces variables d'environnement sont facultatives :

| Variable | Par défaut | Rôle |
| --- | --- | --- |
| `WHISPER_DEVICE` | `dml` sous Windows, `cpu` ailleurs | `dml` utilise la carte graphique (DirectML), `cpu` le processeur. |
| `WHISPER_MODEL` | `onnx-community/whisper-large-v3-turbo` | Modèle Whisper ONNX de Hugging Face. Sur processeur, `onnx-community/whisper-small` est bien plus rapide. |
| `WHISPER_LANGUAGE` | `french` | Langue parlée (`english`, `german`…). |
| `TRANSCRIPTS_DIR` | `transcripts` | Dossier des fichiers de transcription, relatif au projet. |

Si le démarrage échoue avec `dml` (pas de carte graphique compatible),
utilisez `WHISPER_DEVICE=cpu` avec le modèle `onnx-community/whisper-small`.

## Utilisation

Rejoignez un salon vocal, puis envoyez `!transcription rejoindre` dans le salon
textuel où le fichier doit être envoyé. Envoyez `!transcription quitter`
depuis ce même salon vocal pour arrêter. Une seule transcription peut être
active par serveur.

Les interventions sont découpées après une seconde de silence ou au bout de
60 secondes. Le fichier, nommé d'après la date et le salon vocal (par exemple
`transcripts/2026-11-21_15-02-10_Général.txt`), est complété au fil de la
session. À l'arrêt, le bot termine les transcriptions en attente, trie les
interventions par heure de début puis envoie le fichier dans le salon
textuel :

```text
Transcription du salon vocal « Général » (Mon serveur)
Début : 21/11/2026 15:02:10

[15:02:12] Alice : Bonjour à tous, merci d'être présents.
[15:02:19] Bob : Bonjour !

Fin : 21/11/2026 16:00:00
```

La reconnaissance vocale peut comporter des erreurs.

## Confidentialité

**Informez tous les participants et obtenez leur consentement avant de démarrer
la transcription**, notamment lorsque quelqu'un rejoint le salon en cours de
session. L'audio est transcrit sur l'ordinateur qui exécute le bot et n'est
envoyé à aucun service externe ; il n'est pas enregistré. Les fichiers de
transcription sont conservés dans le dossier `transcripts/` (exclu de Git) et
publiés dans le salon Discord choisi, où ils restent soumis à ses permissions
et à sa politique de conservation.
