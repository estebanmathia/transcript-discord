// Fichier de transcription : nom du fichier, format des lignes, ajout d'une intervention et extrait récent.
const fs = require('node:fs');

const pad = (value) => String(value).padStart(2, '0');

function fileName(date, channelName) {
  const day = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  const time = `${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}`;
  const channel = channelName.replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '').slice(0, 50);
  return `${day}_${time}_${channel || 'salon'}.txt`;
}

function formatEntry({ startedAt, speaker, text }) {
  return `[${startedAt.toLocaleTimeString('fr-FR')}] ${speaker} : ${text}\n`;
}

// Ajoute une intervention (ou une illustration) à la session et au fichier.
function addEntry(session, entry) {
  session.entries.push(entry);
  try {
    fs.appendFileSync(session.file, formatEntry(entry));
  } catch (error) {
    console.error('Écriture de la transcription impossible :', error.message);
  }
}

// Dernières interventions parlées depuis `since` (sans les illustrations), limitées à 4000 caractères.
function recentTranscript(session, since) {
  const lines = session.entries
    .filter((entry) => !entry.image && entry.startedAt >= since)
    .sort((a, b) => a.startedAt - b.startedAt)
    .map(formatEntry);
  let text = '';
  for (let i = lines.length - 1; i >= 0 && text.length + lines[i].length <= 4000; i--) text = lines[i] + text;
  return text;
}

module.exports = {
  pad, fileName, formatEntry, addEntry, recentTranscript,
};
