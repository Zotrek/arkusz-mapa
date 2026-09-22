import { describe, expect, it, vi } from 'vitest';
import { runPullReferenceCli } from './pullReference';

describe('runPullReferenceCli', () => {
  it('test_runPullReferenceCli_when_no_url_should_exit_1_without_fetch', async () => {
    const fetchReference = vi.fn();
    const writeJson = vi.fn();
    const exitFn = vi.fn();
    const logger = { log: vi.fn(), error: vi.fn() };

    await runPullReferenceCli({
      getWebAppUrl: () => undefined,
      fetchReference,
      writeJson,
      logger,
      exitFn,
    });

    expect(logger.error).toHaveBeenCalledWith(
      '[arkusz-mapa] pull:reference — brak TRANSPORT_WEBAPP_URL w .env',
    );
    expect(exitFn).toHaveBeenCalledWith(1);
    expect(fetchReference).not.toHaveBeenCalled();
    expect(writeJson).not.toHaveBeenCalled();
  });

  it('test_runPullReferenceCli_when_ok_should_write_podwyko_and_log_counts', async () => {
    const writeJson = vi.fn(async () => {});
    const exitFn = vi.fn();
    const logger = { log: vi.fn(), error: vi.fn() };
    const lista = [{ label: 'GPW', dane: 'GPW' }];

    await runPullReferenceCli({
      getWebAppUrl: () => 'https://script.google.com/macros/s/test/exec',
      fetchReference: async () => ({
        podwykoLista: lista,
        poprawAdres: [
          { podmiotHandlowy: 'PH', sklep: 'S', adres: 'X', lat: 1, lng: 2 },
        ],
      }),
      writeJson,
      logger,
      exitFn,
    });

    expect(writeJson).toHaveBeenCalledWith(lista);
    expect(logger.log).toHaveBeenCalledWith('[arkusz-mapa] pull:reference start');
    expect(logger.log).toHaveBeenCalledWith('  podwykoLista: 1');
    expect(logger.log).toHaveBeenCalledWith('  poprawAdres (runtime only): 1');
    expect(exitFn).not.toHaveBeenCalled();
  });

  it('test_runPullReferenceCli_when_fetch_throws_should_exit_1', async () => {
    const writeJson = vi.fn();
    const exitFn = vi.fn();
    const logger = { log: vi.fn(), error: vi.fn() };
    const boom = new Error('network');

    await runPullReferenceCli({
      getWebAppUrl: () => 'https://script.google.com/macros/s/test/exec',
      fetchReference: async () => {
        throw boom;
      },
      writeJson,
      logger,
      exitFn,
    });

    expect(logger.error).toHaveBeenCalledWith(boom);
    expect(exitFn).toHaveBeenCalledWith(1);
    expect(writeJson).not.toHaveBeenCalled();
  });
});
