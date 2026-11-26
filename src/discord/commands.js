// Commandes « !transcription » envoyées dans un salon textuel : rejoindre, quitter, illustrer.
const { sessions, startSession, stopSession } = require('../session/sessions');
const { startIllustration } = require('../illustration/illustrate');

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
    stopSession(existing);
    return message.reply(`Transcription arrêtée. Le fichier sera envoyé dans ${existing.textChannel} une fois les derniers passages traités.`);
  }

  if (!voiceChannel) return message.reply('Rejoignez d’abord un salon vocal.');
  if (existing) return message.reply('Une transcription est déjà en cours sur ce serveur.');
  return startSession(message, voiceChannel);
}

module.exports = { handleMessage };
