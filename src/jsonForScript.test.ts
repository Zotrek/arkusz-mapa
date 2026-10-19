import { describe, expect, it } from 'vitest';
import { jsonForScript } from './jsonForScript.js';

describe('jsonForScript', () => {
  it('test_jsonForScript_closing_script_tag_is_escaped', () => {
    expect(jsonForScript({ adres: '</script><script>alert(1)</script>' })).not.toContain('<');
  });

  it('test_jsonForScript_line_separators_are_escaped', () => {
    const out = jsonForScript('a\u2028b\u2029c');
    expect(out).toBe('"a\\u2028b\\u2029c"');
  });

  it('test_jsonForScript_output_parses_back_to_same_value', () => {
    const value = { adres: '<b>Kraków</b> & „Sklep”', n: 3, list: ['<!--', '\u2028'] };
    expect(JSON.parse(jsonForScript(value))).toEqual(value);
  });

  it('test_jsonForScript_undefined_returns_null_literal', () => {
    expect(jsonForScript(undefined)).toBe('null');
  });
});
