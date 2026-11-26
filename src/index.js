// Point d'entrée : démarre les serveurs locaux, charge Whisper, puis connecte le bot à Discord.
const fs = require('node:fs');
const { token, transcriptsDir, whisperModel, whisperDevice } = require('./config');
const { client } = require('./discord/client');
const { loadTranscriber } = require('./speech/whisper');
const {
  startLmStudio, startImageServer, stopImageServer, checkServices,
} = require('./illustration/servers');

async function main() {
  fs.mkdirSync(transcriptsDir, { recursive: true });
  const services = Promise.all([startLmStudio(), startImageServer()]);
  console.log(`Chargement du modèle ${whisperModel} (${whisperDevice})…`);
  await loadTranscriber();
  console.log('Modèle de transcription prêt.');
  await services;
  const problems = await checkServices();
  for (const problem of problems) console.warn(problem);
  await client.login(token);
}

// SIGHUP : fermeture de la fenêtre de console sous Windows.
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(signal, () => {
    stopImageServer();
    process.exit(0);
  });
}
process.on('exit', stopImageServer);

main().catch((error) => {
  console.error('Démarrage impossible :', error.message);
  stopImageServer();
  process.exitCode = 1;
});
