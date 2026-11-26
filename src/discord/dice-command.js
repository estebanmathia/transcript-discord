// Commande « !roll » / « !r » : lance les dés, répond avec le résultat et l'ajoute à la séance en cours.
const { sessions } = require('../session/sessions');
const { addEntry } = require('../session/transcript');
const {
  NotationError, parseRoll, rollDice, formatRoll,
} = require('../dice/notation');
const { allowedMentions, canEmbed, rollReply } = require('../dice/embed');
const { recordRoll } = require('../dice/stats');

const EXAMPLES = 'Exemples : `!roll 1d20+5`, `!roll 2d12+2 dégâts`, `!roll 2d20kh1` (avantage), '
  + '`!roll 2d20kl1` (désavantage), `!roll 4d6kh3`.';

async function handleRoll(message, args) {
  let parsed;
  try {
    parsed = parseRoll(args);
  } catch (error) {
    if (!(error instanceof NotationError)) throw error;
    return message.reply({ content: `Notation invalide : ${error.message}. ${EXAMPLES}`, allowedMentions });
  }
  const result = rollDice(parsed.expression);
  const name = message.member?.displayName ?? message.author.username;

  // Pendant une transcription, le jet compte pour les statistiques et apparaît dans le fichier.
  const session = sessions.get(message.guild.id);
  if (session?.file && !session.stopped) {
    recordRoll(session, message.author.id, name, result);
    addEntry(session, {
      startedAt: new Date(),
      speaker: 'Dés',
      text: `${name} lance ${formatRoll(result)}${parsed.label ? ` (${parsed.label})` : ''}`,
      roll: true,
    });
  }

  return message.reply(rollReply({
    result,
    name,
    avatarURL: (message.member ?? message.author).displayAvatarURL?.(),
    label: parsed.label,
    canEmbed: canEmbed(message.channel),
  }));
}

module.exports = { handleRoll };
