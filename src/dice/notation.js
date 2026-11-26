// Notation des dés (« 2d12+2 », « 2d20kh1 », « d% ») : analyse, tirage et texte du résultat.
const { randomInt } = require('node:crypto');

const LIMITS = {
  count: 100, faces: 1000, dice: 100, terms: 20, constant: 10000, label: 100,
};

// Erreur de saisie du joueur : son message lui est renvoyé tel quel.
class NotationError extends Error {}

// Un terme : des dés (« 2d12 », « d20 », « d% », « 4d6kh3 ») ou un nombre (« 5 »).
const TERM = /^(?:(\d*)d(\d+|%)(?:(kh|kl)(\d+))?|(\d+))/i;
const OPERATOR = /^\s*([+-])\s*/;

function diceTerm(match, sign) {
  const count = match[1] ? Number(match[1]) : 1;
  const faces = match[2] === '%' ? 100 : Number(match[2]);
  if (count < 1 || count > LIMITS.count) throw new NotationError(`de 1 à ${LIMITS.count} dés par terme`);
  if (faces < 2 || faces > LIMITS.faces) throw new NotationError(`des dés de 2 à ${LIMITS.faces} faces`);
  let keep = null;
  if (match[3]) {
    const kept = Number(match[4]);
    if (kept < 1 || kept > count) {
      throw new NotationError(`« ${match[3]}${match[4]} » doit garder entre 1 et ${count} dé${count > 1 ? 's' : ''}`);
    }
    keep = { mode: match[3].toLowerCase(), count: kept };
  }
  return {
    sign, count, faces, keep,
  };
}

function constantTerm(match, sign) {
  const value = Number(match[5]);
  if (value > LIMITS.constant) throw new NotationError(`des nombres jusqu’à ${LIMITS.constant}`);
  return { sign, value };
}

const termText = (term) => (term.faces
  ? `${term.count}d${term.faces}${term.keep ? `${term.keep.mode}${term.keep.count}` : ''}`
  : String(term.value));

// Analyse le texte après « !roll ». Vide : 1d20. Le texte qui suit la notation est le motif du jet.
function parseRoll(text) {
  let rest = text.trim() || '1d20';
  const terms = [];
  let sign = 1;
  const leading = OPERATOR.exec(rest);
  if (leading) {
    sign = leading[1] === '-' ? -1 : 1;
    rest = rest.slice(leading[0].length);
  }
  for (;;) {
    const match = TERM.exec(rest);
    if (!match) {
      throw new NotationError(terms.length
        ? 'un dé ou un nombre est attendu après « + » ou « - »'
        : 'la notation doit commencer par un dé, par exemple « 1d20 » ou « 2d6+3 »');
    }
    rest = rest.slice(match[0].length);
    if (rest && !/^[\s+-]/.test(rest)) throw new NotationError(`« ${match[0]}${rest.split(/[\s+-]/)[0]} » n’est pas compris`);
    terms.push(match[5] === undefined ? diceTerm(match, sign) : constantTerm(match, sign));
    const operator = OPERATOR.exec(rest);
    if (!operator) break;
    sign = operator[1] === '-' ? -1 : 1;
    rest = rest.slice(operator[0].length);
  }

  const dice = terms.reduce((sum, term) => sum + (term.count ?? 0), 0);
  if (!dice) throw new NotationError('il faut au moins un dé, par exemple « 1d20+5 »');
  if (dice > LIMITS.dice) throw new NotationError(`${LIMITS.dice} dés au plus par lancer`);
  if (terms.length > LIMITS.terms) throw new NotationError(`${LIMITS.terms} termes au plus`);
  const notation = terms.map((term, i) => `${term.sign < 0 ? '-' : i ? '+' : ''}${termText(term)}`).join('');
  return { expression: { notation, terms }, label: rest.trim().slice(0, LIMITS.label) };
}

// Indices des dés gardés : tous, ou les plus hauts (kh) / plus bas (kl), à égalité le premier lancé.
function keptIndexes(values, keep) {
  const indexes = values.map((_, i) => i);
  if (!keep) return new Set(indexes);
  const order = keep.mode === 'kh' ? (a, b) => values[b] - values[a] : (a, b) => values[a] - values[b];
  return new Set(indexes.sort((a, b) => order(a, b) || a - b).slice(0, keep.count));
}

const defaultRng = (faces) => randomInt(1, faces + 1);

// Lance les dés. `rng(faces)` renvoie un entier de 1 à faces (remplaçable pour les tests).
function rollDice(expression, rng = defaultRng) {
  let total = 0;
  let min = 0;
  let max = 0;
  const terms = expression.terms.map((term) => {
    if (!term.faces) {
      const value = term.sign * term.value;
      total += value;
      min += value;
      max += value;
      return { ...term, subtotal: value };
    }
    const values = Array.from({ length: term.count }, () => rng(term.faces));
    const kept = keptIndexes(values, term.keep);
    const dice = values.map((value, i) => ({ value, kept: kept.has(i) }));
    const sum = dice.reduce((acc, die) => acc + (die.kept ? die.value : 0), 0);
    const keptCount = term.keep ? term.keep.count : term.count;
    total += term.sign * sum;
    if (term.sign > 0) {
      min += keptCount;
      max += keptCount * term.faces;
    } else {
      min -= keptCount * term.faces;
      max -= keptCount;
    }
    return { ...term, dice, subtotal: term.sign * sum };
  });
  return {
    notation: expression.notation, terms, total, min, max,
  };
}

// Texte brut du résultat, par exemple « 2d12+2 → [7, 11] + 2 = 20 » (dés écartés entre parenthèses).
function formatRoll(result) {
  const parts = result.terms.map((term, i) => {
    const text = term.faces
      ? `[${term.dice.map((die) => (die.kept ? String(die.value) : `(${die.value})`)).join(', ')}]`
      : String(term.value);
    if (term.sign < 0) return i ? ` - ${text}` : `-${text}`;
    return i ? ` + ${text}` : text;
  });
  return `${result.notation} → ${parts.join('')} = ${result.total}`;
}

module.exports = {
  LIMITS, NotationError, parseRoll, rollDice, formatRoll,
};
