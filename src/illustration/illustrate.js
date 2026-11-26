// Illustrations : décider quand illustrer (automatiquement ou sur demande) et publier l'image dans le salon.
const fs = require('node:fs');
const path = require('node:path');
const { transcriptsDir, autoImageMinutes } = require('../config');
const { addEntry, recentTranscript, pad } = require('../session/transcript');
const { describeScene } = require('./scene');
const { generateImage } = require('./image');

async function illustrate(session, request) {
  const since = request === undefined ? session.lastImageAt : 0;
  const scene = await describeScene({
    transcript: recentTranscript(session, since), lastCaption: session.lastCaption, request,
  });
  if (!scene.illustrate) return;
  if (!scene.prompt) throw new Error('le modèle n’a pas décrit la scène');
  const image = await generateImage(scene.prompt);
  const at = new Date();
  const caption = scene.caption || 'Illustration';
  const name = `${path.basename(session.file, '.txt')}_${pad(at.getHours())}-${pad(at.getMinutes())}-${pad(at.getSeconds())}.png`;
  fs.writeFileSync(path.join(transcriptsDir, name), image);
  session.lastImageAt = at.getTime();
  session.lastCaption = caption;
  addEntry(session, { startedAt: at, speaker: 'Illustration', text: `${caption} (${name})`, image: true });
  await session.textChannel.send({ content: `🎨 ${caption}`, files: [{ attachment: image, name }] });
}

// Lance une illustration en arrière-plan. Sans `request` (illustration automatique), une erreur n'est que journalisée.
function startIllustration(session, request) {
  const task = illustrate(session, request)
    .catch((error) => {
      console.error('Illustration impossible :', error.message);
      if (request === undefined) return undefined;
      return session.textChannel.send('L’illustration a échoué. Vérifiez que LM Studio et le serveur d’images sont lancés.')
        .catch(() => {});
    })
    .finally(() => {
      session.illustrating = null;
    });
  session.illustrating = task;
  session.tasks.add(task);
  void task.then(() => session.tasks.delete(task));
}

// Appelée après chaque intervention. Vérifie au plus une fois par minute s'il faut illustrer,
// avec au moins AUTO_IMAGE_MINUTES minutes entre deux images automatiques.
function maybeIllustrate(session) {
  const now = Date.now();
  if (!autoImageMinutes || session.stopped || session.illustrating) return;
  if (now - session.lastImageAt < autoImageMinutes * 60000 || now - session.lastCheckAt < 60000) return;
  session.lastCheckAt = now;
  startIllustration(session);
}

module.exports = { startIllustration, maybeIllustrate };
