import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import { SITE_PASSWORD_FETCH_SNIPPET } from './sitePasswordFetchSnippet';

function response(status: number, body: string) {
  return { status, clone: () => ({ text: async () => body }) };
}

function installSnippet(responses: ReturnType<typeof response>[]) {
  const cards: unknown[] = [];
  const ctx: Record<string, unknown> = {
    fetch: async () => responses.shift(),
    showMapErrorCard: (r: unknown) => cards.push(r),
  };
  ctx.window = ctx;
  runInNewContext(SITE_PASSWORD_FETCH_SNIPPET, ctx);
  return { fetch: ctx.fetch as (url: string) => Promise<unknown>, cards };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('SITE_PASSWORD_FETCH_SNIPPET', () => {
  it('test_fetch_when_plain_503_precedes_auth_mismatch_should_still_show_mismatch_card', async () => {
    const snippet = installSnippet([
      response(503, '{"ok":false,"error":"upstream"}'),
      response(503, '{"ok":false,"error":"proxy_auth_mismatch"}'),
    ]);

    await snippet.fetch('/api/transport?action=a');
    await flush();
    await snippet.fetch('/api/transport?action=b');
    await flush();

    expect(snippet.cards).toEqual([expect.objectContaining({ code: 'MAP-E-AUTH-MISMATCH' })]);
  });

  it('test_fetch_when_auth_mismatch_repeats_should_show_card_once', async () => {
    const snippet = installSnippet([
      response(503, '{"ok":false,"error":"proxy_auth_mismatch"}'),
      response(503, '{"ok":false,"error":"proxy_auth_mismatch"}'),
    ]);

    await Promise.all([snippet.fetch('/api/transport?a'), snippet.fetch('/api/transport?b')]);
    await flush();

    expect(snippet.cards).toHaveLength(1);
  });
});
