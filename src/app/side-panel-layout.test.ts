import { describe, expect, it } from 'vitest';
import { getStudioShellGridTemplate } from './side-panel-layout';

describe('Studio side panel layout', () => {
  it('builds every expanded and collapsed column combination', () => {
    expect(getStudioShellGridTemplate(false, false)).toBe('18rem minmax(0, 1fr) 20rem');
    expect(getStudioShellGridTemplate(true, false)).toBe('2.25rem minmax(0, 1fr) 20rem');
    expect(getStudioShellGridTemplate(false, true)).toBe('18rem minmax(0, 1fr) 2.25rem');
    expect(getStudioShellGridTemplate(true, true)).toBe('2.25rem minmax(0, 1fr) 2.25rem');
  });
});
