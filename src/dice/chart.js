// Graphique de fin de séance : chance moyenne de chaque joueur, en barre divergente autour de 50 %.
// Dessiné en SVG puis converti en PNG par sharp, sur l'ordinateur du bot.

const MAX_ROWS = 25;
const WIDTH = 1000;
const PAD = 32;
const ROW_TOP = 140;
const ROW_HEIGHT = 64;
const PLOT_LEFT = 330;
const PLOT_RIGHT = 860;
const BAR_HEIGHT = 20;
const FONT = '\'Segoe UI\', Arial, sans-serif';

// Thème sombre (Discord s'affiche surtout en sombre) ; bleu au-dessus de 50 %, rouge en dessous.
const COLORS = {
  surface: '#1a1a19',
  text: '#f0efec',
  secondary: '#c3c2b7',
  muted: '#898781',
  grid: '#2c2c2a',
  lucky: '#3987e5',
  unlucky: '#e66767',
};

const escapeXml = (text) => String(text).replace(/[&<>"']/g, (char) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\'': '&apos;',
})[char]);

function truncate(text, length) {
  const chars = Array.from(text);
  return chars.length > length ? `${chars.slice(0, length - 1).join('')}…` : text;
}

const percent = (value) => `${Math.round(value * 100)} %`;
const round = (value) => Math.round(value * 10) / 10;
const xFor = (value) => round(PLOT_LEFT + value * (PLOT_RIGHT - PLOT_LEFT));

// Barre de la ligne des 50 % jusqu'à `end`, arrondie de 4 px au bout seulement.
function barPath(start, end, top) {
  const width = Math.abs(end - start);
  if (width < 0.5) return '';
  const radius = Math.min(4, width);
  const bottom = top + BAR_HEIGHT;
  const dir = end > start ? 1 : -1;
  const inner = round(end - dir * radius);
  return `M${start},${top}H${inner}Q${end},${top} ${end},${top + radius}V${bottom - radius}`
    + `Q${end},${bottom} ${inner},${bottom}H${start}Z`;
}

function playerMeta(player) {
  const parts = [`${player.count} jet${player.count > 1 ? 's' : ''}`];
  if (player.d20) parts.push(`${player.nat20}× 20 nat.`, `${player.nat1}× 1 nat.`);
  return parts.join(' · ');
}

// players : [{ name, count, luck (0–1), d20, nat20, nat1 }], déjà triés.
function buildLuckSvg({ title, subtitle, players }) {
  const rows = players.slice(0, MAX_ROWS);
  const hidden = players.length - rows.length;
  const plotBottom = ROW_TOP + rows.length * ROW_HEIGHT;
  const height = plotBottom + (hidden ? 40 : 12) + PAD / 2;
  const middle = xFor(0.5);
  const parts = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${height}" viewBox="0 0 ${WIDTH} ${height}" font-family="${FONT}">`,
    `<rect width="${WIDTH}" height="${height}" fill="${COLORS.surface}"/>`,
    `<text x="${PAD}" y="52" font-size="26" font-weight="600" fill="${COLORS.text}">${escapeXml(title)}</text>`,
    `<text x="${PAD}" y="82" font-size="15" fill="${COLORS.secondary}">${escapeXml(subtitle)}</text>`,
  ];
  for (const tick of [0, 0.25, 0.5, 0.75, 1]) {
    const x = xFor(tick);
    parts.push(`<text x="${x}" y="${ROW_TOP - 16}" font-size="13" text-anchor="middle" fill="${COLORS.muted}">${percent(tick)}</text>`);
    if (tick !== 0.5) parts.push(`<line x1="${x}" y1="${ROW_TOP - 6}" x2="${x}" y2="${plotBottom - 6}" stroke="${COLORS.grid}" stroke-width="1"/>`);
  }
  rows.forEach((player, i) => {
    const top = ROW_TOP + i * ROW_HEIGHT;
    if (i) parts.push(`<line x1="${PAD}" y1="${top - 6}" x2="${WIDTH - PAD}" y2="${top - 6}" stroke="${COLORS.grid}" stroke-width="1"/>`);
    parts.push(
      `<text x="${PAD}" y="${top + 28}" font-size="18" font-weight="600" fill="${COLORS.text}">${escapeXml(truncate(player.name, 24))}</text>`,
      `<text x="${PAD}" y="${top + 50}" font-size="13" fill="${COLORS.secondary}">${escapeXml(playerMeta(player))}</text>`,
    );
    const path = barPath(middle, xFor(player.luck), top + 22);
    if (path) parts.push(`<path d="${path}" fill="${player.luck >= 0.5 ? COLORS.lucky : COLORS.unlucky}"/>`);
    parts.push(`<text x="${WIDTH - PAD}" y="${top + 39}" font-size="18" font-weight="600" text-anchor="end" fill="${COLORS.text}">${percent(player.luck)}</text>`);
  });
  parts.push(`<line x1="${middle}" y1="${ROW_TOP - 6}" x2="${middle}" y2="${plotBottom - 6}" stroke="${COLORS.muted}" stroke-width="1.5"/>`);
  if (hidden) {
    parts.push(`<text x="${PAD}" y="${plotBottom + 22}" font-size="13" fill="${COLORS.muted}">+ ${hidden} autre${hidden > 1 ? 's' : ''} joueur${hidden > 1 ? 's' : ''} non affiché${hidden > 1 ? 's' : ''}</text>`);
  }
  parts.push('</svg>');
  return parts.join('\n');
}

// Rend le graphique en PNG (2× pour un affichage net). sharp n'est chargé qu'ici, à la fin d'une séance.
async function renderLuckChart(options) {
  const sharp = require('sharp');
  return sharp(Buffer.from(buildLuckSvg(options)), { density: 144 }).png().toBuffer();
}

module.exports = { buildLuckSvg, renderLuckChart };
