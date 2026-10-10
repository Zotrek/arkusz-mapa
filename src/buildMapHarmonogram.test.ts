import { describe, expect, it } from 'vitest';
import {
  harmonogramPanelBrowserScript,
  harmonogramPanelHtml,
} from './buildMapHarmonogram.js';

describe('buildMapHarmonogram', () => {
  it('test_harmonogramPanelHtml_when_built_should_offer_group_price_and_bolecin', () => {
    const html = harmonogramPanelHtml();
    expect(html).toContain('id="harmonogram-group-modal"');
    expect(html).toContain('id="harmonogram-group-buckets"');
    expect(html).toContain('id="harmonogram-group-loading"');
    expect(html).toContain('Ładowanie harmonogramów');
    expect(html).toContain('Do zgrupowania');
    expect(html).toContain('Zapisane');
    expect(html).toContain('spodziewanych worków');
  });

  it('test_harmonogramPanelBrowserScript_when_built_should_call_group_save_and_awizacja', () => {
    const script = harmonogramPanelBrowserScript();
    expect(script).toContain('action=listHarmonogramy');
    expect(script).toContain("mode: 'groupHarmonogram'");
    expect(script).toContain("mode: 'saveHarmonogram'");
    expect(script).toContain("mode: 'awizujBolecin'");
    expect(script).toContain("mode: 'ungroupHarmonogram'");
    expect(script).toContain('map-harmonogram-open');
    expect(script).toContain('spodziewaneWorki');
    expect(script).toContain('oknoAwizacji');
    expect(script).toContain('harmonogram-bucket-head');
    expect(script).toContain('harmonogram-day-chip');
    expect(script).toContain('harmonogramShopCountLabel');
    expect(script).toContain('harmonogramSetLoading');
    expect(script).toContain('harmonogram-card-head');
    expect(script).toContain('harmonogram-id');
  });
});
