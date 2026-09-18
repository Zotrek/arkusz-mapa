import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { buildPagesIndexHtml, formatPagesGeneratedAtLabel } from './build-pages-index.mjs';

const scriptPath = fileURLToPath(new URL('./build-pages-index.mjs', import.meta.url));

describe('build-pages-index', () => {
  it('test_formatPagesGeneratedAtLabel_when_map_filename_given_should_use_polish_clock', () => {
    expect(formatPagesGeneratedAtLabel('mapa_2026-09-18_16-01-47.html')).toBe('18.09.2026, 16:01:47');
    expect(formatPagesGeneratedAtLabel('inne.html')).toBeNull();
  });

  it('test_buildPagesIndexHtml_when_label_given_should_link_stable_map', () => {
    const html = buildPagesIndexHtml('18.09.2026, 16:01:47');
    expect(html).toContain('Ostatnia generacja:');
    expect(html).toContain('18.09.2026, 16:01:47');
    expect(html).toContain('href="./map/"');
    expect(html).toContain('Otwórz mapę w przeglądarce');
    expect(html).not.toContain('mapa_2026');
  });

  it('test_script_when_two_maps_present_should_publish_newest_at_stable_path', () => {
    const workspace = mkdtempSync(path.join(tmpdir(), 'arkusz-pages-'));
    try {
      const mapsDir = path.join(workspace, 'site', 'maps');
      mkdirSync(mapsDir, { recursive: true });
      mkdirSync(path.join(workspace, 'docs'), { recursive: true });
      writeFileSync(path.join(mapsDir, 'mapa_2026-09-18_09-00-00.html'), '<html>old</html>');
      writeFileSync(path.join(mapsDir, 'mapa_2026-09-18_16-01-47.html'), '<html>new-map</html>');
      writeFileSync(path.join(workspace, 'docs', 'favicon.svg'), '<svg></svg>');

      execFileSync(process.execPath, [scriptPath], {
        env: { ...process.env, GITHUB_WORKSPACE: workspace },
      });

      const index = readFileSync(path.join(workspace, 'site', 'index.html'), 'utf8');
      const stable = readFileSync(path.join(workspace, 'site', 'map', 'index.html'), 'utf8');
      expect(index).toContain('18.09.2026, 16:01:47');
      expect(index).toContain('href="./map/"');
      expect(index).not.toContain('09-00-00');
      expect(stable).toBe('<html>new-map</html>');
      expect(readFileSync(path.join(workspace, 'site', 'map', 'favicon.svg'), 'utf8')).toBe('<svg></svg>');
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });
});
