/**
 * Dodaje do phase5-address-overrides.json adresy z cache o statusie innym niż "ok".
 * Dla tych wpisów ustawia lat i lng na 0 (do późniejszej ręcznej korekty).
 * Istniejące wpisy w overrides nie są nadpisywane.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const overridesPath = path.join(__dirname, 'output', 'phase5-address-overrides.json');
const cachePath = path.join(__dirname, 'output', 'phase5-cache.json');

const overrides = JSON.parse(fs.readFileSync(overridesPath, 'utf8'));
const cache = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
const entries = cache.entries || {};

const now = new Date().toISOString();
let added = 0;

for (const [address, entry] of Object.entries(entries)) {
  if (!entry || entry.status === 'ok') continue;
  if (overrides[address] != null) continue; // nie nadpisuj istniejących

  overrides[address] = {
    status: entry.status,
    lat: 0,
    lng: 0,
    wojewodztwo: entry.wojewodztwo ?? 'Nieznane',
    updatedAt: now,
  };
  added++;
}

fs.writeFileSync(overridesPath, JSON.stringify(overrides, null, 2) + '\n', 'utf8');
console.log('Dodano do overrides %d adresów (status !== "ok") z lat/lng=0. Łącznie wpisów: %d', added, Object.keys(overrides).length);
