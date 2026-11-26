// Description de la scène par le modèle de langage local (LM Studio) : faut-il illustrer, et avec quel prompt.
const fs = require('node:fs');
const { llmUrl, llmModel, campaignFile } = require('../config');
const { post } = require('./http');

const instructions = `Tu es l'illustrateur d'une partie de jeu de rôle sur table jouée en vocal sur Discord.
On te donne la transcription automatique récente (elle peut contenir des erreurs) et, si disponible, le contexte de la campagne.
Décide si un moment marquant de la fiction mérite une illustration : arrivée dans un lieu, apparition d'une créature ou d'un personnage, action spectaculaire, révélation visuelle.
Ignore tout ce qui est hors-jeu : règles, dés, pauses, blagues, logistique. N'illustre pas à nouveau la dernière scène déjà illustrée.
Réponds en JSON :
- illustrate : true seulement s'il y a un nouveau moment visuel marquant ;
- caption : une phrase en français décrivant la scène, pour la légende ;
- prompt : un prompt en anglais pour Stable Diffusion XL, mots-clés visuels séparés par des virgules (sujet, personnages et apparence, décor, ambiance, lumière, cadrage), sans noms propres.`;

const schema = {
  type: 'object',
  properties: {
    illustrate: { type: 'boolean' },
    caption: { type: 'string' },
    prompt: { type: 'string' },
  },
  required: ['illustrate', 'caption', 'prompt'],
  additionalProperties: false,
};

function readCampaign() {
  try {
    return fs.readFileSync(campaignFile, 'utf8').trim().slice(0, 4000);
  } catch {
    return '';
  }
}

// `request` (même vide) force l'illustration : c'est une demande explicite d'un joueur.
async function describeScene({ transcript, lastCaption, request }) {
  const campaign = readCampaign();
  const parts = [];
  if (campaign) parts.push(`Contexte de la campagne :\n${campaign}`);
  parts.push(`Dernière scène illustrée : ${lastCaption || 'aucune'}.`);
  parts.push(`Transcription récente :\n${transcript || '(vide)'}`);
  if (request !== undefined) {
    parts.push('Un joueur demande une illustration maintenant : mets illustrate à true et illustre le moment le plus '
      + `récent de la fiction${request ? `, en suivant cette indication : ${request}` : ''}.`);
  }
  const body = await post(`${llmUrl}/chat/completions`, {
    model: llmModel,
    messages: [
      { role: 'system', content: instructions },
      { role: 'user', content: parts.join('\n\n') },
    ],
    temperature: 0.3,
    max_tokens: 400,
    // Sans cela, Gemma 4 « réfléchit » des centaines de jetons avant de répondre.
    reasoning_effort: 'none',
    response_format: { type: 'json_schema', json_schema: { name: 'illustration', strict: true, schema } },
  }, 120000);
  const scene = JSON.parse(body.choices[0].message.content);
  return {
    illustrate: scene.illustrate === true || request !== undefined,
    caption: String(scene.caption ?? '').trim(),
    prompt: String(scene.prompt ?? '').trim(),
  };
}

module.exports = { describeScene };
