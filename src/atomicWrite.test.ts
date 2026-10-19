import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { writeFileAtomic } from './atomicWrite.js';

describe('writeFileAtomic', () => {
  let dir = '';

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'atomic-write-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('test_writeFileAtomic_existing_file_is_replaced', async () => {
    const path = join(dir, 'cache.json');
    await writeFile(path, '{"old":true}', 'utf-8');
    await writeFileAtomic(path, '{"new":true}', 'utf-8');
    expect(await readFile(path, 'utf-8')).toBe('{"new":true}');
  });

  it('test_writeFileAtomic_leaves_no_temporary_file', async () => {
    await writeFileAtomic(join(dir, 'cache.json'), '{}', 'utf-8');
    expect(await readdir(dir)).toEqual(['cache.json']);
  });
});
