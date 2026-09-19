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

  it('test_manualAdminHtml_when_built_should_offer_rate_tab_without_free_text_or_route_rate', () => {
    const html = manualAdminHtml();
    const start = html.indexOf('id="manual-admin-panel-stawki"');
    const end = html.indexOf('id="manual-admin-status"');
    const panel = html.slice(start, end);
    expect(html).toContain('data-tab="stawki"');
    expect(html).toContain('Baza stawek');
    expect(panel).toContain('<select id="manual-admin-stawki-sklep"');
    expect(panel).toContain('<select id="manual-admin-stawki-podwykonawca"');
    expect(panel).not.toContain('manual-admin-stawki-sklep" type="text"');
    expect(panel.toLowerCase()).not.toContain('tras');
    expect(panel).toContain('Kwota za podjazd');
    expect(panel).toContain('Kwota za worek');
    expect(panel).toContain('Od kiedy obowiązuje');
    expect(panel).toContain('bez przebudowy mapy');
  });

  it('test_manualAdminBrowserScript_when_built_should_post_saveRate_as_text_plain', () => {
    const script = manualAdminBrowserScript();
    expect(script).toContain("mode: 'saveRate'");
    expect(script).toContain("headers: { 'Content-Type': 'text/plain;charset=utf-8' }");
    expect(script).toContain('adresy[i].adres');
    expect(script).toContain('PODWYKOLISTA[i].label');
    expect(script).toContain("'stawki'");
    const saved = script.split('\n').find((line) => line.includes('Zapisano stawkę'));
    expect(saved).toBeTruthy();
    expect(saved).not.toContain('generate');
  });
});
