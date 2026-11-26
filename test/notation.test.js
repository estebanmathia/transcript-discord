const test = require('node:test');
const assert = require('node:assert/strict');
const {
  NotationError, parseRoll, rollDice, formatRoll,
} = require('../src/dice/notation');

// Tirages imposés, dans l'ordre.
const sequence = (...values) => {
  let i = 0;
  return () => values[i++];
};
const roll = (text, ...values) => rollDice(parseRoll(text).expression, sequence(...values));

test('analyse la notation standard', () => {
  assert.equal(parseRoll('2d12+2').expression.notation, '2d12+2');
  assert.equal(parseRoll('').expression.notation, '1d20');
  assert.equal(parseRoll('d20').expression.notation, '1d20');
  assert.equal(parseRoll('d%').expression.notation, '1d100');
  assert.equal(parseRoll('D20 + 1d4 - 2').expression.notation, '1d20+1d4-2');
  assert.equal(parseRoll('-1d4+3').expression.notation, '-1d4+3');
  assert.equal(parseRoll('4d6KH3').expression.notation, '4d6kh3');
  assert.equal(parseRoll('2d20kl1').expression.notation, '2d20kl1');
});

test('le texte après la notation est le motif du jet', () => {
  assert.deepEqual(
    { notation: parseRoll('1d20+5 attaque surprise').expression.notation, label: parseRoll('1d20+5 attaque surprise').label },
    { notation: '1d20+5', label: 'attaque surprise' },
  );
  assert.equal(parseRoll('1d20 dague').label, 'dague');
  assert.equal(parseRoll('1d20 -1 test').expression.notation, '1d20-1');
  assert.equal(parseRoll('1d20 -1 test').label, 'test');
  assert.equal(parseRoll(`1d20 ${'x'.repeat(150)}`).label.length, 100);
});

test('refuse les notations invalides', () => {
  const invalid = ['2d', 'd', 'abc', '2d6x', '1d20+', '5', '0d6', '101d6', '1d1', '1d1001', '3d6kh4', '3d6kh0',
    '4d6kh', '60d6+60d6', '1d20+10001', `1d4${'+1'.repeat(20)}`];
  for (const text of invalid) assert.throws(() => parseRoll(text), NotationError, text);
});

test('calcule le total, le minimum et le maximum', () => {
  const result = roll('2d12+2', 7, 11);
  assert.deepEqual([result.total, result.min, result.max], [20, 4, 26]);
  assert.equal(formatRoll(result), '2d12+2 → [7, 11] + 2 = 20');
});

test('garde les dés les plus hauts ou les plus bas', () => {
  const advantage = roll('2d20kh1', 3, 17);
  assert.deepEqual([advantage.total, advantage.min, advantage.max], [17, 1, 20]);
  assert.deepEqual(advantage.terms[0].dice.map((die) => die.kept), [false, true]);
  assert.equal(formatRoll(advantage), '2d20kh1 → [(3), 17] = 17');
  assert.equal(roll('2d20kl1', 3, 17).total, 3);
  assert.equal(roll('4d6kh3', 6, 1, 6, 3).total, 15);
  assert.deepEqual(roll('2d20kh1', 12, 12).terms[0].dice.map((die) => die.kept), [true, false]);
});

test('soustrait les termes négatifs', () => {
  const result = roll('1d6-1d4', 2, 4);
  assert.deepEqual([result.total, result.min, result.max], [-2, -3, 5]);
  assert.equal(formatRoll(result), '1d6-1d4 → [2] - [4] = -2');
  assert.equal(formatRoll(roll('-1d4+3', 2)), '-1d4+3 → -[2] + 3 = 1');
});

test('le tirage par défaut reste entre 1 et le nombre de faces', () => {
  const result = rollDice(parseRoll('100d6').expression);
  const values = result.terms[0].dice.map((die) => die.value);
  assert.equal(values.length, 100);
  assert.ok(values.every((value) => Number.isInteger(value) && value >= 1 && value <= 6));
});
