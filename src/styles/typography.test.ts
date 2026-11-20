import { afterEach, describe, expect, it, vi } from 'vitest';
import { canvasUiFont, loadUiFont } from './typography';

afterEach(() => vi.unstubAllGlobals());

describe('UI font initialization', () => {
  it('waits for the local font before allowing initial UI measurements', async () => {
    let finish!: (faces: FontFace[]) => void;
    const load = vi.fn(() => new Promise<FontFace[]>((resolve) => { finish = resolve; }));
    let completed = false;
    const pending = loadUiFont({ load }).then((result) => { completed = true; return result; });
    await Promise.resolve();
    expect(completed).toBe(false);
    expect(load).toHaveBeenCalledWith('400 14px "Inter"');
    finish([{} as FontFace]);
    expect(await pending).toBe(true);
  });

  it('keeps the platform fallback usable if the local font cannot be read', async () => {
    expect(await loadUiFont({ load: vi.fn().mockRejectedValue(new Error('Font request failed')) })).toBe(false);
    expect(await loadUiFont({ load: vi.fn().mockResolvedValue([]) })).toBe(false);
  });

  it('uses resolved CSS tokens for canvas axes instead of a separate library font', () => {
    const tokens: Record<string, string> = {
      '--font-ui':'"Inter", system-ui', '--font-size-xs':'12px',
      '--font-weight-regular':'400', '--font-weight-medium':'500',
    };
    vi.stubGlobal('document', {documentElement:{}});
    vi.stubGlobal('getComputedStyle', () => ({getPropertyValue:(name: string) => tokens[name]}));
    expect(canvasUiFont()).toBe('400 12px "Inter", system-ui');
    expect(canvasUiFont('medium')).toBe('500 12px "Inter", system-ui');
  });
});
