// Commandes envoyées dans un salon textuel : « !transcription » (rejoindre, quitter, illustrer) et « !roll » / « !r ».
const { sessions, startSession, stopSession } = require('../session/sessions');
const { isSpeech } = require('../session/transcript');
const { startIllustration } = require('../illustration/illustrate');
const { handleRoll } = require('./dice-command');

const ROLL_COMMAND = /^!(?:roll|r)(?=\s|$)/i;
const IMAGE_COMMAND = '!transcription image';

function handleImage(message, content, voiceChannel, existing) {
  if (!existing?.file) return message.reply('Aucune transcription en cours.');
  if (!voiceChannel || voiceChannel.id !== existing.voiceChannelId) {
    return message.reply('Vous devez être dans le salon vocal transcrit pour demander une illustration.');
  }
  if (existing.illustrating) return message.reply('Une illustration est déjà en cours, réessayez dans un instant.');
  const request = content.slice(IMAGE_COMMAND.length).trim();
  if (!request && !existing.entries.some(isSpeech)) {
    return message.reply('Rien à illustrer pour l’instant : aucune intervention transcrite.');
  }
  startIllustration(existing, request);
  return message.reply(`Illustration en préparation, elle sera publiée dans ${existing.textChannel}.`);
}

function handleQuit(message, voiceChannel, existing) {
  if (!existing) return message.reply('Aucune transcription en cours.');
  if (!voiceChannel || voiceChannel.id !== existing.voiceChannelId) {
    return message.reply('Vous devez être dans le salon vocal transcrit pour arrêter la transcription.');
  }
  stopSession(existing);
  return message.reply(`Transcription arrêtée. Le fichier sera envoyé dans ${existing.textChannel} une fois les derniers passages traités.`);
}

function handleJoin(message, voiceChannel, existing) {
  if (!voiceChannel) return message.reply('Rejoignez d’abord un salon vocal.');
  if (existing) return message.reply('Une transcription est déjà en cours sur ce serveur.');
  return startSession(message, voiceChannel);
}

async function handleMessage(message) {
  if (!message.guild || message.author.bot) return undefined;
  const content = message.content.trim();
  const roll = ROLL_COMMAND.exec(content);
  if (roll) return handleRoll(message, content.slice(roll[0].length));

  const command = content.toLowerCase();
  const imageCommand = command === IMAGE_COMMAND || command.startsWith(`${IMAGE_COMMAND} `);
  if (!imageCommand && command !== '!transcription rejoindre' && command !== '!transcription quitter') return undefined;

  const voiceChannel = message.member?.voice.channel;
  const existing = sessions.get(message.guild.id);
  if (imageCommand) return handleImage(message, content, voiceChannel, existing);
  if (command === '!transcription quitter') return handleQuit(message, voiceChannel, existing);
  return handleJoin(message, voiceChannel, existing);
}

module.exports = { handleMessage };
