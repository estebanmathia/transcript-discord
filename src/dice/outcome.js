// Qualité d'un jet : chance (position dans la plage possible), 20 ou 1 naturel, et palier pour l'affichage.

// 0 = pire résultat possible, 1 = meilleur, 0,5 = résultat moyen attendu pour une somme de dés.
function luck({ total, min, max }) {
  return max === min ? 0.5 : (total - min) / (max - min);
}

// Valeur du d20 quand le jet en garde exactement un, ajouté au total (1d20+5, 2d20kh1, 1d20+1d4) ; sinon null.
function naturalD20(result) {
  const kept = result.terms
    .filter((term) => term.faces === 20)
    .flatMap((term) => term.dice.filter((die) => die.kept).map((die) => ({ value: die.value, sign: term.sign })));
  return kept.length === 1 && kept[0].sign > 0 ? kept[0].value : null;
}

// critique / echec : 20 ou 1 naturel. maximum / minimum : total extrême sans d20 unique. Sinon, par quart de chance.
function tier(result) {
  const natural = naturalD20(result);
  if (natural === 20) return 'critique';
  if (natural === 1) return 'echec';
  if (natural === null && result.max > result.min) {
    if (result.total === result.max) return 'maximum';
    if (result.total === result.min) return 'minimum';
  }
  const value = luck(result);
  if (value >= 0.75) return 'excellent';
  if (value >= 0.5) return 'bon';
  if (value >= 0.25) return 'mediocre';
  return 'mauvais';
}

module.exports = { luck, naturalD20, tier };
