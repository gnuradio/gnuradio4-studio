import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { BlockDetails, BlockParameterMeta } from '../../lib/api/block-details';
import type { EditorGraphNode } from '../graph-editor/model/types';
import { buildStudioAuthoringBindingView } from '../graph-editor/runtime/studio-managed-runtime-authoring';
import { resolveRenderedPorts } from '../ports/model/resolveRenderedPorts';
import { SelectionAdvanced, SelectionHeader, SelectionParameters, SelectionPorts } from './selection-details';

const block: EditorGraphNode = {
  instanceId: `generated-instance-${'1234567890'.repeat(12)}`,
  blockTypeId: 'gr::blocks::basic::Convert<float32, int16>',
  displayName: 'Convert', position: { x: 0, y: 0 }, parameters: {},
};
const details: BlockDetails = {
  blockTypeId: block.blockTypeId, displayName: 'Convert', parameters: [],
  inputPorts: [{ name: 'in', direction: 'input', cardinalityKind: 'fixed', valueType: 'float32' }],
  outputPorts: [{ name: 'out', direction: 'output', cardinalityKind: 'fixed', valueType: 'int16' }],
};
const parameter = (name: string, overrides: Partial<BlockParameterMeta> = {}): BlockParameterMeta => ({
  name, label: name, mutable: true, readOnly: false, valueKind: 'scalar', defaultValue: '1', ...overrides,
});

describe('Inspector selection presentation', () => {
  it('prioritizes the readable name and derives a signature only from fixed reflected ports', () => {
    const html = renderToStaticMarkup(<SelectionHeader block={block} details={details} />);
    expect(html).toContain('>Convert</h2>');
    expect(html).toContain('float32 → int16');
    expect(html).toContain('gr::blocks::basic</p>');
    expect(html).not.toContain(block.instanceId);
    expect(html).not.toContain('&lt;float32');
    const dynamic = { ...details, inputPorts: [{ ...details.inputPorts[0], cardinalityKind: 'dynamic' as const }] };
    expect(renderToStaticMarkup(<SelectionHeader block={block} details={dynamic} />)).not.toContain(' → ');
    expect(renderToStaticMarkup(<SelectionHeader block={block} />)).not.toContain(' → ');
  });

  it('keeps template argument namespaces out of the block namespace and uses existing descriptions', () => {
    const html = renderToStaticMarkup(<SelectionHeader block={{ ...block, blockTypeId: 'gr::Convert<std::complex<float>>' }}
      details={{ ...details, inputPorts: [], description: '@brief Converts values.\n\nLonger documentation.' }} />);
    expect(html).toContain('>gr</p>');
    expect(html).toContain('Converts values.');
    expect(html).not.toContain('Longer documentation.');
  });

  it('shows a compact empty state and exposes current document values and expressions', () => {
    expect(renderToStaticMarkup(<SelectionParameters block={block} details={details} />)).toContain('No configurable parameters.');
    const html = renderToStaticMarkup(<SelectionParameters block={{ ...block, parameters: {
      gain: { value: 'amplitude * 2', bindingKind: 'expression' },
    } }} details={{ ...details, parameters: [parameter('gain'), parameter('mode', { defaultValue: 'fast' })] }} />);
    expect(html).toContain('Edit parameters');
    expect(html).toContain('amplitude * 2');
    expect(html).toContain('title="Expression"');
    expect(html).toContain('fast');
  });

  it('keeps read-only, advanced and descriptor-hidden properties out of the main parameter list', () => {
    const sink = { ...block, blockTypeId: 'gr::studio::StudioSeriesSink<float32>' };
    const metadata = { ...details, parameters: [parameter('sample_rate'), parameter('endpoint'),
      parameter('internal', { uiHint: 'advanced' }), parameter('fixed', { readOnly: true })] };
    const html = renderToStaticMarkup(<SelectionParameters block={sink} details={metadata} />);
    expect(html).toContain('Sample rate (Hz)');
    expect(html).not.toContain('>endpoint<');
    expect(html).not.toContain('>internal<');
    expect(html).not.toContain('>fixed<');
    const advanced = renderToStaticMarkup(<SelectionAdvanced block={sink} binding={null} ports={{ inputs: [], outputs: [] }} details={metadata} />);
    expect(advanced).toContain('internal');
    expect(advanced).toContain('fixed · read-only');
  });

  it('offers filtering for large parameter sets', () => {
    const html = renderToStaticMarkup(<SelectionParameters block={block} details={{ ...details,
      parameters: Array.from({ length: 12 }, (_, i) => parameter(`value_${i}`)),
    }} />);
    expect(html).toContain('aria-label="Filter parameters"');
    expect(html).toContain('value_11');
  });

  it('preserves resolved dynamic and variadic port labels without presenting inference as user-facing type information', () => {
    const ports = resolveRenderedPorts({ schemaPorts: [
      { name: 'in', direction: 'input', cardinalityKind: 'dynamic', isExplicitDynamicCollection: true, renderPortCount: 3, typeName: 'std::complex<float>' },
      { name: 'out', direction: 'output', cardinalityKind: 'dynamic', isExplicitDynamicCollection: true },
    ], parameterValues: {} });
    const html = renderToStaticMarkup(<SelectionPorts ports={ports} />);
    expect(html).toContain('in[2]');
    expect(html).toContain('out[*]');
    expect(html).toContain('std::complex&lt;float&gt; · dynamic');
    expect(html).toContain('Type unspecified · dynamic');
    expect(html).not.toContain('authoritative');
    expect(html).not.toContain('collapsed');
  });

  it('preserves full identifiers, copy controls and registry diagnostics in collapsed advanced details', () => {
    const html = renderToStaticMarkup(<SelectionAdvanced block={block}
      binding={buildStudioAuthoringBindingView(block.blockTypeId, {})} ports={{ inputs: [], outputs: [] }} />);
    expect(html).toContain(block.instanceId);
    expect(html).toContain('gr::blocks::basic::Convert&lt;float32, int16&gt;');
    expect(html).toContain('aria-label="Copy instance id"');
    expect(html).toContain('No Studio metadata');
    expect(html).toContain('Block type is not in the Studio known-block registry.');
    expect(html).not.toMatch(/<details[^>]*\bopen/);
  });
});
