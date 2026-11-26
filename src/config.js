// Réglages du bot, lus une fois au démarrage depuis les variables d'environnement (ou le fichier .env).
require('dotenv').config();
const path = require('node:path');

const root = path.join(__dirname, '..'); // racine du projet (le dossier qui contient src/)

const token = process.env.DISCORD_TOKEN;
if (!token) {
  console.error('Définissez DISCORD_TOKEN avant de démarrer le bot.');
  process.exit(1);
}
const autoImageMinutes = Number(process.env.AUTO_IMAGE_MINUTES || 5);
if (!(autoImageMinutes >= 0)) {
  console.error('AUTO_IMAGE_MINUTES doit être un nombre de minutes (0 pour désactiver).');
  process.exit(1);
}

module.exports = {
  token,
  autoImageMinutes,
  transcriptsDir: path.resolve(root, process.env.TRANSCRIPTS_DIR || 'transcripts'),
  campaignFile: path.resolve(root, process.env.CAMPAIGN_FILE || 'campagne.txt'),
  modelsDir: path.join(root, 'models'),

  // Transcription. 16 kHz : fréquence attendue par Whisper et utilisée pour décoder l'audio.
  sampleRate: 16000,
  whisperModel: process.env.WHISPER_MODEL || 'onnx-community/whisper-large-v3-turbo',
  whisperDevice: process.env.WHISPER_DEVICE || (process.platform === 'win32' ? 'dml' : 'cpu'),
  whisperLanguage: process.env.WHISPER_LANGUAGE || 'french',

  // Illustrations : LM Studio (modèle de langage) et stable-diffusion.cpp (images).
  llmUrl: (process.env.LLM_URL || 'http://127.0.0.1:1234/v1').replace(/\/+$/, ''),
  llmModel: process.env.LLM_MODEL || 'google/gemma-4-e4b',
  llmGpu: process.env.LLM_GPU || 'off',
  sdUrl: (process.env.SD_URL || 'http://127.0.0.1:7860').replace(/\/+$/, ''),
  sdServer: process.env.SD_SERVER,
  imageStyle: process.env.IMAGE_STYLE || 'fantasy illustration, digital painting, dramatic lighting, highly detailed',
};
