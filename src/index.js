require('dotenv').config();
const fs = require('node:fs');
const path = require('node:path');
const { setTimeout: sleep } = require('node:timers/promises');
const { Client, GatewayIntentBits, Events } = require('discord.js');
const {
  joinVoiceChannel, entersState, VoiceConnectionStatus, EndBehaviorType,
} = require('@discordjs/voice');
const prism = require('prism-media');
const { pipeline, env } = require('@huggingface/transformers');
const {
  describeScene, generateImage, startLmStudio, startImageServer, stopImageServer, checkServices,
} = require('./illustration');

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

function addEntry(session, entry) {
  session.entries.push(entry);
  try {
    fs.appendFileSync(session.file, formatEntry(entry));
  } catch (error) {
    console.error('Écriture de la transcription impossible :', error.message);
  }
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
  addEntry(session, { startedAt, speaker: member?.displayName ?? userId, text });
  maybeIllustrate(session);
}

function recentTranscript(session, since) {
  const lines = session.entries
    .filter((entry) => !entry.image && entry.startedAt >= since)
    .sort((a, b) => a.startedAt - b.startedAt)
    .map(formatEntry);
  let text = '';
  for (let i = lines.length - 1; i >= 0 && text.length + lines[i].length <= 4000; i--) text = lines[i] + text;
  return text;
}

async function illustrate(session, request) {
  const since = request === undefined ? session.lastImageAt : 0;
  const scene = await describeScene({
    transcript: recentTranscript(session, since), lastCaption: session.lastCaption, request,
  });
  if (!scene.illustrate) return;
  if (!scene.prompt) throw new Error('le modèle n’a pas décrit la scène');
  const image = await generateImage(scene.prompt);
  const at = new Date();
  const caption = scene.caption || 'Illustration';
  const name = `${path.basename(session.file, '.txt')}_${pad(at.getHours())}-${pad(at.getMinutes())}-${pad(at.getSeconds())}.png`;
  fs.writeFileSync(path.join(transcriptsDir, name), image);
  session.lastImageAt = at.getTime();
  session.lastCaption = caption;
  addEntry(session, { startedAt: at, speaker: 'Illustration', text: `${caption} (${name})`, image: true });
  await session.textChannel.send({ content: `🎨 ${caption}`, files: [{ attachment: image, name }] });
}

function startIllustration(session, request) {
  const task = illustrate(session, request)
    .catch((error) => {
      console.error('Illustration impossible :', error.message);
      if (request === undefined) return undefined;
      return session.textChannel.send('L’illustration a échoué. Vérifiez que LM Studio et le serveur d’images sont lancés.')
        .catch(() => {});
    })
    .finally(() => {
      session.illustrating = null;
    });
  session.illustrating = task;
  session.tasks.add(task);
  void task.then(() => session.tasks.delete(task));
}

function maybeIllustrate(session) {
  const now = Date.now();
  if (!autoImageMinutes || session.stopped || session.illustrating) return;
  if (now - session.lastImageAt < autoImageMinutes * 60000 || now - session.lastCheckAt < 60000) return;
  session.lastCheckAt = now;
  startIllustration(session);
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
  const content = message.content.trim();
  const command = content.toLowerCase();
  const imageCommand = command === '!transcription image' || command.startsWith('!transcription image ');
  if (!imageCommand && command !== '!transcription rejoindre' && command !== '!transcription quitter') return;

  const voiceChannel = message.member?.voice.channel;
  const existing = sessions.get(message.guild.id);
  if (imageCommand) {
    if (!existing?.file) return message.reply('Aucune transcription en cours.');
    if (!voiceChannel || voiceChannel.id !== existing.voiceChannelId) {
      return message.reply('Vous devez être dans le salon vocal transcrit pour demander une illustration.');
    }
    if (existing.illustrating) return message.reply('Une illustration est déjà en cours, réessayez dans un instant.');
    const request = content.slice('!transcription image'.length).trim();
    if (!request && !existing.entries.some((entry) => !entry.image)) {
      return message.reply('Rien à illustrer pour l’instant : aucune intervention transcrite.');
    }
    startIllustration(existing, request);
    return message.reply(`Illustration en préparation, elle sera publiée dans ${existing.textChannel}.`);
  }
  if (command === '!transcription quitter') {
    if (!existing) return message.reply('Aucune transcription en cours.');
    if (!voiceChannel || voiceChannel.id !== existing.voiceChannelId) {
      return message.reply('Vous devez être dans le salon vocal transcrit pour arrêter la transcription.');
    }
    stop(existing);
    return message.reply(`Transcription arrêtée. Le fichier sera envoyé dans ${existing.textChannel} une fois les derniers passages traités.`);
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
    illustrating: null,
    lastImageAt: 0,
    lastCheckAt: 0,
    lastCaption: '',
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
    await message.reply('Transcription active. Les propos sont transcrits localement et le fichier texte sera envoyé dans ce salon à la fin de la session ; assurez-vous que tous les participants y consentent. '
      + `Envoyez \`!transcription image\` pour illustrer la scène en cours${autoImageMinutes ? ' ; les moments forts sont aussi illustrés automatiquement' : ''}.`);
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
  const services = Promise.all([startLmStudio(), startImageServer()]);
  console.log(`Chargement du modèle ${model} (${device})…`);
  transcriber = await loadTranscriber();
  console.log('Modèle de transcription prêt.');
  await services;
  const problems = await checkServices();
  for (const problem of problems) console.warn(problem);
  await client.login(token);
}

// SIGHUP : fermeture de la fenêtre de console sous Windows.
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(signal, () => {
    stopImageServer();
    process.exit(0);
  });
}
process.on('exit', stopImageServer);

main().catch((error) => {
  console.error('Démarrage impossible :', error.message);
  stopImageServer();
  process.exitCode = 1;
});
