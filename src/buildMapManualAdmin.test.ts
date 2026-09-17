import { describe, it, expect } from 'vitest';
import { manualAdminBrowserScript, manualAdminHtml } from './buildMapManualAdmin';
import { POLISH_VOIVODESHIPS } from './polishVoivodeships';

describe('buildMapManualAdmin', () => {
  it('test_manualAdminHtml_when_built_should_include_wojewodztwo_select', () => {
    const html = manualAdminHtml();
    expect(html).toContain('id="manual-admin-popraw-wojewodztwo"');
    expect(html).toContain('Województwo');
    expect(html).toContain('— wybierz —');
    expect(html).toContain('Pomorskie');
    expect(html).toContain('Mazowieckie');
    expect(POLISH_VOIVODESHIPS).toHaveLength(16);
  });

  it('test_manualAdminBrowserScript_when_built_should_post_wojewodztwo', () => {
    const script = manualAdminBrowserScript();
    expect(script).toContain('wojewodztwo:');
    expect(script).toContain('setPoprawWojewodztwoSelect');
    expect(script).toContain('manual-admin-popraw-wojewodztwo');
  });
});
