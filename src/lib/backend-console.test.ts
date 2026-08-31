import { describe, expect, it } from 'vitest';
import { appendBoundedConsoleText } from './backend-console';

describe('backend console view buffer', () => {
  it('appends and replaces console snapshots', () => {
    expect(appendBoundedConsoleText('one\n', 'two\n').content).toBe('one\ntwo\n');
    expect(appendBoundedConsoleText('one\n', 'replacement\n', { replace: true }).content).toBe('replacement\n');
  });

  it('bounds console output by characters and complete lines', () => {
    expect(
      appendBoundedConsoleText('one\ntwo\n', 'three\n', {
        maxCharacters: 12,
        maxLines: 2,
      }),
    ).toEqual({
      content: 'two\nthree\n',
      didTruncate: true,
    });
  });
});
