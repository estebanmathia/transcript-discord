// Sessions de transcription, une par serveur : démarrer, arrêter et sauvegarder la transcription.
const fs = require('node:fs');
const path = require('node:path');
const {
  joinVoiceChannel, entersState, VoiceConnectionStatus,
} = require('@discordjs/voice');
const { transcriptsDir, autoImageMinutes } = require('../config');
const { fileName, formatEntry } = require('./transcript');
const { captureSpeech } = require('./capture');

// Sessions actives, indexées par identifiant de serveur.
const sessions = new Map();

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

// Arrête la session : plus de nouvelles interventions, puis sauvegarde après les passages en cours.
function stopSession(session) {
  if (sessions.get(session.guildId) !== session) return false;
  sessions.delete(session.guildId);
  session.stopped = true;
  for (const capture of session.captures.values()) capture.finish();
  void saveTranscript(session);
  session.connection.destroy();
  return true;
}

// Démarre une session après « !transcription rejoindre » (le salon vocal a déjà été vérifié).
async function startSession(message, voiceChannel) {
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
    if (stopSession(session)) {
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
    stopSession(session);
    console.error('Démarrage de la transcription impossible :', error.message);
    await message.reply('Impossible de démarrer la transcription.').catch(() => {});
  }
}

module.exports = { sessions, startSession, stopSession };
