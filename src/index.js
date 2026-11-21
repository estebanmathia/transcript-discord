const { Client, GatewayIntentBits, Events } = require('discord.js');
const {
  joinVoiceChannel, entersState, VoiceConnectionStatus, EndBehaviorType,
} = require('@discordjs/voice');
const prism = require('prism-media');

const token = process.env.DISCORD_TOKEN;
const apiKey = process.env.OPENAI_API_KEY;
if (!token || !apiKey) {
  console.error('Définissez DISCORD_TOKEN et OPENAI_API_KEY avant de démarrer le bot.');
  process.exit(1);
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildVoiceStates,
  ],
});
const sessions = new Map();
const maxBytes = 48000 * 2 * 2 * 60;

function wav(pcm) {
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write('WAVEfmt ', 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(2, 22);
  header.writeUInt32LE(48000, 24);
  header.writeUInt32LE(48000 * 2 * 2, 28);
  header.writeUInt16LE(4, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

function stop(session) {
  if (sessions.get(session.guildId) !== session) return;
  sessions.delete(session.guildId);
  session.controller.abort();
  for (const capture of session.captures.values()) capture.cancel();
  session.connection.destroy();
}

async function transcribe(session, userId, pcm) {
  if (!pcm.length || session.controller.signal.aborted) return;
  const form = new FormData();
  form.append('model', 'whisper-1');
  form.append('file', new Blob([wav(pcm)], { type: 'audio/wav' }), 'audio.wav');
  try {
    const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: ['Bearer', apiKey].join(' ') },
      body: form,
      signal: AbortSignal.any([session.controller.signal, AbortSignal.timeout(60000)]),
    });
    if (!response.ok) throw new Error(`API de transcription : HTTP ${response.status}`);
    const { text } = await response.json();
    if (session.controller.signal.aborted || typeof text !== 'string' || !text.trim()) return;
    const prefix = `<@${userId}> : `;
    for (let i = 0; i < text.length; i += 1900) {
      if (session.controller.signal.aborted) break;
      await session.textChannel.send({
        content: prefix + text.slice(i, i + 1900),
        allowedMentions: { parse: [] },
      });
    }
  } catch (error) {
    if (!session.controller.signal.aborted) {
      console.error('Transcription impossible :', error.message);
      await session.textChannel.send('Une transcription a échoué. Vérifiez les journaux du bot.').catch(() => {});
    }
  }
}

function captureSpeech(session, userId) {
  if (session.controller.signal.aborted || session.captures.has(userId)) return;
  const audio = session.connection.receiver.subscribe(userId, {
    end: { behavior: EndBehaviorType.AfterSilence, duration: 1000 },
  });
  const decoder = new prism.opus.Decoder({ rate: 48000, channels: 2, frameSize: 960 });
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

  session.captures.set(userId, { cancel });
  audio.once('close', () => {
    session.captures.delete(userId);
    if (restart && !session.controller.signal.aborted &&
        session.connection.receiver.speaking.users.has(userId)) {
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
  decoder.on('end', () => void transcribe(session, userId, Buffer.concat(chunks)));
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
    return message.reply('Transcription arrêtée.');
  }

  if (!voiceChannel) return message.reply('Rejoignez d’abord un salon vocal.');
  if (existing) return message.reply('Une transcription est déjà en cours sur ce serveur.');

  const connection = joinVoiceChannel({
    channelId: voiceChannel.id,
    guildId: message.guild.id,
    adapterCreator: message.guild.voiceAdapterCreator,
    selfDeaf: false,
  });
  const session = {
    guildId: message.guild.id,
    voiceChannelId: voiceChannel.id,
    textChannel: message.channel,
    connection,
    controller: new AbortController(),
    captures: new Map(),
  };
  sessions.set(message.guild.id, session);
  connection.on('error', (error) => console.error('Connexion vocale :', error.message));
  connection.on(VoiceConnectionStatus.Disconnected, () => {
    if (sessions.get(session.guildId) === session) {
      stop(session);
      void session.textChannel.send('Connexion vocale interrompue ; transcription arrêtée.').catch(() => {});
    }
  });
  try {
    await entersState(connection, VoiceConnectionStatus.Ready, 20000);
    if (session.controller.signal.aborted) return;
    await message.reply('Transcription active dans ce salon. Les propos sont envoyés à OpenAI ; assurez-vous que tous les participants y consentent.');
    if (session.controller.signal.aborted) return;
    connection.receiver.speaking.on('start', (userId) => captureSpeech(session, userId));
    for (const userId of connection.receiver.speaking.users.keys()) captureSpeech(session, userId);
  } catch (error) {
    stop(session);
    console.error('Connexion vocale impossible :', error.message);
    await message.reply('Impossible de démarrer la transcription.').catch(() => {});
  }
}

client.on(Events.MessageCreate, (message) => {
  void handleMessage(message).catch((error) => console.error('Commande impossible :', error.message));
});

client.once(Events.ClientReady, (readyClient) => {
  console.log(`Connecté en tant que ${readyClient.user.tag}`);
});

client.login(token).catch((error) => {
  console.error('Connexion Discord impossible :', error.message);
  process.exitCode = 1;
});
