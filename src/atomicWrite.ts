import { rename, writeFile } from 'node:fs/promises';

/**
 * Zapis przez plik tymczasowy + `rename` (atomowy w obrębie systemu plików):
 * przerwany proces zostawia stary plik, nigdy ucięty.
 */
export async function writeFileAtomic(
  path: string,
  content: string,
  encoding: BufferEncoding,
): Promise<void> {
  const tmpPath = `${path}.${process.pid}.tmp`;
  await writeFile(tmpPath, content, encoding);
  await rename(tmpPath, path);
}
