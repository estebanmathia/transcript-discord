// Message de résultat d'un jet : embed coloré selon le palier, ou texte si le bot ne peut pas intégrer de liens.
const { EmbedBuilder, Colors, PermissionFlagsBits } = require('discord.js');
const { formatRoll } = require('./notation');
const { tier } = require('./outcome');

// Pour chaque palier : couleur de l'embed, titre et phrases (« {total} » est remplacé par le total en gras).
const TIERS = {
  critique: {
    color: Colors.Gold,
    title: '🌟 Réussite critique !',
    phrases: ['Un 20 naturel ! Le destin s’incline : {total}.', 'Les astres s’alignent : {total} !', 'Les dés brûlent la table : {total} !'],
  },
  maximum: {
    color: Colors.Gold,
    title: '🌟 Score maximal !',
    phrases: ['Impossible de faire mieux : {total} !', 'Chaque dé donne tout ce qu’il a : {total}.', 'Le maximum, ni plus ni moins : {total} !'],
  },
  excellent: {
    color: Colors.Green,
    title: 'Excellent jet',
    phrases: ['Les dés roulent… et s’arrêtent sur un superbe {total}.', 'La chance est de votre côté : {total}.', 'Un très beau jet : {total}.'],
  },
  bon: {
    color: Colors.Blue,
    title: 'Bon jet',
    phrases: ['Les dés roulent… et s’arrêtent sur {total}.', 'Un jet honnête : {total}.', 'Pas mal du tout : {total}.'],
  },
  mediocre: {
    color: Colors.Orange,
    title: 'Jet médiocre',
    phrases: ['Les dés hésitent… {total}.', 'On a vu mieux : {total}.', 'Bof… {total}.'],
  },
  mauvais: {
    color: Colors.Red,
    title: 'Mauvais jet',
    phrases: ['Les dés vous boudent : {total}.', 'Aïe… {total}.', 'La chance regarde ailleurs : {total}.'],
  },
  minimum: {
    color: Colors.DarkRed,
    title: '💀 Score minimal…',
    phrases: ['Le pire résultat possible : {total}…', 'Tous les dés tombent au plus bas : {total}.', 'Les dés ont décidé de vous trahir : {total}.'],
  },
  echec: {
    color: Colors.DarkRed,
    title: '💀 Échec critique !',
    phrases: ['Un 1 naturel… les dés se moquent de vous : {total}.', 'Catastrophe : {total}.', 'Le destin éclate de rire : {total}.'],
  },
};

// Pas de mention (@everyone dans un motif, par exemple) ni de notification de réponse à chaque jet.
const allowedMentions = { parse: [], repliedUser: false };

// Le bot peut-il afficher des embeds dans ce salon ? (permission « Intégrer des liens »)
function canEmbed(channel) {
  const me = channel.guild?.members.me;
  if (!me || typeof channel.permissionsFor !== 'function') return true;
  return channel.permissionsFor(me)?.has(PermissionFlagsBits.EmbedLinks) ?? true;
}

// Une ligne par terme : « `2d12` → [7, 11] = 18 », « + 2 ». Dés écartés barrés, faces extrêmes en gras.
function detailLines(result) {
  return result.terms.map((term, i) => {
    const sign = term.sign < 0 ? '− ' : i ? '+ ' : '';
    if (!term.faces) return `${sign}${term.value}`;
    const values = term.dice.map((die) => {
      if (!die.kept) return `~~${die.value}~~`;
      return die.value === term.faces || die.value === 1 ? `**${die.value}**` : String(die.value);
    });
    const keptCount = term.dice.filter((die) => die.kept).length;
    const sum = keptCount > 1 ? ` = ${Math.abs(term.subtotal)}` : '';
    const text = `${term.count}d${term.faces}${term.keep ? `${term.keep.mode}${term.keep.count}` : ''}`;
    return `${sign}\`${text}\` → [${values.join(', ')}]${sum}`;
  }).join('\n');
}

// Charge utile de la réponse au joueur. `random()` choisit la phrase (remplaçable pour les tests).
function rollReply({
  result, name, avatarURL, label, canEmbed: embed = true, random = Math.random,
}) {
  const style = TIERS[tier(result)];
  if (!embed) {
    return {
      content: `🎲 ${name}${label ? ` (${label})` : ''} — ${formatRoll(result)} · ${style.title}`,
      allowedMentions,
    };
  }
  const phrase = style.phrases[Math.floor(random() * style.phrases.length)].replace('{total}', `**${result.total}**`);
  const embedBuilder = new EmbedBuilder()
    .setColor(style.color)
    .setAuthor(avatarURL ? { name, iconURL: avatarURL } : { name })
    .setTitle(label ? `${label} — ${style.title}` : style.title)
    .setDescription(`${phrase}\n\n${detailLines(result)}`)
    .addFields({ name: 'Total', value: `**${result.total}**` })
    .setFooter({ text: `${result.notation} · min ${result.min} · max ${result.max}` });
  return { embeds: [embedBuilder], allowedMentions };
}

module.exports = {
  TIERS, allowedMentions, canEmbed, rollReply,
};
