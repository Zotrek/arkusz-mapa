Cache geokodowania (faza 5) — lokalnie i seed dla GitHub Actions
================================================================

Domyślnie `npm run generate` czyta i zapisuje TEN plik:

  data/phase5-cache.json

Po aktualizacji geokodów: zacommituj i wypchnij.

Workflow „arkusz-mapa — Pages”: scala Actions cache + ten plik (data/ wygrywa
przy tym samym adresie). Zob. scripts/merge-phase5-cache.mjs.

Format pliku: { "version": 2, "entries": { "<adres>": { ... } } } — ten sam co zapisuje skrypt.
