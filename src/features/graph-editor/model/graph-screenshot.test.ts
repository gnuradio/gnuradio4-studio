import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('html-to-image', () => ({ toBlob: vi.fn() }));

import { toBlob } from 'html-to-image';
import { captureGraphPng, copyPngToClipboard, downloadBlob } from './graph-screenshot';

const bounds = (width: number, height: number) => ({ x: 0, y: 0, width, height });

function fakeViewport(svgElements: object[] = []) {
  return { querySelectorAll: () => svgElements };
}

function fakeRoot(viewport: object | null, background = '') {
  vi.stubGlobal('getComputedStyle', () => ({ getPropertyValue: () => background }));
  return { querySelector: () => viewport } as unknown as HTMLElement;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('captureGraphPng', () => {
  it('rejects when the viewport is not mounted', async () => {
    await expect(captureGraphPng(fakeRoot(null), bounds(100, 100))).rejects.toThrow('not mounted');
  });

  it('rejects an empty graph', async () => {
    await expect(captureGraphPng(fakeRoot(fakeViewport()), null)).rejects.toThrow('empty');
  });

  it('renders the whole graph with the theme background', async () => {
    const png = new Blob(['x'], { type: 'image/png' });
    vi.mocked(toBlob).mockResolvedValue(png);
    const viewport = fakeViewport();
    const result = await captureGraphPng(fakeRoot(viewport, ' #123456 '), bounds(1200, 600));

    expect(result).toBe(png);
    const [target, options] = vi.mocked(toBlob).mock.calls[0];
    expect(target).toBe(viewport);
    expect(options?.backgroundColor).toBe('#123456');
    // 1200x600 node bounds plus 10% padding on each side
    expect(options?.width).toBe(1440);
    expect(options?.height).toBe(720);
    expect(options?.style?.transform).toMatch(/^translate\(.+px, .+px\) scale\(.+\)$/);
  });

  it('caps the output size and falls back to the default background', async () => {
    vi.mocked(toBlob).mockResolvedValue(new Blob());
    await captureGraphPng(fakeRoot(fakeViewport()), bounds(50000, 50000));
    const options = vi.mocked(toBlob).mock.calls[0][1];
    expect(options?.width).toBe(4096);
    expect(options?.height).toBe(4096);
    expect(options?.backgroundColor).toBe('#0f172a');
  });

  it('reports a failed render', async () => {
    vi.mocked(toBlob).mockResolvedValue(null);
    await expect(captureGraphPng(fakeRoot(fakeViewport()), bounds(100, 100))).rejects.toThrow('Failed to render');
  });
});

describe('captureGraphPng SVG styling', () => {
  function fakeSvgElement(computed: Record<string, string>, previousStyle: string | null) {
    const inline = new Map<string, string>();
    let styleAttribute = previousStyle;
    return {
      inline,
      computed,
      style: { setProperty: (name: string, value: string) => inline.set(name, value) },
      getAttribute: () => styleAttribute,
      setAttribute: (_: string, value: string) => (styleAttribute = value),
      removeAttribute: () => (styleAttribute = null),
      get styleAttribute() {
        return styleAttribute;
      },
    };
  }

  it('inlines class-based SVG paint during the render and restores the styles afterwards', async () => {
    const path = fakeSvgElement({ stroke: 'rgb(177, 177, 183)', 'stroke-width': '1px' }, null);
    const label = fakeSvgElement({ fill: 'red' }, 'opacity: 0.5');
    vi.stubGlobal('getComputedStyle', (element: { computed?: Record<string, string> }) => ({
      getPropertyValue: (name: string) => element.computed?.[name] ?? '',
    }));
    const root = { querySelector: () => fakeViewport([path, label]) } as unknown as HTMLElement;

    let duringRender: { stroke?: string; width?: string } = {};
    vi.mocked(toBlob).mockImplementation(async () => {
      duringRender = { stroke: path.inline.get('stroke'), width: path.inline.get('stroke-width') };
      return new Blob();
    });

    await captureGraphPng(root, bounds(100, 100));

    expect(duringRender).toEqual({ stroke: 'rgb(177, 177, 183)', width: '1px' });
    expect(path.styleAttribute).toBeNull();
    expect(label.styleAttribute).toBe('opacity: 0.5');
  });

  it('restores SVG styles when the render fails', async () => {
    const path = fakeSvgElement({ stroke: 'red' }, null);
    vi.stubGlobal('getComputedStyle', (element: { computed?: Record<string, string> }) => ({
      getPropertyValue: (name: string) => element.computed?.[name] ?? '',
    }));
    const root = { querySelector: () => fakeViewport([path]) } as unknown as HTMLElement;
    path.setAttribute('style', 'stroke: red');
    vi.mocked(toBlob).mockRejectedValue(new Error('boom'));

    await expect(captureGraphPng(root, bounds(100, 100))).rejects.toThrow('boom');
    // the previous style attribute was "stroke: red"; it is put back as it was captured before inlining
    expect(path.styleAttribute).toBe('stroke: red');
  });
});

describe('downloadBlob', () => {
  it('clicks a temporary link with the file name and releases the URL', () => {
    const link = { href: '', download: '', click: vi.fn() };
    vi.stubGlobal('document', { createElement: () => link });
    const createObjectURL = vi.fn(() => 'blob:abc');
    const revokeObjectURL = vi.fn();
    vi.stubGlobal('URL', { createObjectURL, revokeObjectURL });

    downloadBlob(new Blob(['x']), 'graph.png');

    expect(link.href).toBe('blob:abc');
    expect(link.download).toBe('graph.png');
    expect(link.click).toHaveBeenCalledOnce();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:abc');
  });
});

describe('copyPngToClipboard', () => {
  it('writes a png clipboard item', async () => {
    const write = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { clipboard: { write } });
    vi.stubGlobal('ClipboardItem', class { constructor(public items: Record<string, Blob>) {} });
    const png = new Blob(['x'], { type: 'image/png' });

    await copyPngToClipboard(png);

    const [items] = write.mock.calls[0];
    expect(items).toHaveLength(1);
    expect(items[0].items['image/png']).toBe(png);
  });

  it('rejects when the browser cannot copy images', async () => {
    vi.stubGlobal('navigator', {});
    vi.stubGlobal('ClipboardItem', undefined);
    await expect(copyPngToClipboard(new Blob())).rejects.toThrow('not supported');
  });
});
