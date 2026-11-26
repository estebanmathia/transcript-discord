// Serveurs locaux des illustrations : lancement de LM Studio et du serveur d'images, arrêt et vérification.
const { execFile, execFileSync, spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { setTimeout: sleep } = require('node:timers/promises');
const { promisify } = require('node:util');
const {
  llmUrl, llmModel, llmGpu, sdUrl, sdServer,
} = require('../config');

const run = promisify(execFile);
let imageServer = null;

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

// Vérifie les serveurs au démarrage et renvoie la liste des problèmes à signaler.
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
  startLmStudio, startImageServer, stopImageServer, checkServices,
};
