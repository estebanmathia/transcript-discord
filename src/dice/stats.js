// Statistiques de dés d'une séance de transcription : compteurs par joueur et message de fin avec graphique.
const fs = require('node:fs');
const path = require('node:path');
const { EmbedBuilder, Colors } = require('discord.js');
const { transcriptsDir } = require('../config');
const { luck, naturalD20 } = require('./outcome');
const { allowedMentions, canEmbed } = require('./embed');
const { renderLuckChart } = require('./chart');

const MAX_FIELDS = 25; // limite de Discord par embed
const ATTACHMENT = 'statistiques-des.png'; // nom ASCII : « attachment:// » doit correspondre exactement

// Ajoute un jet aux compteurs du joueur (session.dice : identifiant Discord → compteurs).
function recordRoll(session, userId, name, result) {
  let player = session.dice.get(userId);
  if (!player) {
    player = {
      name, count: 0, luckSum: 0, d20: 0, nat20: 0, nat1: 0, best: null,
    };
    session.dice.set(userId, player);
  }
  const value = luck(result);
  const natural = naturalD20(result);
  player.name = name;
  player.count++;
  player.luckSum += value;
  if (natural !== null) player.d20++;
  if (natural === 20) player.nat20++;
  if (natural === 1) player.nat1++;
  if (!player.best || value > player.best.luck) player.best = { notation: result.notation, total: result.total, luck: value };
}

// Joueurs avec leur chance moyenne, du plus chanceux au moins chanceux.
function summarize(session) {
  return [...session.dice.values()]
    .map((player) => ({ ...player, luck: player.luckSum / player.count }))
    .sort((a, b) => b.luck - a.luck || b.count - a.count);
}

function describe(player) {
  const parts = [`${player.count} jet${player.count > 1 ? 's' : ''}`, `chance ${Math.round(player.luck * 100)} %`];
  if (player.d20) parts.push(`${player.nat20}× 20 nat.`, `${player.nat1}× 1 nat.`);
  parts.push(`meilleur : ${player.best.notation} = ${player.best.total}`);
  return parts.join(' · ');
}

const EXPLANATION = 'Chance : position moyenne des jets entre le minimum et le maximum possibles (50 % = résultat moyen attendu).';

// Envoie les statistiques à la fin de la séance (rien si personne n'a lancé de dés) et garde le graphique
// dans le dossier des transcriptions, à côté du fichier de la séance.
async function sendDiceStats(session) {
  if (!session.dice.size) return;
  const players = summarize(session);
  const rolls = players.reduce((sum, player) => sum + player.count, 0);
  const image = await renderLuckChart({
    title: `Chance aux dés — ${session.voiceChannelName}, ${session.startedAt.toLocaleDateString('fr-FR')}`,
    subtitle: 'Position moyenne des jets entre le minimum et le maximum possibles · 50 % = résultat moyen attendu',
    players,
  });
  const file = path.join(transcriptsDir, `${path.basename(session.file, '.txt')}_des.png`);
  try {
    fs.writeFileSync(file, image);
  } catch (error) {
    console.error('Enregistrement du graphique de dés impossible :', error.message);
  }
  const files = [{ attachment: image, name: ATTACHMENT }];
  const heading = `${rolls} jet${rolls > 1 ? 's' : ''} pendant la séance.`;
  if (canEmbed(session.textChannel)) {
    const embed = new EmbedBuilder()
      .setColor(Colors.Blurple)
      .setTitle('🎲 Dés de la séance')
      .setDescription(`${heading}\n${EXPLANATION}`)
      .addFields(players.slice(0, MAX_FIELDS).map((player) => ({ name: player.name, value: describe(player) })))
      .setImage(`attachment://${ATTACHMENT}`);
    await session.textChannel.send({ embeds: [embed], files, allowedMentions });
    return;
  }
  let content = `🎲 Dés de la séance : ${heading}`;
  for (const player of players) {
    const line = `\n${player.name} : ${describe(player)}`;
    if (content.length + line.length > 1900) break;
    content += line;
  }
  await session.textChannel.send({ content, files, allowedMentions });
}

module.exports = { recordRoll, summarize, sendDiceStats };
