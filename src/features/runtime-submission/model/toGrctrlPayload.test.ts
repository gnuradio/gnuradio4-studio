import { describe, expect, it } from 'vitest';
import { toGrctrlContentSubmission } from './toGrctrlPayload';
import type { GraphDocument } from '../../graph-document/model/types';
import {
  NOTE_BLOCK_TYPE,
  VIRTUAL_SINK_BLOCK_TYPE,
  VIRTUAL_SOURCE_BLOCK_TYPE,
} from '../../graph-editor/model/virtual-routing';
import type { BlockDetails } from '../../../lib/api/block-details';

function makeDocument(name: string, uiConstraintsValue: string): GraphDocument {
  return {
    format: 'gr4-studio.graph',
    version: 1,
    metadata: {
      name,
    },
    graph: {
      nodes: [
        {
          id: 'http_sink_1',
          blockType: 'gr::incubator::http::HttpTimeSeriesSink<float32>',
          title: 'HttpTimeSeriesSink',
          position: { x: 0, y: 0 },
          parameters: {
            ui_constraints: { kind: 'expression', expr: uiConstraintsValue },
            bind_port: { kind: 'expression', expr: '8080' },
          },
        },
      ],
      edges: [],
    },
  };
}

function makeVectorSettingsDocument(name: string): GraphDocument {
  return {
    format: 'gr4-studio.graph',
    version: 1,
    metadata: {
      name,
    },
    graph: {
      nodes: [
        {
          id: 'pfb_1',
          blockType: 'gr::incubator::pfb::PfbArbResampler<float32>',
          title: 'PfbArbResampler<float32>',
          position: { x: 0, y: 0 },
          parameters: {
            taps: { kind: 'expression', expr: '' },
            gain: { kind: 'expression', expr: '' },
            name: { kind: 'expression', expr: 'pfb_1' },
          },
        },
      ],
      edges: [],
    },
  };
}

function makeStudioSeriesSinkDetails(): BlockDetails {
  return {
    blockTypeId: 'gr::studio::StudioSeriesSink<float32>',
    displayName: 'StudioSeriesSink<float32>',
    description: 'Studio series sink',
    parameters: [
      {
        name: 'autoscale',
        label: 'autoscale',
        defaultValue: 'true',
        mutable: true,
        readOnly: false,
        valueType: 'bool',
        valueKind: 'scalar',
      },
      {
        name: 'endpoint',
        label: 'endpoint',
        defaultValue: 'http://127.0.0.1:18080/snapshot',
        mutable: true,
        readOnly: false,
        valueType: 'string',
        valueKind: 'scalar',
      },
      {
        name: 'update_ms',
        label: 'update_ms',
        defaultValue: '250',
        mutable: true,
        readOnly: false,
        valueType: 'int',
        valueKind: 'scalar',
      },
    ],
    inputPorts: [],
    outputPorts: [],
  };
}

function makeStudio2DSeriesSinkDetails(): BlockDetails {
  return {
    blockTypeId: 'gr::studio::Studio2DSeriesSink<float32>',
    displayName: 'Studio2DSeriesSink<float32>',
    description: 'Studio 2D series sink',
    parameters: [
      {
        name: 'endpoint',
        label: 'endpoint',
        defaultValue: 'http://127.0.0.1:18081/xy',
        mutable: true,
        readOnly: false,
        valueType: 'string',
        valueKind: 'scalar',
      },
      {
        name: 'transport',
        label: 'transport',
        defaultValue: 'websocket',
        mutable: true,
        readOnly: false,
        valueType: 'string',
        valueKind: 'scalar',
      },
      {
        name: 'x_label',
        label: 'x_label',
        defaultValue: 'x',
        mutable: true,
        readOnly: false,
        valueType: 'string',
        valueKind: 'scalar',
      },
      {
        name: 'y_label',
        label: 'y_label',
        defaultValue: 'y',
        mutable: true,
        readOnly: false,
        valueType: 'string',
        valueKind: 'scalar',
      },
    ],
    inputPorts: [],
    outputPorts: [],
  };
}

function makeSoapySourceDetails(): BlockDetails {
  return {
    blockTypeId: 'gr::blocks::sdr::SoapySource<complex<float32>>',
    displayName: 'SoapySource<complex<float32>>',
    description: 'SoapySDR source',
    parameters: [
      {
        name: 'frequency',
        label: 'frequency',
        mutable: true,
        readOnly: false,
        valueType: 'float64_vector',
        valueKind: 'scalar',
        isCollectionLike: true,
      },
      {
        name: 'rx_bandwidths',
        label: 'rx_bandwidths',
        mutable: true,
        readOnly: false,
        valueType: 'float64_vector',
        valueKind: 'scalar',
        isCollectionLike: true,
      },
      {
        name: 'float_taps',
        label: 'float_taps',
        mutable: true,
        readOnly: false,
        valueType: 'float32_vector',
        valueKind: 'scalar',
        isCollectionLike: true,
      },
    ],
    inputPorts: [],
    outputPorts: [],
  };
}

function makeFloatScalarDetails(): BlockDetails {
  return {
    blockTypeId: 'gr::testing::FloatBlock',
    displayName: 'FloatBlock',
    parameters: [
      {
        name: 'sample_rate',
        label: 'sample_rate',
        mutable: true,
        readOnly: false,
        valueType: 'float',
        valueKind: 'scalar',
      },
      {
        name: 'gain',
        label: 'gain',
        mutable: true,
        readOnly: false,
        valueType: 'float32',
        valueKind: 'scalar',
      },
      {
        name: 'count',
        label: 'count',
        mutable: true,
        readOnly: false,
        valueType: 'int',
        valueKind: 'scalar',
      },
    ],
    inputPorts: [],
    outputPorts: [],
  };
}

describe('toGrctrlContentSubmission', () => {
  it('emits runtime importer block shape with block type in id and instance name in parameters.name', () => {
    const document: GraphDocument = {
      format: 'gr4-studio.graph',
      version: 1,
      metadata: { name: 'runtime-shape' },
      graph: {
        nodes: [
          {
            id: 'gr__testing__NullSink_float32__5',
            blockType: 'gr::testing::NullSink<float32>',
            title: 'NullSink<float32>',
            position: { x: 0, y: 0 },
            parameters: {},
          },
          {
            id: 'gr__testing__NullSource_float32__2',
            blockType: 'gr::testing::NullSource<float32>',
            title: 'NullSource<float32>',
            position: { x: 100, y: 0 },
            parameters: {},
          },
        ],
        edges: [
          {
            id: 'edge_1',
            source: { nodeId: 'gr__testing__NullSource_float32__2', portId: 'out' },
            target: { nodeId: 'gr__testing__NullSink_float32__5', portId: 'in' },
          },
        ],
      },
    };

    const submission = toGrctrlContentSubmission(document);
    expect(submission.content).toContain('- id: "gr::testing::NullSink<float32>"');
    expect(submission.content).toContain('- id: "gr::testing::NullSource<float32>"');
    expect(submission.content).toContain('name: gr__testing__NullSink_float32__5');
    expect(submission.content).toContain('name: gr__testing__NullSource_float32__2');
    expect(submission.content).toContain(
      '- [gr__testing__NullSource_float32__2, out, gr__testing__NullSink_float32__5, in]',
    );
    expect(submission.content).not.toContain('  block:');
    expect(submission.content).not.toContain('  title:');
  });

  it('normalizes quoted ui_constraints map expressions into inline YAML map values', () => {
    const submission = toGrctrlContentSubmission(makeDocument('graph', '"{}"'));
    expect(submission.content).toContain('ui_constraints: {}');
  });

  it('serializes blank ui_constraints as an empty map instead of an empty string', () => {
    const submission = toGrctrlContentSubmission(makeDocument('graph', ''));
    expect(submission.content).toContain('ui_constraints: {}');
    expect(submission.content).not.toContain('ui_constraints: ""');
  });

  it('omits blank parameters from export instead of sending empty strings', () => {
    const submission = toGrctrlContentSubmission(makeVectorSettingsDocument('graph'));

    expect(submission.content).not.toContain('taps: ""');
    expect(submission.content).not.toContain('taps:');
    expect(submission.content).not.toContain('gain: ""');
    expect(submission.content).not.toContain('gain:');
  });

  it('continues to serialize non-empty scalar parameters normally', () => {
    const document = makeVectorSettingsDocument('graph');
    document.graph.nodes[0].parameters.gain = { kind: 'expression', expr: '1.0' };
    const submission = toGrctrlContentSubmission(document);

    expect(submission.content).not.toContain('taps:');
    expect(submission.content).toContain('gain: 1');
  });

  it('keeps integer-looking variable results typed as floats for float scalar parameters', () => {
    const document: GraphDocument = {
      format: 'gr4-studio.graph',
      version: 1,
      metadata: {
        name: 'float-scalars',
        studio: {
          panels: [],
          variables: [
            {
              id: 'var-rate',
              name: 'rf_sample_rate',
              binding: { kind: 'literal', value: 400e3 },
            },
            {
              id: 'var-gain',
              name: 'quad_gain',
              binding: { kind: 'expression', expr: '400e3 / (2 * 3.141592653589793 * 75e3)' },
            },
          ],
        },
      },
      graph: {
        nodes: [
          {
            id: 'float_1',
            blockType: 'gr::testing::FloatBlock',
            title: 'FloatBlock',
            position: { x: 0, y: 0 },
            parameters: {
              sample_rate: { kind: 'expression', expr: 'rf_sample_rate' },
              gain: { kind: 'expression', expr: 'quad_gain' },
              count: { kind: 'literal', value: 400000 },
            },
          },
        ],
        edges: [],
      },
    };

    const submission = toGrctrlContentSubmission(document, {
      blockDetailsByType: new Map([['gr::testing::FloatBlock', makeFloatScalarDetails()]]),
    });

    expect(submission.content).toContain('sample_rate: 400000.0');
    expect(submission.content).toContain('gain: 0.8488263631567752');
    expect(submission.content).toContain('count: 400000');
  });

  it('adds YAML sequence type tags for typed vector parameters from block metadata', () => {
    const document: GraphDocument = {
      format: 'gr4-studio.graph',
      version: 1,
      metadata: { name: 'soapy-source' },
      graph: {
        nodes: [
          {
            id: 'soapy_1',
            blockType: 'gr::blocks::sdr::SoapySource<complex<float32>>',
            title: 'SoapySource<complex<float32>>',
            position: { x: 0, y: 0 },
            parameters: {
              frequency: { kind: 'literal', value: '[991000000.0]' },
              rx_bandwidths: { kind: 'literal', value: '[200000.0]' },
              float_taps: { kind: 'literal', value: '[1.0, 2.0]' },
            },
          },
        ],
        edges: [],
      },
    };

    const submission = toGrctrlContentSubmission(document, {
      blockDetailsByType: new Map([['gr::blocks::sdr::SoapySource<complex<float32>>', makeSoapySourceDetails()]]),
    });

    expect(submission.content).toContain('frequency: !!float64 [991000000.0]');
    expect(submission.content).toContain('rx_bandwidths: !!float64 [200000.0]');
    expect(submission.content).toContain('float_taps: !!float32 [1.0, 2.0]');
  });

  it('does not duplicate an explicit YAML type tag on vector parameters', () => {
    const document: GraphDocument = {
      format: 'gr4-studio.graph',
      version: 1,
      metadata: { name: 'soapy-source' },
      graph: {
        nodes: [
          {
            id: 'soapy_1',
            blockType: 'gr::blocks::sdr::SoapySource<complex<float32>>',
            title: 'SoapySource<complex<float32>>',
            position: { x: 0, y: 0 },
            parameters: {
              frequency: { kind: 'literal', value: '!!float64 [991000000.0]' },
            },
          },
        ],
        edges: [],
      },
    };

    const submission = toGrctrlContentSubmission(document, {
      blockDetailsByType: new Map([['gr::blocks::sdr::SoapySource<complex<float32>>', makeSoapySourceDetails()]]),
    });

    expect(submission.content).toContain('frequency: !!float64 [991000000.0]');
    expect(submission.content).not.toContain('frequency: !!float64 !!float64');
  });

  it('fills missing parameters from block details defaults when available', () => {
    const document: GraphDocument = {
      format: 'gr4-studio.graph',
      version: 1,
      metadata: { name: 'studio-series-sink' },
      graph: {
        nodes: [
          {
            id: 'sink_1',
            blockType: 'gr::studio::StudioSeriesSink<float32>',
            title: 'StudioSeriesSink<float32>',
            position: { x: 0, y: 0 },
            parameters: {
              name: { kind: 'expression', expr: 'sink_1' },
            },
          },
        ],
        edges: [],
      },
    };

    const submission = toGrctrlContentSubmission(document, {
      blockDetailsByType: new Map([[ 'gr::studio::StudioSeriesSink<float32>', makeStudioSeriesSinkDetails() ]]),
    });

    expect(submission.content).toContain('autoscale: true');
    expect(submission.content).not.toContain('endpoint:');
    expect(submission.content).toContain('update_ms: 250');
  });

  it('omits legacy scalar StudioSeriesSink x-axis bounds from runtime export', () => {
    const document: GraphDocument = {
      format: 'gr4-studio.graph',
      version: 1,
      metadata: { name: 'studio-series-sink' },
      graph: {
        nodes: [
          {
            id: 'sink_1',
            blockType: 'gr::studio::StudioSeriesSink<float32>',
            title: 'StudioSeriesSink<float32>',
            position: { x: 0, y: 0 },
            parameters: {
              name: { kind: 'expression', expr: 'sink_1' },
              x_min: { kind: 'literal', value: '-2' },
              x_max: { kind: 'literal', value: '2' },
              y_min: { kind: 'literal', value: '-1' },
              y_max: { kind: 'literal', value: '1' },
            },
          },
        ],
        edges: [],
      },
    };

    const submission = toGrctrlContentSubmission(document);

    expect(submission.content).not.toContain('x_min:');
    expect(submission.content).not.toContain('x_max:');
    expect(submission.content).toContain('y_min: -1');
    expect(submission.content).toContain('y_max: 1');
  });

  it('omits descriptor-managed Studio2DSeriesSink endpoints while keeping XY metadata in runtime export', () => {
    const document: GraphDocument = {
      format: 'gr4-studio.graph',
      version: 1,
      metadata: { name: 'studio-xy-sink' },
      graph: {
        nodes: [
          {
            id: 'xy_sink_1',
            blockType: 'gr::studio::Studio2DSeriesSink<float32>',
            title: 'Studio2DSeriesSink<float32>',
            position: { x: 0, y: 0 },
            parameters: {
              name: { kind: 'expression', expr: 'xy_sink_1' },
              transport: { kind: 'literal', value: 'websocket' },
              endpoint: { kind: 'literal', value: 'http://legacy-host:18081/legacy-xy' },
              x_label: { kind: 'literal', value: 'Measured range m' },
              y_label: { kind: 'literal', value: 'Measured velocity m/s' },
              series_labels: { kind: 'literal', value: 'Measured target' },
              render_mode: { kind: 'literal', value: 'scatter' },
              x_min: { kind: 'literal', value: '0' },
              x_max: { kind: 'literal', value: '1000' },
              y_min: { kind: 'literal', value: '-120' },
              y_max: { kind: 'literal', value: '120' },
            },
          },
        ],
        edges: [],
      },
    };

    const submission = toGrctrlContentSubmission(document, {
      blockDetailsByType: new Map([['gr::studio::Studio2DSeriesSink<float32>', makeStudio2DSeriesSinkDetails()]]),
    });

    expect(submission.content).not.toContain('endpoint:');
    expect(submission.content).toContain('transport: websocket');
    expect(submission.content).toContain('x_label: Measured range m');
    expect(submission.content).toContain('y_label: Measured velocity m/s');
    expect(submission.content).toContain('series_labels: Measured target');
    expect(submission.content).toContain('render_mode: scatter');
    expect(submission.content).toContain('x_min: 0');
    expect(submission.content).toContain('x_max: 1000');
    expect(submission.content).toContain('y_min: -120');
    expect(submission.content).toContain('y_max: 120');
  });

  it('exports payload_format for known Studio stream blocks even without block details hydration', () => {
    const document: GraphDocument = {
      format: 'gr4-studio.graph',
      version: 1,
      metadata: { name: 'studio-power-spectrum-sink' },
      graph: {
        nodes: [
          {
            id: 'spectrum_1',
            blockType: 'gr::studio::StudioPowerSpectrumSink<complex<float32>>',
            title: 'StudioPowerSpectrumSink<complex<float32>>',
            position: { x: 0, y: 0 },
            parameters: {
              name: { kind: 'expression', expr: 'spectrum_1' },
            },
          },
        ],
        edges: [],
      },
    };

    const submission = toGrctrlContentSubmission(document);

    expect(submission.content).toContain('- id: "gr::studio::StudioPowerSpectrumSink<complex<float32>>"');
    expect(submission.content).toContain('payload_format: dataset-xy-json-v1');
  });

  it('produces deterministic output and hash for equivalent documents', () => {
    const left = toGrctrlContentSubmission(makeDocument('graph', '"{}"'));
    const right = toGrctrlContentSubmission(makeDocument('graph', '"{}"'));

    expect(left.content).toBe(right.content);
    expect(left.contentHash).toBe(right.contentHash);
  });

  it('changes content hash when graph content changes', () => {
    const left = toGrctrlContentSubmission(makeDocument('graph-a', '"{}"'));
    const right = toGrctrlContentSubmission(makeDocument('graph-b', '"{}"'));

    expect(left.contentHash).not.toBe(right.contentHash);
  });

  it('omits disabled nodes and rewires bypassed linear nodes in the runtime export', () => {
    const document: GraphDocument = {
      format: 'gr4-studio.graph',
      version: 1,
      metadata: { name: 'runtime-modes' },
      graph: {
        nodes: [
          {
            id: 'source',
            blockType: 'gr::testing::NullSource<float32>',
            title: 'Source',
            position: { x: 0, y: 0 },
            parameters: {},
          },
          {
            id: 'mid',
            blockType: 'gr::testing::Middle<float32>',
            title: 'Mid',
            executionMode: 'bypassed',
            position: { x: 100, y: 0 },
            parameters: {},
          },
          {
            id: 'sink',
            blockType: 'gr::testing::NullSink<float32>',
            title: 'Sink',
            position: { x: 200, y: 0 },
            parameters: {},
          },
          {
            id: 'tail',
            blockType: 'gr::testing::NullSink<float32>',
            title: 'Tail',
            position: { x: 300, y: 0 },
            parameters: {},
          },
          {
            id: 'disabled',
            blockType: 'gr::testing::NullSink<float32>',
            title: 'Disabled',
            executionMode: 'disabled',
            position: { x: 400, y: 0 },
            parameters: {},
          },
        ],
        edges: [
          {
            id: 'edge-1',
            source: { nodeId: 'source', portId: 'out' },
            target: { nodeId: 'mid', portId: 'in' },
          },
          {
            id: 'edge-2',
            source: { nodeId: 'mid', portId: 'out' },
            target: { nodeId: 'sink', portId: 'in' },
          },
          {
            id: 'edge-3',
            source: { nodeId: 'sink', portId: 'out' },
            target: { nodeId: 'tail', portId: 'in' },
          },
          {
            id: 'edge-4',
            source: { nodeId: 'tail', portId: 'out' },
            target: { nodeId: 'disabled', portId: 'in' },
          },
        ],
      },
    };

    const submission = toGrctrlContentSubmission(document);
    expect(submission.content).not.toContain('mid');
    expect(submission.content).not.toContain('disabled');
    expect(submission.content).toContain('- [source, out, sink, in]');
    expect(submission.content).toContain('- [sink, out, tail, in]');
    expect(submission.content).not.toContain('- [source, out, mid, in]');
  });

  it('expands matching virtual sink and source blocks into direct runtime connections', () => {
    const document: GraphDocument = {
      format: 'gr4-studio.graph',
      version: 1,
      metadata: { name: 'virtual-route' },
      graph: {
        nodes: [
          {
            id: 'source',
            blockType: 'gr::testing::NullSource<float32>',
            position: { x: 0, y: 0 },
            parameters: {},
          },
          {
            id: 'route_sink',
            blockType: VIRTUAL_SINK_BLOCK_TYPE,
            position: { x: 100, y: 0 },
            parameters: {
              stream_id: { kind: 'literal', value: 'audio' },
            },
          },
          {
            id: 'route_source',
            blockType: VIRTUAL_SOURCE_BLOCK_TYPE,
            position: { x: 200, y: 0 },
            parameters: {
              stream_id: { kind: 'literal', value: 'audio' },
            },
          },
          {
            id: 'sink',
            blockType: 'gr::testing::NullSink<float32>',
            position: { x: 300, y: 0 },
            parameters: {},
          },
        ],
        edges: [
          {
            id: 'edge-1',
            source: { nodeId: 'source', portId: 'out' },
            target: { nodeId: 'route_sink', portId: 'in' },
          },
          {
            id: 'edge-2',
            source: { nodeId: 'route_source', portId: 'out' },
            target: { nodeId: 'sink', portId: 'in' },
          },
        ],
      },
    };

    const submission = toGrctrlContentSubmission(document);

    expect(submission.content).not.toContain(VIRTUAL_SINK_BLOCK_TYPE);
    expect(submission.content).not.toContain(VIRTUAL_SOURCE_BLOCK_TYPE);
    expect(submission.content).toContain('- [source, out, sink, in]');
    expect(submission.content).not.toContain('route_sink');
    expect(submission.content).not.toContain('route_source');
  });

  it('expands one virtual sink to multiple virtual sources', () => {
    const document: GraphDocument = {
      format: 'gr4-studio.graph',
      version: 1,
      metadata: { name: 'virtual-fanout' },
      graph: {
        nodes: [
          {
            id: 'source',
            blockType: 'gr::testing::NullSource<float32>',
            position: { x: 0, y: 0 },
            parameters: {},
          },
          {
            id: 'route_sink',
            blockType: VIRTUAL_SINK_BLOCK_TYPE,
            position: { x: 100, y: 0 },
            parameters: {
              stream_id: { kind: 'literal', value: 'audio' },
            },
          },
          {
            id: 'route_source_a',
            blockType: VIRTUAL_SOURCE_BLOCK_TYPE,
            position: { x: 200, y: -40 },
            parameters: {
              stream_id: { kind: 'literal', value: 'audio' },
            },
          },
          {
            id: 'route_source_b',
            blockType: VIRTUAL_SOURCE_BLOCK_TYPE,
            position: { x: 200, y: 40 },
            parameters: {
              stream_id: { kind: 'literal', value: 'audio' },
            },
          },
          {
            id: 'sink_a',
            blockType: 'gr::testing::NullSink<float32>',
            position: { x: 300, y: -40 },
            parameters: {},
          },
          {
            id: 'sink_b',
            blockType: 'gr::testing::NullSink<float32>',
            position: { x: 300, y: 40 },
            parameters: {},
          },
        ],
        edges: [
          {
            id: 'edge-1',
            source: { nodeId: 'source', portId: 'out' },
            target: { nodeId: 'route_sink', portId: 'in' },
          },
          {
            id: 'edge-2',
            source: { nodeId: 'route_source_a', portId: 'out' },
            target: { nodeId: 'sink_a', portId: 'in' },
          },
          {
            id: 'edge-3',
            source: { nodeId: 'route_source_b', portId: 'out' },
            target: { nodeId: 'sink_b', portId: 'in' },
          },
        ],
      },
    };

    const submission = toGrctrlContentSubmission(document);

    expect(submission.content).toContain('- [source, out, sink_a, in]');
    expect(submission.content).toContain('- [source, out, sink_b, in]');
  });

  it('rejects duplicate virtual sinks for the same stream id', () => {
    const document: GraphDocument = {
      format: 'gr4-studio.graph',
      version: 1,
      metadata: { name: 'duplicate-virtual-sinks' },
      graph: {
        nodes: [
          {
            id: 'route_sink_a',
            blockType: VIRTUAL_SINK_BLOCK_TYPE,
            position: { x: 0, y: 0 },
            parameters: {
              stream_id: { kind: 'literal', value: 'audio' },
            },
          },
          {
            id: 'route_sink_b',
            blockType: VIRTUAL_SINK_BLOCK_TYPE,
            position: { x: 100, y: 0 },
            parameters: {
              stream_id: { kind: 'literal', value: 'audio' },
            },
          },
        ],
        edges: [],
      },
    };

    expect(() => toGrctrlContentSubmission(document)).toThrow(
      'Virtual route "audio" has multiple sinks',
    );
  });

  it('rejects virtual sources without matching virtual sinks', () => {
    const document: GraphDocument = {
      format: 'gr4-studio.graph',
      version: 1,
      metadata: { name: 'missing-virtual-sink' },
      graph: {
        nodes: [
          {
            id: 'route_source',
            blockType: VIRTUAL_SOURCE_BLOCK_TYPE,
            position: { x: 0, y: 0 },
            parameters: {
              stream_id: { kind: 'literal', value: 'audio' },
            },
          },
        ],
        edges: [],
      },
    };

    expect(() => toGrctrlContentSubmission(document)).toThrow(
      'Virtual source route "audio" has no matching virtual sink.',
    );
  });

  it('omits note blocks from runtime export', () => {
    const document: GraphDocument = {
      format: 'gr4-studio.graph',
      version: 1,
      metadata: { name: 'note-export' },
      graph: {
        nodes: [
          {
            id: 'source',
            blockType: 'gr::testing::NullSource<float32>',
            position: { x: 0, y: 0 },
            parameters: {},
          },
          {
            id: 'note',
            blockType: NOTE_BLOCK_TYPE,
            position: { x: 100, y: 0 },
            parameters: {
              text: { kind: 'literal', value: 'This is a note.' },
            },
          },
        ],
        edges: [],
      },
    };

    const submission = toGrctrlContentSubmission(document);

    expect(submission.content).toContain('- id: "gr::testing::NullSource<float32>"');
    expect(submission.content).not.toContain(NOTE_BLOCK_TYPE);
    expect(submission.content).not.toContain('This is a note.');
  });
});
