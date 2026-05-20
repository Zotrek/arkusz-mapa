Cache geokodowania (faza 5) — lokalnie i seed dla GitHub Actions
================================================================

Domyślnie `npm run generate` czyta i zapisuje TEN plik:

  data/phase5-cache.json

Po aktualizacji geokodów: zacommituj i wypchnij.

Workflow „arkusz-mapa — Pages”: scala Actions cache + ten plik (data/ wygrywa
przy tym samym adresie). Zob. scripts/merge-phase5-cache.mjs.

Format pliku: { "version": 2, "entries": { "<adres>": { ... } } } — ten sam co zapisuje skrypt.

Alias adresów (literówki → ten sam sklep)
-----------------------------------------
Plik: data/address-aliases.json

Mapuje wariant zapisu z arkusza na kanoniczny adres przed grupowaniem (faza 3).
Np. „11-listopada” → „11 listopada” dla Przeworska — jedna pinezka, brak pary w „Bliskie adresy”.

Przykłady:
  "37-200 Przeworsk 11-listopada 76": "37-200 Przeworsk 11 listopada 76"
  "97-200 Tomaszów Mazowiecki Hoża 1-3": "97-200 Tomaszów Mazowiecki Hoża 1/3"

Po dodaniu wpisu: zacommituj i uruchom ponownie `npm run generate`.
