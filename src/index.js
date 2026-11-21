const fs = require('node:fs');
const path = require('node:path');
const { setTimeout: sleep } = require('node:timers/promises');
const { Client, GatewayIntentBits, Events } = require('discord.js');
const {
  joinVoiceChannel, entersState, VoiceConnectionStatus, EndBehaviorType,
} = require('@discordjs/voice');
const prism = require('prism-media');
const { pipeline, env } = require('@huggingface/transformers');
require('dotenv').config()
const token = process.env.DISCORD_TOKEN;
if (!token) {
  console.error('Définissez DISCORD_TOKEN avant de démarrer le bot.');
  process.exit(1);
}

const root = path.join(__dirname, '..');
const model = process.env.WHISPER_MODEL || 'onnx-community/whisper-large-v3-turbo';
const device = process.env.WHISPER_DEVICE || (process.platform === 'win32' ? 'dml' : 'cpu');
const language = process.env.WHISPER_LANGUAGE || 'french';
const transcriptsDir = path.resolve(root, process.env.TRANSCRIPTS_DIR || 'transcripts');
env.cacheDir = path.join(root, 'models');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildVoiceStates,
  ],
});
const sessions = new Map();
const sampleRate = 16000;
const maxBytes = sampleRate * 2 * 60;
const asrOptions = { language, task: 'transcribe', chunk_length_s: 30, stride_length_s: 5 };
let transcriber;
let queue = Promise.resolve();

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
    const asr = await pipeline('automatic-speech-recognition', model, {
      device,
      dtype: device === 'cpu' ? 'fp32' : 'fp16',
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
    return asr;
  } finally {
    fs.promises.rename = rename;
  }
}

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

const pad = (value) => String(value).padStart(2, '0');

function fileName(date, channelName) {
  const day = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  const time = `${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}`;
  const channel = channelName.replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '').slice(0, 50);
  return `${day}_${time}_${channel || 'salon'}.txt`;
}

function formatEntry({ startedAt, speaker, text }) {
  return `[${startedAt.toLocaleTimeString('fr-FR')}] ${speaker} : ${text}\n`;
}

async function record(session, userId, startedAt, pcm) {
  if (!pcm.length) return;
  let text;
  try {
    text = await transcribe(pcm);
  } catch (error) {
    console.error('Transcription impossible :', error.message);
    text = '[transcription impossible]';
  }
  if (!text) return;
  const member = await session.guild.members.fetch(userId).catch(() => null);
  const entry = { startedAt, speaker: member?.displayName ?? userId, text };
  session.entries.push(entry);
  try {
    fs.appendFileSync(session.file, formatEntry(entry));
  } catch (error) {
    console.error('Écriture de la transcription impossible :', error.message);
  }
}

async function saveTranscript(session) {
  if (!session.file) return;
  await Promise.allSettled(session.tasks);
  const entries = session.entries.sort((a, b) => a.startedAt - b.startedAt);
  const body = entries.length ? entries.map(formatEntry).join('') : '(aucune intervention transcrite)\n';
  try {
    fs.writeFileSync(session.file, `${session.header}${body}\nFin : ${new Date().toLocaleString('fr-FR')}\n`);
    console.log(`Transcription enregistrée : ${session.file}`);
    await session.textChannel.send({ content: 'Transcription de la session :', files: [session.file] });
  } catch (error) {
    console.error('Enregistrement ou envoi de la transcription impossible :', error.message);
    await session.textChannel.send('Le fichier de transcription n’a pas pu être envoyé. Vérifiez les journaux du bot.')
      .catch(() => {});
  }
}

function stop(session) {
  if (sessions.get(session.guildId) !== session) return false;
  sessions.delete(session.guildId);
  session.stopped = true;
  for (const capture of session.captures.values()) capture.finish();
  void saveTranscript(session);
  session.connection.destroy();
  return true;
}

function captureSpeech(session, userId) {
  if (session.stopped || session.captures.has(userId)) return;
  const startedAt = new Date();
  const audio = session.connection.receiver.subscribe(userId, {
    end: { behavior: EndBehaviorType.AfterSilence, duration: 1000 },
  });
  const decoder = new prism.opus.Decoder({ rate: sampleRate, channels: 1, frameSize: 320 });
  const chunks = [];
  let bytes = 0;
  let finished = false;
  let restart = false;
  const timer = setTimeout(finish, 60000);

  function cleanup() {
    clearTimeout(timer);
    audio.unpipe(decoder);
    audio.destroy();
  }

  function finish() {
    if (finished) return;
    finished = true;
    restart = true;
    cleanup();
    decoder.end();
  }

  function cancel() {
    if (finished) return;
    finished = true;
    cleanup();
    decoder.destroy();
  }

  const task = new Promise((resolve) => {
    decoder.once('end', () => resolve(record(session, userId, startedAt, Buffer.concat(chunks))));
    decoder.once('close', resolve);
  });
  session.tasks.add(task);
  void task.then(() => session.tasks.delete(task));
  session.captures.set(userId, { finish });
  audio.once('close', () => {
    session.captures.delete(userId);
    if (restart && !session.stopped && session.connection.receiver.speaking.users.has(userId)) {
      captureSpeech(session, userId);
    }
  });
  audio.on('error', (error) => {
    console.error('Réception audio impossible :', error.message);
    cancel();
  });
  decoder.on('error', (error) => {
    console.error('Décodage audio impossible :', error.message);
    cancel();
  });
  audio.on('end', finish);
  decoder.on('data', (chunk) => {
    const remaining = maxBytes - bytes;
    if (remaining > 0) {
      chunks.push(chunk.subarray(0, remaining));
      bytes += Math.min(chunk.length, remaining);
    }
    if (bytes >= maxBytes) finish();
  });
  audio.pipe(decoder);
}

async function handleMessage(message) {
  if (!message.guild || message.author.bot) return;
  const command = message.content.trim().toLowerCase();
  if (command !== '!transcription rejoindre' && command !== '!transcription quitter') return;

  const voiceChannel = message.member?.voice.channel;
  const existing = sessions.get(message.guild.id);
  if (command === '!transcription quitter') {
    if (!existing) return message.reply('Aucune transcription en cours.');
    if (!voiceChannel || voiceChannel.id !== existing.voiceChannelId) {
      return message.reply('Vous devez être dans le salon vocal transcrit pour arrêter la transcription.');
    }
    stop(existing);
    return message.reply(`Transcription arrêtée. Le fichier sera envoyé dans ${existing.textChannel} une fois les derniers passages transcrits.`);
  }

  if (!voiceChannel) return message.reply('Rejoignez d’abord un salon vocal.');
  if (existing) return message.reply('Une transcription est déjà en cours sur ce serveur.');

  const connection = joinVoiceChannel({
    channelId: voiceChannel.id,
    guildId: message.guild.id,
    adapterCreator: message.guild.voiceAdapterCreator,
    selfDeaf: false,
  });
  const startedAt = new Date();
  const file = path.join(transcriptsDir, fileName(startedAt, voiceChannel.name));
  const session = {
    guild: message.guild,
    guildId: message.guild.id,
    voiceChannelId: voiceChannel.id,
    textChannel: message.channel,
    connection,
    stopped: false,
    captures: new Map(),
    tasks: new Set(),
    entries: [],
    file: null,
    header: `Transcription du salon vocal « ${voiceChannel.name} » (${message.guild.name})\n`
      + `Début : ${startedAt.toLocaleString('fr-FR')}\n\n`,
  };
  sessions.set(message.guild.id, session);
  connection.on('error', (error) => console.error('Connexion vocale :', error.message));
  connection.on(VoiceConnectionStatus.Disconnected, () => {
    if (stop(session)) {
      void session.textChannel.send('Connexion vocale interrompue ; transcription arrêtée.').catch(() => {});
    }
  });
  try {
    await entersState(connection, VoiceConnectionStatus.Ready, 20000);
    if (session.stopped) return;
    fs.writeFileSync(file, session.header, { flag: 'wx' });
    session.file = file;
    await message.reply('Transcription active. Les propos sont transcrits localement et le fichier texte sera envoyé dans ce salon à la fin de la session ; assurez-vous que tous les participants y consentent.');
    if (session.stopped) return;
    connection.receiver.speaking.on('start', (userId) => captureSpeech(session, userId));
    for (const userId of connection.receiver.speaking.users.keys()) captureSpeech(session, userId);
  } catch (error) {
    stop(session);
    console.error('Démarrage de la transcription impossible :', error.message);
    await message.reply('Impossible de démarrer la transcription.').catch(() => {});
  }
}

client.on(Events.MessageCreate, (message) => {
  void handleMessage(message).catch((error) => console.error('Commande impossible :', error.message));
});

client.once(Events.ClientReady, (readyClient) => {
  console.log(`Connecté en tant que ${readyClient.user.tag}`);
});

async function main() {
  fs.mkdirSync(transcriptsDir, { recursive: true });
  console.log(`Chargement du modèle ${model} (${device})…`);
  transcriber = await loadTranscriber();
  console.log('Modèle de transcription prêt.');
  await client.login(token);
}

main().catch((error) => {
  console.error('Démarrage impossible :', error.message);
  process.exitCode = 1;
});
