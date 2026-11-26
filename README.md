# Transcription Discord

Bot qui rejoint un salon vocal Discord, transcrit les interventions avec leur
auteur **sur votre ordinateur** (Whisper, sans service externe) et produit un
fichier texte par session, envoyé dans le salon textuel à la fin. En option,
il illustre les parties de jeu de rôle avec des images générées localement.

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

   Vous pouvez aussi placer `DISCORD_TOKEN=votre-token-discord` (et les autres
   variables ci-dessous) dans un fichier `.env` à la racine du projet.

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

## Illustrations de jeu de rôle (optionnel)

Pendant une partie, un modèle de langage local relit la transcription récente,
repère les moments forts de la fiction (nouveau lieu, créature, action
spectaculaire) en ignorant le hors-jeu, puis rédige la description d'une image
générée par Stable Diffusion. L'image est publiée dans le salon textuel avec sa
légende, enregistrée dans `transcripts/` à côté de la transcription, et
mentionnée dans celle-ci :

```text
[21:02:58] Illustration : Une liche couronnée surgit d'un sarcophage. (2026-11-21_21-00-00_Général_21-02-58.png)
```

Le bot vérifie au plus une fois par minute s'il faut illustrer, avec au moins
`AUTO_IMAGE_MINUTES` minutes entre deux images automatiques. Depuis le salon
vocal, `!transcription image` illustre aussitôt la scène en cours ; ajoutez une
indication pour orienter l'image, par exemple
`!transcription image Borin face au dragon`.

Deux serveurs locaux sont nécessaires ; sans eux, la transcription fonctionne
normalement et le bot signale au démarrage que les illustrations sont
indisponibles.

1. **[LM Studio](https://lmstudio.ai/)** : téléchargez une fois le modèle avec
   `lms get google/gemma-4-e4b`. Au démarrage, le bot lance lui-même le
   serveur LM Studio et charge le modèle s'il ne l'est pas déjà. Par défaut, il
   le charge sur le processeur (`LLM_GPU=off`) : avec une carte graphique de
   12 Go, Whisper et Stable Diffusion ont besoin de sa mémoire, sinon la
   génération d'image se bloque.
2. **[stable-diffusion.cpp](https://github.com/leejet/stable-diffusion.cpp/releases)** :
   pour une carte NVIDIA, extrayez dans un même dossier l'archive
   `sd-…-bin-win-cuda12-x64.zip` et `cudart-sd-bin-win-cu12-x64.zip`.
   Téléchargez un modèle SDXL (par exemple `sd_xl_base_1.0.safetensors`) et le
   VAE [`sdxl_vae.safetensors`](https://huggingface.co/madebyollin/sdxl-vae-fp16-fix)
   recommandé par stable-diffusion.cpp pour SDXL. Créez à côté de `start-server.bat`
   un fichier `start-server.local.bat` en adaptant les chemins :

   ```bat
   @echo off
   set "MODEL_DIR=%~dp0models"
   set "COMMANDLINE_ARGS=-m C:\chemin\sd_xl_base_1.0.safetensors --vae C:\chemin\sdxl_vae.safetensors --listen-port 7860 --offload-to-cpu --type q8_0 --vae-tiling --sampling-method dpm++2m --scheduler karras --steps 25 --cfg-scale 6.5 -W 1216 -H 832"
   ```

   `--offload-to-cpu`, `--type q8_0` et `--vae-tiling` limitent la mémoire
   graphique utilisée (environ 3,6 Go pendant la génération). Indiquez ensuite
   le chemin de `start-server.bat` dans `SD_SERVER` (par exemple
   `SD_SERVER=D:\stable-diffusion.cpp\start-server.bat` dans `.env`) : le bot
   démarre alors le serveur en arrière-plan et l'arrête quand il s'éteint
   (Ctrl+C, fermeture de la fenêtre ou erreur). Sans cette variable, lancez
   `start-server.bat` vous-même. Avec une RTX 3060, il faut
   environ 30 secondes au modèle de langage pour décider et décrire la scène,
   puis environ 40 secondes pour l'image ; la première image après le
   démarrage est plus longue, le temps de charger SDXL.

Pour des images cohérentes, copiez `examples/campagne.exemple.txt` à la racine du projet sous le nom `campagne.txt` et
décrivez l'univers, les personnages des joueurs (associés à leur pseudo
Discord) et les lieux importants. Le fichier est relu avant chaque illustration.

| Variable | Par défaut | Rôle |
| --- | --- | --- |
| `AUTO_IMAGE_MINUTES` | `5` | Délai minimal entre deux images automatiques ; `0` les désactive. |
| `LLM_URL` | `http://127.0.0.1:1234/v1` | API compatible OpenAI de LM Studio. |
| `LLM_MODEL` | `google/gemma-4-e4b` | Modèle LM Studio qui choisit et décrit les scènes. |
| `LLM_GPU` | `off` | Part du modèle chargée sur la carte graphique au démarrage : `off`, `max` ou une fraction comme `0.5`. |
| `SD_URL` | `http://127.0.0.1:7860` | Serveur d'images compatible avec l'API `/sdapi/v1/txt2img`. |
| `SD_SERVER` | aucun | Script de lancement du serveur d'images, démarré et arrêté avec le bot s'il ne répond pas déjà. |
| `IMAGE_STYLE` | `fantasy illustration, digital painting, dramatic lighting, highly detailed` | Style ajouté à chaque description d'image. |
| `CAMPAIGN_FILE` | `campagne.txt` | Fichier de contexte de campagne, relatif au projet. |

## Confidentialité

**Informez tous les participants et obtenez leur consentement avant de démarrer
la transcription**, notamment lorsque quelqu'un rejoint le salon en cours de
session. L'audio est transcrit sur l'ordinateur qui exécute le bot et n'est
envoyé à aucun service externe ; il n'est pas enregistré. Les illustrations
sont elles aussi produites localement (LM Studio et stable-diffusion.cpp). Les
fichiers de transcription et les images sont conservés dans le dossier
`transcripts/` (exclu de Git) et publiés dans le salon Discord choisi, où ils
restent soumis à ses permissions et à sa politique de conservation.

## Structure du code

Chaque dossier regroupe un domaine, pour retrouver rapidement où modifier quelque chose :

```text
src/
├── index.js               démarrage : serveurs locaux, Whisper, connexion à Discord
├── config.js              tous les réglages lus dans l'environnement (.env)
├── discord/
│   ├── client.js          client Discord et événements
│   └── commands.js        commandes !transcription
├── session/
│   ├── sessions.js        sessions actives : démarrer, arrêter, sauvegarder
│   ├── capture.js         réception audio de chaque intervention
│   └── transcript.js      fichier de transcription (nom, lignes, extrait récent)
├── speech/
│   └── whisper.js         reconnaissance vocale locale (Whisper)
└── illustration/
    ├── illustrate.js      décision et publication des illustrations
    ├── scene.js           description de la scène (LM Studio)
    ├── image.js           génération d'image (stable-diffusion.cpp)
    ├── servers.js         lancement et vérification des serveurs locaux
    └── http.js            requête POST vers les serveurs locaux
examples/
└── campagne.exemple.txt   modèle de fichier de campagne
```
