import { toBlob } from 'html-to-image';
import { getViewportForBounds, type Rect } from '@xyflow/react';

const MAX_SIDE_PX = 4096;
const MIN_SIDE_PX = 256;
const PADDING = 0.1;
const PIXEL_RATIO = 2;

// html-to-image inlines computed styles on HTML elements only. SVG shapes (edges) are serialized with their attributes
// alone, so anything styled through CSS classes (e.g. the edge stroke) would render unpainted. Copy the computed paint
// properties into inline styles for the duration of the capture; the returned function restores the original styles.
const SVG_PAINT_PROPERTIES = [
  'fill',
  'fill-opacity',
  'stroke',
  'stroke-width',
  'stroke-opacity',
  'stroke-dasharray',
  'stroke-dashoffset',
  'stroke-linecap',
  'stroke-linejoin',
  'opacity',
  'font-family',
  'font-size',
  'font-weight',
];

function inlineSvgPaint(viewport: HTMLElement): () => void {
  const restore: Array<() => void> = [];
  for (const element of viewport.querySelectorAll<SVGElement>('svg *')) {
    const computed = getComputedStyle(element);
    const previous = element.getAttribute('style');
    for (const property of SVG_PAINT_PROPERTIES) element.style.setProperty(property, computed.getPropertyValue(property));
    restore.push(() => (previous === null ? element.removeAttribute('style') : element.setAttribute('style', previous)));
  }
  return () => restore.forEach((undo) => undo());
}

// Renders the whole graph (not just the visible part) to a PNG, using the theme's canvas background. `bounds` is the
// flow-space bounding box of all nodes, as reported by React Flow (`getNodesBounds`), or null for an empty graph.
export async function captureGraphPng(flowRoot: HTMLElement, bounds: Rect | null): Promise<Blob> {
  const viewport = flowRoot.querySelector<HTMLElement>('.react-flow__viewport');
  if (!viewport) throw new Error('Graph viewport is not mounted.');
  if (!bounds) throw new Error('The graph is empty.');

  const width = Math.min(MAX_SIDE_PX, Math.max(MIN_SIDE_PX, Math.ceil(bounds.width * (1 + PADDING * 2))));
  const height = Math.min(MAX_SIDE_PX, Math.max(MIN_SIDE_PX, Math.ceil(bounds.height * (1 + PADDING * 2))));
  const { x, y, zoom } = getViewportForBounds(bounds, width, height, 0.1, 2, PADDING);
  const backgroundColor = getComputedStyle(flowRoot).getPropertyValue('--theme-canvas-background').trim() || '#0f172a';

  const restoreSvgStyles = inlineSvgPaint(viewport);
  let blob: Blob | null;
  try {
    blob = await toBlob(viewport, {
      backgroundColor,
      width,
      height,
      pixelRatio: PIXEL_RATIO,
      style: { width: `${width}px`, height: `${height}px`, transform: `translate(${x}px, ${y}px) scale(${zoom})` },
    });
  } finally {
    restoreSvgStyles();
  }
  if (!blob) throw new Error('Failed to render the graph to PNG.');
  return blob;
}

export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}

export async function copyPngToClipboard(blob: Blob): Promise<void> {
  if (typeof ClipboardItem === 'undefined' || !navigator.clipboard?.write) {
    throw new Error('Copying images is not supported in this browser.');
  }
  await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
}
