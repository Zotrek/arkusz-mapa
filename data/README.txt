Opcjonalny stały cache geokodowania (faza 5) dla GitHub Actions
================================================================

Skopiuj lokalnie wygenerowany plik JSON (np. z OUTPUT_DIR/phase5-cache.json po udanym
`npm run generate`) do:

  data/phase5-cache.json

i zacommituj. Workflow „arkusz-mapa — Pages” wklei go do .cache/ gdy Actions cache
jest pusty lub nie przywrócił pliku — wtedy faza 5 od razu ma wpisy (cache hit).

Format pliku: { "version": 2, "entries": { "<adres>": { ... } } } — ten sam co zapisuje skrypt.
