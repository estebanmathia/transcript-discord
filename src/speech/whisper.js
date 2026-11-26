// Reconnaissance vocale locale (Whisper) : chargement du modèle et transcription de chaque intervention.
const fs = require('node:fs');
const { setTimeout: sleep } = require('node:timers/promises');
const { pipeline, env } = require('@huggingface/transformers');
const {
  whisperModel, whisperDevice, whisperLanguage, modelsDir, sampleRate,
} = require('../config');

env.cacheDir = modelsDir;
const asrOptions = { language: whisperLanguage, task: 'transcribe', chunk_length_s: 30, stride_length_s: 5 };
let transcriber;
let queue = Promise.resolve();

// Charge le modèle, puis le teste sur un silence (le premier passage est plus lent).
async function loadTranscriber() {
  const { rename } = fs.promises;
  // Windows Defender peut verrouiller quelques secondes un fichier de modèle tout juste téléchargé.
  fs.promises.rename = async (from, to) => {
    for (let attempt = 1; ; attempt++) {
      try {
        return await rename(from, to);
      } catch (error) {
        if (attempt === 120 || !['EBUSY', 'EPERM', 'EACCES'].includes(error.code)) throw error;
        await sleep(500);
      }
    }
  };
  const shown = {};
  try {
    const asr = await pipeline('automatic-speech-recognition', whisperModel, {
      device: whisperDevice,
      dtype: whisperDevice === 'cpu' ? 'fp32' : 'fp16',
      progress_callback: ({ status, file, progress, total }) => {
        if (status !== 'progress' || total < 10e6 || progress >= 100) return;
        const step = Math.floor(progress / 10) * 10;
        if (step > (shown[file] ?? 0)) {
          shown[file] = step;
          console.log(`Téléchargement de ${file} : ${step} %`);
        }
      },
    });
    await asr(new Float32Array(sampleRate), asrOptions);
    transcriber = asr;
  } finally {
    fs.promises.rename = rename;
  }
}

// Transcrit un passage (PCM 16 bits mono à 16 kHz). Les passages sont traités l'un après l'autre.
async function transcribe(pcm) {
  const audio = new Float32Array(pcm.length / 2);
  let energy = 0;
  for (let i = 0; i < audio.length; i++) {
    audio[i] = pcm.readInt16LE(i * 2) / 32768;
    energy += audio[i] * audio[i];
  }
  // Sur du silence, Whisper invente du texte (« Sous-titrage Société Radio-Canada »).
  if (energy / audio.length < 1e-6) return '';
  const result = queue.then(() => transcriber(audio, asrOptions));
  queue = result.catch(() => {});
  const { text } = await result;
  return /[\p{L}\p{N}]/u.test(text) ? text.trim() : '';
}

module.exports = { loadTranscriber, transcribe };
