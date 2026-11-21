const { execFile, execFileSync, spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { setTimeout: sleep } = require('node:timers/promises');
const { promisify } = require('node:util');

const run = promisify(execFile);
const llmUrl = (process.env.LLM_URL || 'http://127.0.0.1:1234/v1').replace(/\/+$/, '');
const llmModel = process.env.LLM_MODEL || 'google/gemma-4-e4b';
const llmGpu = process.env.LLM_GPU || 'off';
const sdUrl = (process.env.SD_URL || 'http://127.0.0.1:7860').replace(/\/+$/, '');
const sdServer = process.env.SD_SERVER;
const style = process.env.IMAGE_STYLE || 'fantasy illustration, digital painting, dramatic lighting, highly detailed';
const campaignFile = path.resolve(__dirname, '..', process.env.CAMPAIGN_FILE || 'campagne.txt');
const negativePrompt = 'blurry, low quality, deformed, disfigured, extra limbs, text, watermark, signature';
let imageServer = null;

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

async function post(url, body, timeout) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeout),
  });
  if (!response.ok) throw new Error(`${url} : HTTP ${response.status} ${(await response.text()).slice(0, 200)}`);
  return response.json();
}

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

async function generateImage(prompt) {
  const body = await post(`${sdUrl}/sdapi/v1/txt2img`, {
    prompt: `${prompt}, ${style}`,
    negative_prompt: negativePrompt,
  }, 600000);
  return Buffer.from(body.images[0], 'base64');
}

async function loadedInstances() {
  const response = await fetch(new URL('/api/v1/models', llmUrl), { signal: AbortSignal.timeout(3000) });
  const { models } = await response.json();
  return models.find((entry) => entry.key === llmModel)?.loaded_instances.length;
}

// Démarre le serveur LM Studio local et y charge le modèle, sauf s'il l'est déjà (sinon LM Studio en charge une copie).
async function startLmStudio() {
  const { hostname, port } = new URL(llmUrl);
  if (hostname !== '127.0.0.1' && hostname !== 'localhost') return;
  const bundled = path.join(os.homedir(), '.lmstudio', 'bin', process.platform === 'win32' ? 'lms.exe' : 'lms');
  const lms = fs.existsSync(bundled) ? bundled : 'lms';
  try {
    await run(lms, ['server', 'start', '--port', port || '1234'], { timeout: 120000 });
    if (await loadedInstances() !== 0) return;
    console.log(`Chargement de ${llmModel} dans LM Studio (GPU : ${llmGpu})…`);
    await run(lms, ['load', llmModel, '--gpu', llmGpu, '--yes'], { timeout: 600000 });
    console.log(`${llmModel} chargé dans LM Studio.`);
  } catch (error) {
    const detail = error.code === 'ENOENT' ? 'commande lms introuvable' : `${error.stderr || error.message}`.trim().split('\n').pop();
    console.warn(`Démarrage de LM Studio impossible : ${detail}`);
  }
}

async function imageServerUp(timeout) {
  try {
    return (await fetch(`${sdUrl}/sdapi/v1/sd-models`, { signal: AbortSignal.timeout(timeout) })).ok;
  } catch {
    return false;
  }
}

// Lance le script SD_SERVER, sauf si un serveur d'images répond déjà : stopImageServer() n'arrête que celui-ci.
async function startImageServer() {
  if (!sdServer || await imageServerUp(2000)) return;
  if (!fs.existsSync(sdServer)) {
    console.warn(`Serveur d'images introuvable : ${sdServer}`);
    return;
  }
  console.log(`Démarrage du serveur d'images (${sdServer})…`);
  const windows = process.platform === 'win32';
  // Détaché : un Ctrl+C dans la console du bot ne l'interrompt pas, c'est le bot qui l'arrête.
  const child = spawn(windows ? 'cmd.exe' : 'sh', windows ? ['/d', '/c', sdServer] : [sdServer], {
    cwd: path.dirname(sdServer),
    detached: true,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const output = [];
  const keep = (chunk) => {
    output.push(...chunk.toString().split(/\r?\n/).filter(Boolean));
    output.splice(0, output.length - 20);
  };
  child.stdout.on('data', keep);
  child.stderr.on('data', keep);
  child.on('error', (error) => {
    if (imageServer === child) imageServer = null;
    console.warn(`Démarrage du serveur d'images impossible : ${error.message}`);
  });
  child.on('exit', (code) => {
    if (imageServer !== child) return;
    imageServer = null;
    console.warn(`Le serveur d'images s'est arrêté (code ${code}) :\n${output.join('\n')}`);
  });
  imageServer = child;
  for (let attempt = 0; attempt < 120 && imageServer === child; attempt++) {
    if (await imageServerUp(2000)) {
      console.log('Serveur d\'images prêt.');
      return;
    }
    await sleep(1000);
  }
}

function stopImageServer() {
  const child = imageServer;
  if (!child) return;
  imageServer = null;
  try {
    if (process.platform === 'win32') execFileSync('taskkill', ['/pid', String(child.pid), '/t', '/f'], { stdio: 'ignore' });
    else process.kill(-child.pid, 'SIGTERM');
  } catch {
    // Déjà arrêté.
  }
}

async function checkServices() {
  const problems = [];
  try {
    const response = await fetch(`${llmUrl}/models`, { signal: AbortSignal.timeout(3000) });
    const { data } = await response.json();
    if (!data.some((entry) => entry.id === llmModel)) problems.push(`Illustrations indisponibles : modèle ${llmModel} absent de LM Studio.`);
  } catch (error) {
    problems.push(`Illustrations indisponibles : LM Studio injoignable (${llmUrl}) : ${error.message}`);
  }
  try {
    if (await loadedInstances() === 0) {
      problems.push(`${llmModel} n'est pas chargé : LM Studio le chargera sur la carte graphique à la première illustration. `
        + `Pour la laisser à Whisper et Stable Diffusion, chargez-le sur le processeur : lms load ${llmModel} --gpu off`);
    }
  } catch {
    // API propre à LM Studio : absente des autres serveurs compatibles OpenAI.
  }
  try {
    const response = await fetch(`${sdUrl}/sdapi/v1/sd-models`, { signal: AbortSignal.timeout(3000) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
  } catch (error) {
    problems.push(`Illustrations indisponibles : serveur d’images injoignable (${sdUrl}) : ${error.message}`);
  }
  return problems;
}

module.exports = {
  describeScene, generateImage, startLmStudio, startImageServer, stopImageServer, checkServices,
};
