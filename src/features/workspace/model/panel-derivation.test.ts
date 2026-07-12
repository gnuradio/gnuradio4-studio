import { describe, expect, it } from 'vitest';
import { deriveDefaultStudioPanelsFromNodes } from './panel-derivation';

describe('deriveDefaultStudioPanelsFromNodes', () => {
  it('derives panels only for exact known Studio-compatible sink block IDs', () => {
    const panels = deriveDefaultStudioPanelsFromNodes([
      {
        instanceId: 'node-series',
        blockTypeId: 'gr::studio::StudioSeriesSink<float32>',
        displayName: 'Series Sink',
      },
      {
        instanceId: 'node-unknown',
        blockTypeId: 'gr::blocks::NullSink<float>',
        displayName: 'Null',
      },
      {
        instanceId: 'node-near-miss',
        blockTypeId: 'gr::studio::StudioSeriesSink',
        displayName: 'Near Miss',
      },
      {
        instanceId: 'node-spectrum',
        blockTypeId: 'gr::studio::StudioPowerSpectrumSink<float32>',
        displayName: 'Spectrum',
      },
      {
        instanceId: 'node-waterfall',
        blockTypeId: 'gr::studio::StudioWaterfallSink<float32>',
        displayName: 'Waterfall',
      },
    ]);

    expect(panels).toEqual([
      {
        id: 'studio-panel:node-series',
        nodeId: 'node-series',
        kind: 'series',
        title: 'StudioSeriesSink',
        visible: true,
        previewOnCanvas: false,
      },
      {
        id: 'studio-panel:node-spectrum',
        nodeId: 'node-spectrum',
        kind: 'series2d',
        title: 'StudioPowerSpectrumSink',
        visible: true,
        previewOnCanvas: false,
      },
      {
        id: 'studio-panel:node-waterfall',
        nodeId: 'node-waterfall',
        kind: 'waterfall',
        title: 'StudioWaterfallSink',
        visible: true,
        previewOnCanvas: false,
      },
    ]);
  });

  it('maps known sink families to default panel kinds', () => {
    const panels = deriveDefaultStudioPanelsFromNodes([
      {
        instanceId: 'node-series2d',
        blockTypeId: 'gr::studio::Studio2DSeriesSink<float32>',
        displayName: '2D',
      },
      {
        instanceId: 'node-waterfall',
        blockTypeId: 'gr::studio::StudioWaterfallSink<float32>',
        displayName: 'Waterfall',
      },
      {
        instanceId: 'node-dataset',
        blockTypeId: 'gr::studio::StudioDataSetSink<float32>',
        displayName: 'DataSet',
      },
      {
        instanceId: 'node-image',
        blockTypeId: 'gr::studio::StudioImageSink<uint8>',
        displayName: 'Image',
      },
      {
        instanceId: 'node-audio',
        blockTypeId: 'gr::studio::StudioAudioSink<float32>',
        displayName: 'Audio',
      },
      {
        instanceId: 'node-scalar',
        blockTypeId: 'gr::studio::StudioScalarSink<float32>',
        displayName: 'Scalar',
      },
      {
        instanceId: 'node-status',
        blockTypeId: 'gr::studio::StudioStatusSink<float32>',
        displayName: 'Status',
      },
    ]);

    expect(panels.map((panel) => ({ nodeId: panel.nodeId, kind: panel.kind }))).toEqual([
      { nodeId: 'node-audio', kind: 'audio' },
      { nodeId: 'node-dataset', kind: 'series2d' },
      { nodeId: 'node-image', kind: 'image' },
      { nodeId: 'node-scalar', kind: 'scalar' },
      { nodeId: 'node-series2d', kind: 'series2d' },
      { nodeId: 'node-status', kind: 'status' },
      { nodeId: 'node-waterfall', kind: 'waterfall' },
    ]);
  });

  it('is deterministic for IDs and ordering regardless of input order', () => {
    const inputA = [
      {
        instanceId: 'c-node',
        blockTypeId: 'gr::studio::StudioImageSink<uint8>',
        displayName: 'C',
      },
      {
        instanceId: 'a-node',
        blockTypeId: 'gr::studio::StudioSeriesSink<float32>',
        displayName: 'A',
      },
      {
        instanceId: 'b-node',
        blockTypeId: 'gr::studio::StudioAudioSink<float32>',
        displayName: 'B',
      },
    ];

    const inputB = [inputA[2], inputA[0], inputA[1]];

    expect(deriveDefaultStudioPanelsFromNodes(inputA)).toEqual(
      deriveDefaultStudioPanelsFromNodes(inputB),
    );
    expect(deriveDefaultStudioPanelsFromNodes(inputA).map((panel) => panel.id)).toEqual([
      'studio-panel:a-node',
      'studio-panel:b-node',
      'studio-panel:c-node',
    ]);
  });

  it('disambiguates duplicate short titles and preserves canonical sink casing', () => {
    const panels = deriveDefaultStudioPanelsFromNodes([
      {
        instanceId: 'node-f32',
        blockTypeId: 'gr::studio::StudioSeriesSink<float32>',
        displayName: 'studioseriessink<float32>',
      },
      {
        instanceId: 'node-c64',
        blockTypeId: 'gr::studio::StudioSeriesSink<complex<float32>>',
        displayName: 'studioseriessink<complex<float32>>',
      },
    ]);

    expect(panels.map((panel) => ({ nodeId: panel.nodeId, title: panel.title }))).toEqual([
      { nodeId: 'node-c64', title: 'StudioSeriesSink' },
      { nodeId: 'node-f32', title: 'StudioSeriesSink' },
    ]);
  });
});
