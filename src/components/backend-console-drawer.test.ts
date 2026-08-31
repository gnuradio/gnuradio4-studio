import { describe, expect, it } from 'vitest';
import { applyOutputEvent } from './backend-console-drawer';

describe('backend console output events', () => {
  it('updates the managed backend running state', () => {
    const result = applyOutputEvent(
      {
        available: true,
        content: 'started\n',
        cursor: 1,
        truncated: false,
        updatedAt: '2026-09-02T10:00:00.000Z',
        logPath: null,
        running: true,
      },
      {
        cursor: 2,
        text: 'exited\n',
        replace: false,
        truncated: false,
        updatedAt: '2026-09-02T10:00:01.000Z',
        running: false,
      },
    );

    expect(result).toMatchObject({
      content: 'started\nexited\n',
      cursor: 2,
      running: false,
    });
  });
});
