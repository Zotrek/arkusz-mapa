import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const overridesPath = path.join(__dirname, 'output', 'phase5-address-overrides.json');
const cachePath = path.join(__dirname, 'output', 'phase5-cache.json');

const overrides = JSON.parse(fs.readFileSync(overridesPath, 'utf8'));
const cache = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
const entries = cache.entries;

const overrideKeys = new Set(Object.keys(overrides));
let removed = 0;
for (const key of overrideKeys) {
  if (key in entries) {
    delete entries[key];
    removed++;
  }
}

fs.writeFileSync(cachePath, JSON.stringify(cache, null, 2), 'utf8');
console.log(`Usunięto z cache ${removed} wpisów (adresy z overrides). Pozostało ${Object.keys(entries).length} wpisów.`);
