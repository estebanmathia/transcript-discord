const test = require('node:test');
const assert = require('node:assert/strict');
const { Colors } = require('discord.js');
const { parseRoll, rollDice } = require('../src/dice/notation');
const { canEmbed, rollReply } = require('../src/dice/embed');

const roll = (text, ...values) => {
  let i = 0;
  return rollDice(parseRoll(text).expression, () => values[i++]);
};

test('embed d’une réussite critique', () => {
  const reply = rollReply({
    result: roll('2d20kh1+5', 4, 20), name: 'Alice', avatarURL: 'https://cdn.example/a.png', label: 'Attaque', random: () => 0,
  });
  const embed = reply.embeds[0].toJSON();
  assert.equal(embed.color, Colors.Gold);
  assert.equal(embed.title, 'Attaque — 🌟 Réussite critique !');
  assert.deepEqual([embed.author.name, embed.author.icon_url], ['Alice', 'https://cdn.example/a.png']);
  assert.equal(embed.description, 'Un 20 naturel ! Le destin s’incline : **25**.\n\n`2d20kh1` → [~~4~~, **20**]\n+ 5');
  assert.deepEqual(embed.fields, [{ name: 'Total', value: '**25**' }]);
  assert.equal(embed.footer.text, '2d20kh1+5 · min 6 · max 25');
  assert.deepEqual(reply.allowedMentions, { parse: [], repliedUser: false });
});

test('la couleur suit le résultat', () => {
  const color = (result) => rollReply({ result, name: 'Bob' }).embeds[0].toJSON().color;
  assert.equal(color(roll('1d20', 1)), Colors.DarkRed);
  assert.equal(color(roll('1d20', 3)), Colors.Red);
  assert.equal(color(roll('1d20', 8)), Colors.Orange);
  assert.equal(color(roll('1d20', 11)), Colors.Blue);
  assert.equal(color(roll('1d20', 16)), Colors.Green);
  assert.equal(color(roll('3d6', 6, 6, 6)), Colors.Gold);
});

test('détail d’une somme de plusieurs dés', () => {
  const embed = rollReply({ result: roll('2d12-1d4+2', 7, 11, 3), name: 'Bob', random: () => 0 }).embeds[0].toJSON();
  assert.match(embed.description, /\n\n`2d12` → \[7, 11\] = 18\n− `1d4` → \[3\]\n\+ 2$/);
});

test('repli en texte sans la permission « Intégrer des liens »', () => {
  const reply = rollReply({
    result: roll('2d12+2', 7, 11), name: 'Alice', label: 'dégâts', canEmbed: false,
  });
  assert.equal(reply.content, '🎲 Alice (dégâts) — 2d12+2 → [7, 11] + 2 = 20 · Bon jet');
  assert.equal(reply.embeds, undefined);
});

test('canEmbed lit la permission du bot dans le salon', () => {
  const channel = (allowed) => ({
    guild: { members: { me: {} } },
    permissionsFor: () => ({ has: () => allowed }),
  });
  assert.equal(canEmbed(channel(true)), true);
  assert.equal(canEmbed(channel(false)), false);
  assert.equal(canEmbed({}), true);
});
