const test = require('node:test');
const assert = require('node:assert/strict');
const { parseRoll, rollDice } = require('../src/dice/notation');
const { luck, naturalD20, tier } = require('../src/dice/outcome');

const roll = (text, ...values) => {
  let i = 0;
  return rollDice(parseRoll(text).expression, () => values[i++]);
};

test('20 et 1 naturels quand le jet garde un seul d20', () => {
  assert.equal(tier(roll('1d20+5', 20)), 'critique');
  assert.equal(tier(roll('1d20+5', 1)), 'echec');
  assert.equal(tier(roll('1d20+1d4', 20, 1)), 'critique');
  assert.equal(tier(roll('2d20kh1', 1, 20)), 'critique');
  assert.equal(tier(roll('2d20kl1', 1, 20)), 'echec');
  assert.equal(naturalD20(roll('2d20', 20, 20)), null);
  assert.equal(naturalD20(roll('-1d20+30', 20)), null);
});

test('total extrême sans d20 unique : maximum ou minimum', () => {
  assert.equal(tier(roll('2d6', 6, 6)), 'maximum');
  assert.equal(tier(roll('2d6', 1, 1)), 'minimum');
  assert.equal(tier(roll('2d20', 20, 20)), 'maximum');
  assert.equal(tier(roll('-1d20+30', 20)), 'minimum');
});

test('sinon, palier selon la chance', () => {
  assert.equal(tier(roll('2d6', 6, 5)), 'excellent');
  assert.equal(tier(roll('1d20', 16)), 'excellent');
  assert.equal(tier(roll('1d20', 11)), 'bon');
  assert.equal(tier(roll('1d20', 8)), 'mediocre');
  assert.equal(tier(roll('1d20', 3)), 'mauvais');
});

test('la chance est la position du total dans sa plage', () => {
  assert.equal(luck(roll('2d12+2', 7, 11)), 16 / 22);
  assert.equal(luck(roll('1d20', 1)), 0);
  assert.equal(luck(roll('1d20', 20)), 1);
  assert.equal(luck({ total: 3, min: 3, max: 3 }), 0.5);
});
