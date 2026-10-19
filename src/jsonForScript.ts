/**
 * JSON do wklejenia w `<script>` szablonu HTML: `<` nie może zamknąć bloku skryptu
 * (`</script>`, `<!--`), a U+2028/U+2029 nie mogą łamać literału w starszych silnikach.
 */
export function jsonForScript(value: unknown): string {
  return (JSON.stringify(value) ?? 'null')
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}
