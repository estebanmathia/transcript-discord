// Réception audio : chaque intervention (une seconde de silence, ou 60 secondes au maximum) est transcrite puis ajoutée.
const { EndBehaviorType } = require('@discordjs/voice');
const prism = require('prism-media');
const { sampleRate } = require('../config');
const { transcribe } = require('../speech/whisper');
const { addEntry } = require('./transcript');
const { maybeIllustrate } = require('../illustration/illustrate');

const maxBytes = sampleRate * 2 * 60;

// Transcrit une intervention, retrouve le nom du locuteur, l'ajoute à la session et vérifie s'il faut illustrer.
async function record(session, userId, startedAt, pcm) {
  if (!pcm.length) return;
  let text;
  try {
    text = await transcribe(pcm);
  } catch (error) {
    console.error('Transcription impossible :', error.message);
    text = '[transcription impossible]';
  }
  if (!text) return;
  const member = await session.guild.members.fetch(userId).catch(() => null);
  addEntry(session, { startedAt, speaker: member?.displayName ?? userId, text });
  maybeIllustrate(session);
}

// Commence à capter la voix d'un participant (une intervention à la fois).
function captureSpeech(session, userId) {
  if (session.stopped || session.captures.has(userId)) return;
  const startedAt = new Date();
  const audio = session.connection.receiver.subscribe(userId, {
    end: { behavior: EndBehaviorType.AfterSilence, duration: 1000 },
  });
  const decoder = new prism.opus.Decoder({ rate: sampleRate, channels: 1, frameSize: 320 });
  const chunks = [];
  let bytes = 0;
  let finished = false;
  let restart = false;
  const timer = setTimeout(finish, 60000);

  function cleanup() {
    clearTimeout(timer);
    audio.unpipe(decoder);
    audio.destroy();
  }

  function finish() {
    if (finished) return;
    finished = true;
    restart = true;
    cleanup();
    decoder.end();
  }

  function cancel() {
    if (finished) return;
    finished = true;
    cleanup();
    decoder.destroy();
  }

  const task = new Promise((resolve) => {
    decoder.once('end', () => resolve(record(session, userId, startedAt, Buffer.concat(chunks))));
    decoder.once('close', resolve);
  });
  session.tasks.add(task);
  void task.then(() => session.tasks.delete(task));
  session.captures.set(userId, { finish });
  audio.once('close', () => {
    session.captures.delete(userId);
    if (restart && !session.stopped && session.connection.receiver.speaking.users.has(userId)) {
      captureSpeech(session, userId);
    }
  });
  audio.on('error', (error) => {
    console.error('Réception audio impossible :', error.message);
    cancel();
  });
  decoder.on('error', (error) => {
    console.error('Décodage audio impossible :', error.message);
    cancel();
  });
  audio.on('end', finish);
  decoder.on('data', (chunk) => {
    const remaining = maxBytes - bytes;
    if (remaining > 0) {
      chunks.push(chunk.subarray(0, remaining));
      bytes += Math.min(chunk.length, remaining);
    }
    if (bytes >= maxBytes) finish();
  });
  audio.pipe(decoder);
}

module.exports = { captureSpeech };
