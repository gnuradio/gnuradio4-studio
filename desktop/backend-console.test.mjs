import { describe, expect, it } from 'vitest';
import { createBackendConsoleBuffer } from './backend-console.mjs';

describe('backend console buffer', () => {
  it('appends output with a monotonic cursor', () => {
    const buffer = createBackendConsoleBuffer();

    expect(buffer.append('first\n', '2026-08-31T00:00:00.000Z')).toMatchObject({
      content: 'first\n',
      cursor: 1,
      updatedAt: '2026-08-31T00:00:00.000Z',
    });
    expect(buffer.append('second\n')).toMatchObject({
      content: 'first\nsecond\n',
      cursor: 2,
    });
  });

  it('bounds output by characters and lines', () => {
    const buffer = createBackendConsoleBuffer({ maxCharacters: 12, maxLines: 2 });

    buffer.append('one\ntwo\n');
    const result = buffer.append('three\n');

    expect(result).toMatchObject({
      content: 'two\nthree\n',
      truncated: true,
      didTruncate: true,
    });
  });

  it('does not advance for empty output', () => {
    const buffer = createBackendConsoleBuffer();
    expect(buffer.append('')).toMatchObject({ content: '', cursor: 0, updatedAt: null });
  });
});
