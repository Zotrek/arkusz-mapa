import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const overridesPath =
  process.argv[2] ?
    path.resolve(process.cwd(), process.argv[2]) :
    path.join(__dirname, 'output', 'phase5-address-overrides.json');
const cachePath = path.join(__dirname, 'output', 'phase5-cache.json');

function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

const overrides = JSON.parse(fs.readFileSync(overridesPath, 'utf8'));
const cache = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
const entries = cache.entries || cache;

const results = [];

const minDistKm = Number(process.argv[3]) || 10;

for (const [addr, ov] of Object.entries(overrides)) {
  if (typeof ov.lat !== 'number' || typeof ov.lng !== 'number') continue;
  const ce = entries[addr];
  if (!ce) continue;
  if (ce.status === 'bad') continue;
  if (typeof ce.lat !== 'number' || typeof ce.lng !== 'number') continue;
  const dist = haversineKm(ov.lat, ov.lng, ce.lat, ce.lng);
  if (dist > minDistKm) {
    results.push({
      address: addr,
      distance_km: Math.round(dist * 100) / 100,
      override: { lat: ov.lat, lng: ov.lng },
      cache: { lat: ce.lat, lng: ce.lng },
      cache_status: ce.status,
    });
  }
}

results.sort((a, b) => b.distance_km - a.distance_km);

console.log(JSON.stringify(results, null, 2));
console.error('\n--- Count:', results.length, 'adresów z dystansem >', minDistKm, 'km (bez statusu bad w cache). Źródło:', overridesPath, '---');
