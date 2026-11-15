import { describe, expect, it } from 'vitest';
import { graphDocumentFromEditor } from './fromEditor';
import { editorGraphFromDocument } from './toEditor';
import type { GraphDocument } from './types';
import { parseGraphDocument } from './schema';
import type { StudioLayoutSpec } from './studio-workspace';

describe('studio panel metadata round-trip', () => {
  it('preserves studio panels and layout between editor snapshot and graph document', () => {
    const snapshot = {
      metadata: {
        name: 'Graph',
        description: 'desc',
        studioPanels: [
          {
            id: 'studio-panel:node-1',
            nodeId: 'node-1',
            kind: 'series' as const,
            title: 'Series',
            visible: true,
            previewOnCanvas: false,
            plotStyle: {
              assignmentMode: 'byIndex' as const,
              palette: {
                kind: 'custom' as const,
                colors: ['#00ff00', '#ff00ff'],
              },
            },
          },
        ],
        studioLayout: {
          version: 2 as const,
          root: {
            kind: 'pane' as const,
            panelId: 'studio-panel:node-1',
          },
          activePanelId: 'studio-panel:node-1',
        },
        studioPlotPalettes: [
          {
            id: 'studio-default',
            colors: ['#22d3ee', '#38bdf8'],
          },
        ],
      },
      nodes: [],
      edges: [],
    };

    const document = graphDocumentFromEditor(snapshot);
    expect(document.metadata.studio?.panels).toEqual(snapshot.metadata.studioPanels);
    expect(document.metadata.studio?.layout).toEqual(snapshot.metadata.studioLayout);
    expect(document.metadata.studio?.plotPalettes).toEqual(snapshot.metadata.studioPlotPalettes);

    const restored = editorGraphFromDocument(document);
    expect(restored.metadata.studioPanels).toEqual(snapshot.metadata.studioPanels);
    expect(restored.metadata.studioLayout).toEqual(snapshot.metadata.studioLayout);
    expect(restored.metadata.studioPlotPalettes).toEqual(snapshot.metadata.studioPlotPalettes);
  });

  it.each<StudioLayoutSpec | undefined>([undefined, {
    version: 2,
    root: { kind: 'split', direction: 'row', children: [
      { kind: 'pane', panelId: 'enabled' },
      { kind: 'pane', panelId: 'gain' },
    ] },
  }])('preserves control panels and widget arrangement through file save/load (%j)', (widgetLayout) => {
    const snapshot = {
      metadata: {
        name: 'Graph',
        studioPanels: [
          {
            id: 'studio-control:node-1',
            kind: 'control' as const,
            ...(widgetLayout ? { widgetLayout } : {}),
            title: 'Controls',
            visible: true,
            widgets: [
              {
                id: 'gain',
                kind: 'parameter' as const,
                label: 'Gain',
                inputKind: 'number' as const,
                binding: {
                  kind: 'parameter' as const,
                  nodeId: 'node-1',
                  parameterName: 'gain',
                },
                mode: 'immediate' as const,
              },
              {
                id: 'enabled',
                kind: 'parameter' as const,
                label: 'Enabled',
                inputKind: 'boolean' as const,
                binding: {
                  kind: 'parameter' as const,
                  nodeId: 'node-2',
                  parameterName: 'enabled',
                },
              },
            ],
          },
        ],
      },
      nodes: [],
      edges: [],
    };

    const document = parseGraphDocument(JSON.parse(JSON.stringify(graphDocumentFromEditor(snapshot))));
    expect(document.metadata.studio?.panels).toEqual(snapshot.metadata.studioPanels);

    const restored = editorGraphFromDocument(document);
    expect(restored.metadata.studioPanels).toEqual(snapshot.metadata.studioPanels);
  });

  it('preserves application display intent between editor snapshot and graph document', () => {
    const snapshot = {
      metadata: {
        name: 'Graph',
        application: {
          mode: 'popout' as const,
          renderer: 'react' as const,
          title: 'Spectrum Console',
        },
      },
      nodes: [],
      edges: [],
    };

    const document = graphDocumentFromEditor(snapshot);
    expect(document.metadata.application).toEqual(snapshot.metadata.application);

    const restored = editorGraphFromDocument(document);
    expect(restored.metadata.application).toEqual(snapshot.metadata.application);
  });

  it('preserves node execution modes between editor snapshot and graph document', () => {
    const snapshot = {
      metadata: {
        name: 'Graph',
      },
      nodes: [
        {
          instanceId: 'node-1',
          blockTypeId: 'test.block',
          displayName: 'Node 1',
          category: 'Test',
          executionMode: 'bypassed' as const,
          parameters: {},
          position: { x: 5, y: 10 },
        },
      ],
      edges: [],
    };

    const document = graphDocumentFromEditor(snapshot);
    expect(document.graph.nodes[0].executionMode).toBe('bypassed');

    const restored = editorGraphFromDocument(document);
    expect(restored.nodes[0].executionMode).toBe('bypassed');
  });

  it('preserves node rotations between editor snapshot and graph document', () => {
    const snapshot = {
      metadata: {
        name: 'Graph',
      },
      nodes: [
        {
          instanceId: 'node-1',
          blockTypeId: 'test.block',
          displayName: 'Node 1',
          category: 'Test',
          rotation: 90 as const,
          parameters: {},
          position: { x: 5, y: 10 },
        },
      ],
      edges: [],
    };

    const document = graphDocumentFromEditor(snapshot);
    expect(document.graph.nodes[0].rotation).toBe(90);

    const restored = editorGraphFromDocument(document);
    expect(restored.nodes[0].rotation).toBe(90);
  });

  it('preserves legacy endpoint parameter values across document round-trip', () => {
    const snapshot = {
      metadata: {
        name: 'Graph',
      },
      nodes: [
        {
          instanceId: 'series0',
          blockTypeId: 'gr::studio::StudioSeriesSink<float32>',
          displayName: 'Series',
          category: 'Studio',
          parameters: {
            transport: { value: 'websocket', bindingKind: 'literal' as const },
            endpoint: { value: 'http://legacy-host:18080/legacy-series', bindingKind: 'literal' as const },
          },
          position: { x: 5, y: 10 },
        },
      ],
      edges: [],
    };

    const document = graphDocumentFromEditor(snapshot);
    expect(document.graph.nodes[0]?.parameters.endpoint).toEqual({
      kind: 'literal',
      value: 'http://legacy-host:18080/legacy-series',
    });

    const restored = editorGraphFromDocument(document);
    expect(restored.nodes[0]?.parameters.endpoint).toEqual({
      value: 'http://legacy-host:18080/legacy-series',
      bindingKind: 'literal',
    });
  });

  it('normalizes legacy virtual routing block ids when loading graph documents', () => {
    const document: GraphDocument = {
      format: 'gr4-studio.graph',
      version: 1,
      metadata: {
        name: 'Graph',
      },
      graph: {
        nodes: [
          {
            id: 'route_source',
            blockType: 'gr4-studio::VirtualSource',
            title: 'Virtual Source',
            position: { x: 0, y: 0 },
            parameters: {
              stream_id: { kind: 'literal', value: 'audio' },
            },
          },
          {
            id: 'route_sink',
            blockType: 'gr4-studio::VirtualSink',
            title: 'Virtual Sink',
            position: { x: 100, y: 0 },
            parameters: {
              stream_id: { kind: 'literal', value: 'audio' },
            },
          },
        ],
        edges: [],
      },
    };

    const restored = editorGraphFromDocument(document);
    expect(restored.nodes.map((node) => node.blockTypeId)).toEqual([
      'studio::VirtualSource',
      'studio::VirtualSink',
    ]);

    const resaved = graphDocumentFromEditor(restored);
    expect(resaved.graph.nodes.map((node) => node.blockType)).toEqual([
      'studio::VirtualSource',
      'studio::VirtualSink',
    ]);
  });

  it('preserves virtual routing blocks in graph documents', () => {
    const snapshot = {
      metadata: {
        name: 'Graph',
      },
      nodes: [
        {
          instanceId: 'route_sink',
          blockTypeId: 'studio::VirtualSink',
          displayName: 'Virtual Sink',
          parameters: {
            stream_id: { value: 'audio', bindingKind: 'literal' as const },
          },
          position: { x: 0, y: 0 },
        },
        {
          instanceId: 'route_source',
          blockTypeId: 'studio::VirtualSource',
          displayName: 'Virtual Source',
          parameters: {
            stream_id: { value: 'audio', bindingKind: 'literal' as const },
          },
          position: { x: 100, y: 0 },
        },
      ],
      edges: [
        {
          id: 'virtual-route-edge',
          sourceInstanceId: 'route_source',
          targetInstanceId: 'real_sink',
          sourcePort: 'out',
          targetPort: 'in',
        },
      ],
    };

    const document = graphDocumentFromEditor(snapshot);
    expect(document.graph.nodes.map((node) => node.blockType)).toEqual([
      'studio::VirtualSink',
      'studio::VirtualSource',
    ]);
    expect(document.graph.edges[0]).toEqual({
      id: 'virtual-route-edge',
      source: { nodeId: 'route_source', portId: 'out' },
      target: { nodeId: 'real_sink', portId: 'in' },
    });

    const restored = editorGraphFromDocument(document);
    expect(restored.nodes.map((node) => ({
      instanceId: node.instanceId,
      blockTypeId: node.blockTypeId,
      displayName: node.displayName,
      parameters: node.parameters,
      position: node.position,
    }))).toEqual(snapshot.nodes);
    expect(restored.edges).toEqual(snapshot.edges);
  });
});
