const test = require('node:test');
const assert = require('node:assert/strict');
const sharp = require('sharp');
const { buildLuckSvg, renderLuckChart } = require('../src/dice/chart');

const player = (name, chance, extra = {}) => ({
  name, count: 4, luck: chance, d20: 0, nat20: 0, nat1: 0, ...extra,
});
const options = (players) => ({ title: 'Chance aux dés — Général, 26/11/2026', subtitle: 'Sous-titre', players });

test('échappe et tronque les noms des joueurs', () => {
  const svg = buildLuckSvg(options([player('<b>Tom & "Léa"</b>', 0.4), player('Un nom vraiment beaucoup trop long pour le graphique', 0.6)]));
  assert.ok(svg.includes('&lt;b&gt;Tom &amp; &quot;Léa&quot;&lt;/b&gt;'));
  assert.ok(!svg.includes('<b>'));
  assert.ok(svg.includes('>Un nom vraiment beaucou…<'));
});

test('affiche les 20 et 1 naturels seulement pour les joueurs qui lancent des d20', () => {
  const svg = buildLuckSvg(options([player('Alice', 0.7, { d20: 3, nat20: 2, nat1: 1 }), player('Bob', 0.5)]));
  assert.ok(svg.includes('4 jets · 2× 20 nat. · 1× 1 nat.'));
  assert.ok(svg.includes('>4 jets<'));
});

test('limite le graphique à 25 joueurs', () => {
  const players = Array.from({ length: 27 }, (_, i) => player(`Joueur ${i}`, i / 26));
  const svg = buildLuckSvg(options(players));
  assert.ok(svg.includes('+ 2 autres joueurs non affichés'));
  assert.ok(!svg.includes('Joueur 26'));
});

test('produit une image PNG nette (2×)', async () => {
  const png = await renderLuckChart(options([player('Alice', 0.64), player('Borin', 0.41)]));
  const { format, width } = await sharp(png).metadata();
  assert.equal(format, 'png');
  assert.equal(width, 2000);
});
