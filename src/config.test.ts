/**
 * Testy TDD dla Fazy 1 – moduł config (02_PLAN_IMPLEMENTACJI.md).
 *
 * Wymagania:
 *   REQ-1.4: Konfiguracja środowiska – odczyt GOOGLE_SHEETS_ID, GOOGLE_APPLICATION_CREDENTIALS, OUTPUT_DIR z env.
 *   REQ-1.5: Stałe – indeksy kolumn (C=2 … I=8 numer plomby, M=12 zbiórka), nazwy zakładek, URL GeoJSON województw.
 *
 * Traceability: REQ-1.4 → getConfig (odczyt z env, brak zmiennych); REQ-1.5 → stałe eksportowane z config.ts.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  getConfig,
  getOptionalWordMapAssetPaths,
  COL_KOD_POCZTOWY,
  COL_MIASTO,
  COL_ULICA,
  COL_NUMER_BUDYNKU,
  COL_NUMER_PLOMBY,
  COL_DATA_ZAMKNIECIA_WORKA,
  COL_ZBIORKA,
  GEOJSON_WOJEWODZTWA_URL,
} from './config';

describe('config', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('REQ-1.5: Stałe – indeksy kolumn', () => {
    it('should expose column index for Kod pocztowy (C) as 2', () => {
      expect(COL_KOD_POCZTOWY).toBe(2);
    });

    it('should expose column index for Miasto (D) as 3', () => {
      expect(COL_MIASTO).toBe(3);
    });

    it('should expose column index for Ulica (E) as 4', () => {
      expect(COL_ULICA).toBe(4);
    });

    it('should expose column index for Numer budynku (F) as 5', () => {
      expect(COL_NUMER_BUDYNKU).toBe(5);
    });

    it('should expose column index for Numer plomby (I) as 8', () => {
      expect(COL_NUMER_PLOMBY).toBe(8);
    });

    it('should expose column index for Data zamknięcia worka (L) as 11', () => {
      expect(COL_DATA_ZAMKNIECIA_WORKA).toBe(11);
    });

    it('should expose column index for Tryb zbiórki (M) as 12', () => {
      expect(COL_ZBIORKA).toBe(12);
    });
  });

  describe('REQ-1.5: Stałe – URL GeoJSON województw', () => {
    it('should expose non-empty GeoJSON voivodeships URL', () => {
      expect(GEOJSON_WOJEWODZTWA_URL).toBeTruthy();
      expect(typeof GEOJSON_WOJEWODZTWA_URL).toBe('string');
      expect(GEOJSON_WOJEWODZTWA_URL.length).toBeGreaterThan(0);
    });

    it('should expose URL that points to GeoJSON resource', () => {
      expect(GEOJSON_WOJEWODZTWA_URL).toMatch(/^https:\/\//);
    });
  });

  describe('REQ-1.4: getConfig – odczyt z env', () => {
    const setAllEnv = (overrides: Partial<Record<string, string>> = {}) => {
      process.env.GOOGLE_SHEETS_ID = 'id';
      process.env.GOOGLE_APPLICATION_CREDENTIALS = './sa.json';
      process.env.OUTPUT_DIR = './out';
      Object.entries(overrides).forEach(([k, v]) => {
        process.env[k] = v;
      });
    };

    it('should return sheetsId from GOOGLE_SHEETS_ID when set', () => {
      setAllEnv({ GOOGLE_SHEETS_ID: 'test-sheet-id-123' });
      const config = getConfig();
      expect(config.sheetsId).toBe('test-sheet-id-123');
    });

    it('should return credentialsPath from GOOGLE_APPLICATION_CREDENTIALS when set', () => {
      setAllEnv({ GOOGLE_APPLICATION_CREDENTIALS: '/path/to/service-account.json' });
      const config = getConfig();
      expect(config.credentialsPath).toBe('/path/to/service-account.json');
    });

    it('should return outputDir from OUTPUT_DIR when set', () => {
      setAllEnv({ OUTPUT_DIR: './generated-maps' });
      const config = getConfig();
      expect(config.outputDir).toBe('./generated-maps');
    });
  });

  describe('REQ-1.4: getConfig – brak wymaganych zmiennych', () => {
    it('should throw when GOOGLE_SHEETS_ID is missing', () => {
      delete process.env.GOOGLE_SHEETS_ID;
      process.env.GOOGLE_APPLICATION_CREDENTIALS = './sa.json';
      process.env.OUTPUT_DIR = './out';
      expect(() => getConfig()).toThrow(/GOOGLE_SHEETS_ID/);
    });

    it('should throw when GOOGLE_APPLICATION_CREDENTIALS is missing', () => {
      process.env.GOOGLE_SHEETS_ID = 'id';
      delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
      process.env.OUTPUT_DIR = './out';
      expect(() => getConfig()).toThrow(/GOOGLE_APPLICATION_CREDENTIALS/);
    });

    it('should throw when OUTPUT_DIR is missing', () => {
      process.env.GOOGLE_SHEETS_ID = 'id';
      process.env.GOOGLE_APPLICATION_CREDENTIALS = './sa.json';
      delete process.env.OUTPUT_DIR;
      expect(() => getConfig()).toThrow(/OUTPUT_DIR/);
    });

    it('should throw when GOOGLE_SHEETS_ID is empty string', () => {
      process.env.GOOGLE_SHEETS_ID = '';
      process.env.GOOGLE_APPLICATION_CREDENTIALS = './sa.json';
      process.env.OUTPUT_DIR = './out';
      expect(() => getConfig()).toThrow();
    });
  });

  describe('getOptionalWordMapAssetPaths', () => {
    it('should default to arkusz-mapa/docs filenames regardless of cwd', () => {
      delete process.env.WORD_TEMPLATE_PATH;
      delete process.env.PODWYKOLISTA_ODS_PATH;
      const paths = getOptionalWordMapAssetPaths();
      expect(paths.templatePath).toMatch(/[/\\]docs[/\\]pusty\.docx$/);
      expect(paths.podwykoPath).toMatch(/[/\\]docs[/\\]podwyko lista\.xlsx$/);
    });

    it('should respect WORD_TEMPLATE_PATH and PODWYKOLISTA_ODS_PATH when set', () => {
      process.env.WORD_TEMPLATE_PATH = '/custom/t.docx';
      process.env.PODWYKOLISTA_ODS_PATH = '/custom/l.ods';
      expect(getOptionalWordMapAssetPaths()).toEqual({
        templatePath: '/custom/t.docx',
        podwykoPath: '/custom/l.ods',
      });
    });
  });
});
