import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  BACKEND_LOG_TAIL_MAX_BYTES,
  BACKEND_LOG_TAIL_MAX_LINES,
  readBackendLogTail,
  sanitizeBackendLogText,
} from './backend-diagnostics.mjs';

const temporaryDirectories = [];

async function writeTemporaryLog(content) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'gr4-studio-backend-log-'));
  temporaryDirectories.push(directory);
  const logPath = path.join(directory, 'gr4cp_server.log');
  await fs.writeFile(logPath, content, 'utf8');
  return logPath;
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => fs.rm(directory, { recursive: true })));
});

describe('backend diagnostics log tail', () => {
  it('returns the newest bounded set of lines', async () => {
    const logPath = await writeTemporaryLog('one\ntwo\nthree\nfour\n');

    await expect(readBackendLogTail(logPath, { maxBytes: 1024, maxLines: 2 })).resolves.toMatchObject({
      content: 'three\nfour',
      lineCount: 2,
      truncated: true,
    });
  });

  it('discards a partial first line when reading from the end of a large file', async () => {
    const logPath = await writeTemporaryLog('first-line-is-long\nsecond\nthird\n');

    await expect(readBackendLogTail(logPath, { maxBytes: 17, maxLines: 20 })).resolves.toMatchObject({
      content: 'second\nthird',
      lineCount: 2,
      truncated: true,
    });
  });

  it('keeps the first line when the byte bound begins on a line boundary', async () => {
    const logPath = await writeTemporaryLog('discarded\nsecond\nthird\n');

    await expect(readBackendLogTail(logPath, { maxBytes: 13, maxLines: 20 })).resolves.toMatchObject({
      content: 'second\nthird',
      lineCount: 2,
      truncated: true,
    });
  });

  it('strips terminal escape and unsafe control characters', () => {
    expect(sanitizeBackendLogText('\u001B[31mfatal\u001B[0m\u001B\u0000\tcontext')).toBe('fatal\tcontext');
  });

  it('uses conservative production bounds', () => {
    expect(BACKEND_LOG_TAIL_MAX_BYTES).toBe(64 * 1024);
    expect(BACKEND_LOG_TAIL_MAX_LINES).toBe(200);
  });
});
