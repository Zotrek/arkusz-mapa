/**
 * Buduje site/index.html z listą plików site/maps/mapa_*.html (GitHub Pages).
 * Uruchom z katalogu głównego repozytorium (arkusz-mapa): node scripts/build-pages-index.mjs
 */
import fs from 'node:fs';
import path from 'node:path';

const workspace = process.env.GITHUB_WORKSPACE ?? process.cwd();
const siteDir = path.join(workspace, 'site');
const mapsDir = path.join(siteDir, 'maps');

if (!fs.existsSync(mapsDir)) {
  console.error('Brak katalogu maps:', mapsDir);
  process.exit(1);
}

const files = fs
  .readdirSync(mapsDir)
  .filter((f) => f.endsWith('.html') && f.startsWith('mapa_'))
  .sort()
  .reverse();

if (files.length === 0) {
  console.error('Brak plików mapa_*.html w', mapsDir);
  process.exit(1);
}

const esc = (s) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');

const items = files
  .map((f) => {
    const href = `./maps/${encodeURIComponent(f)}`;
    return `<li><a href="${href}" download="${esc(f)}">${esc(f)}</a> — <a href="${href}">otwórz w przeglądarce</a></li>`;
  })
  .join('\n');

const html = `<!DOCTYPE html>
<html lang="pl">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Mapy — arkusz-mapa</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 42rem; margin: 2rem auto; padding: 0 1rem; line-height: 1.5; }
    ul { padding-left: 1.2rem; }
  </style>
</head>
<body>
  <h1>Wygenerowane mapy</h1>
  <p>Najnowsza na górze. Pobierz plik lub otwórz w przeglądarce.</p>
  <ul>
${items}
  </ul>
</body>
</html>
`;

fs.mkdirSync(siteDir, { recursive: true });
fs.writeFileSync(path.join(siteDir, 'index.html'), html, 'utf8');
console.log('Zapisano', path.join(siteDir, 'index.html'), `(${files.length} map)`);
