/**
 * Strona GitHub Pages:
 *   site/index.html     — data ostatniej generacji i link do mapy
 *   site/map/index.html — najnowsza mapa pod stałym adresem /map
 *
 * Uruchom z katalogu głównego repozytorium (arkusz-mapa): node scripts/build-pages-index.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const MAP_FILE_RE = /^mapa_(\d{4})-(\d{2})-(\d{2})_(\d{2})-(\d{2})-(\d{2})\.html$/;

/** `mapa_2026-09-18_16-01-47.html` → `18.09.2026, 16:01:47`. */
export function formatPagesGeneratedAtLabel(fileName) {
  const match = MAP_FILE_RE.exec(fileName);
  if (!match) return null;
  const [, year, month, day, hour, minute, second] = match;
  return `${day}.${month}.${year}, ${hour}:${minute}:${second}`;
}

export function buildPagesIndexHtml(generatedAtLabel) {
  const label = generatedAtLabel
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/"/g, '&quot;');
  return `<!DOCTYPE html>
<html lang="pl">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Mapa adresów</title>
  <link rel="icon" href="./favicon.svg" type="image/svg+xml">
  <style>
    body { font-family: system-ui, sans-serif; max-width: 42rem; margin: 2rem auto; padding: 0 1rem; line-height: 1.5; }
    a { color: #0d6efd; }
  </style>
</head>
<body>
  <h1>Mapa adresów</h1>
  <p>Ostatnia generacja: <strong>${label}</strong></p>
  <p><a href="./map/">Otwórz mapę w przeglądarce</a></p>
</body>
</html>
`;
}

function copyFavicon(workspace, ...destDirs) {
  const faviconSrc = path.join(workspace, 'docs', 'favicon.svg');
  if (!fs.existsSync(faviconSrc)) return;
  for (const dir of destDirs) {
    fs.mkdirSync(dir, { recursive: true });
    fs.copyFileSync(faviconSrc, path.join(dir, 'favicon.svg'));
  }
  console.log('Skopiowano favicon.svg');
}

function main() {
  const workspace = process.env.GITHUB_WORKSPACE ?? process.cwd();
  const siteDir = path.join(workspace, 'site');
  const mapsDir = path.join(siteDir, 'maps');
  const stableMapDir = path.join(siteDir, 'map');

  if (!fs.existsSync(mapsDir)) {
    console.error('Brak katalogu maps:', mapsDir);
    process.exit(1);
  }

  const files = fs
    .readdirSync(mapsDir)
    .filter((f) => MAP_FILE_RE.test(f))
    .sort()
    .reverse();

  if (files.length === 0) {
    console.error('Brak plików mapa_*.html w', mapsDir);
    process.exit(1);
  }

  const newest = files[0];
  const generatedAtLabel = formatPagesGeneratedAtLabel(newest);
  if (!generatedAtLabel) {
    console.error('Nie udało się odczytać daty z', newest);
    process.exit(1);
  }

  fs.mkdirSync(stableMapDir, { recursive: true });
  fs.copyFileSync(path.join(mapsDir, newest), path.join(stableMapDir, 'index.html'));
  fs.writeFileSync(path.join(siteDir, 'index.html'), buildPagesIndexHtml(generatedAtLabel), 'utf8');
  copyFavicon(workspace, siteDir, mapsDir, stableMapDir);

  console.log('Zapisano', path.join(siteDir, 'index.html'));
  console.log('Stały adres mapy:', path.join(stableMapDir, 'index.html'), `(${newest})`);
}

const isDirectRun =
  process.argv[1] !== undefined &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);

if (isDirectRun) {
  main();
}
