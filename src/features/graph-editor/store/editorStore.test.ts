import { beforeEach, describe, expect, it } from 'vitest';
import type { EdgeChange, NodeChange } from '@xyflow/react';
import { useEditorStore } from './editorStore';

describe('editorStore flow change application', () => {
  beforeEach(() => {
    useEditorStore.setState({
      nodes: [
        {
          instanceId: 'node-1',
          blockTypeId: 'test.block',
          displayName: 'Node 1',
          category: 'Test',
          executionMode: 'active',
          rotation: 0,
          parameters: {},
          position: { x: 0, y: 0 },
        },
        {
          instanceId: 'node-2',
          blockTypeId: 'test.block',
          displayName: 'Node 2',
          category: 'Test',
          executionMode: 'active',
          rotation: 0,
          parameters: {},
          position: { x: 10, y: 10 },
        },
      ],
      edges: [
        {
          id: 'edge-1',
          sourceInstanceId: 'node-1',
          targetInstanceId: 'node-2',
        },
      ],
      documentName: 'Test',
      documentDescription: undefined,
      studioPanels: undefined,
      studioVariables: undefined,
      studioLayout: undefined,
      studioPlotPalettes: undefined,
      application: undefined,
      clipboard: null,
      clipboardPasteSequence: 0,
      selectedNodeId: null,
      nextNodeSequence: 3,
    });
  });

  it('applies position changes in one flow change batch', () => {
    const changes: NodeChange[] = [
      {
        id: 'node-1',
        type: 'position',
        position: { x: 100, y: 200 },
        dragging: true,
      },
    ];

    useEditorStore.getState().applyFlowNodeChanges(changes);

    const node = useEditorStore.getState().nodes.find((entry) => entry.instanceId === 'node-1');
    expect(node?.position).toEqual({ x: 100, y: 200 });
  });

  it('removes node and connected edges from flow changes', () => {
    const changes: NodeChange[] = [
      {
        id: 'node-1',
        type: 'remove',
      },
    ];

    useEditorStore.getState().applyFlowNodeChanges(changes);

    expect(useEditorStore.getState().nodes.map((entry) => entry.instanceId)).toEqual(['node-2']);
    expect(useEditorStore.getState().edges).toEqual([]);
  });

  it('applies edge remove changes', () => {
    const changes: EdgeChange[] = [
      {
        id: 'edge-1',
        type: 'remove',
      },
    ];

    useEditorStore.getState().applyFlowEdgeChanges(changes);

    expect(useEditorStore.getState().edges).toEqual([]);
  });

  it('stores application display mode intent', () => {
    useEditorStore.getState().setApplication({
      mode: 'new_tab',
      renderer: 'react',
      title: 'Runtime View',
    });

    expect(useEditorStore.getState().application).toEqual({
      mode: 'new_tab',
      renderer: 'react',
      title: 'Runtime View',
    });
  });

  it('copies a selected subgraph and pastes it into a different graph snapshot', () => {
    useEditorStore.getState().copyNodesToClipboard(['node-1', 'node-2']);

    useEditorStore.getState().replaceGraph({
      nodes: [
        {
          instanceId: 'node-a',
          blockTypeId: 'test.block',
          displayName: 'Node A',
          category: 'Test',
          executionMode: 'active',
          rotation: 0,
          parameters: {},
          position: { x: 100, y: 100 },
        },
      ],
      edges: [],
      metadata: {
        name: 'Other graph',
        description: undefined,
        studioPanels: undefined,
        studioVariables: undefined,
        studioLayout: undefined,
        studioPlotPalettes: undefined,
        application: undefined,
      },
    });

    const pasted = useEditorStore.getState().pasteClipboard();
    expect(pasted?.nodeIds).toHaveLength(2);

    const nodeIds = useEditorStore.getState().nodes.map((entry) => entry.instanceId);
    expect(nodeIds).toContain('node-a');
    expect(nodeIds.some((id) => id.startsWith('node-1-copy'))).toBe(true);
    expect(nodeIds.some((id) => id.startsWith('node-2-copy'))).toBe(true);
  });
  it('resets paste offsets on a new copy and destination change without losing the snapshot', () => {
    const store = useEditorStore.getState;
    store().copyNodesToClipboard(['node-1', 'node-2'], 'source-tab');
    store().pasteClipboard();
    store().pasteClipboard();
    expect(store().clipboardPasteSequence).toBe(2);
    store().copyNodesToClipboard(['node-1', 'node-2'], 'source-tab');
    expect(store().clipboardPasteSequence).toBe(0);
    store().pasteClipboard();
    store().replaceGraph({ nodes: [], edges: [], metadata: { name: 'Destination' } });
    expect(store().clipboardPasteSequence).toBe(0);
    expect(store().clipboard?.sourceGraphId).toBe('source-tab');
    const pasted = store().pasteClipboard({ x: 200, y: 300 });
    expect(pasted?.nodeIds).toEqual(['node-1-copy', 'node-2-copy']);
    expect(store().nodes[0].position).toEqual({ x: 224, y: 324 });
    expect(store().edges[0]).toMatchObject({ sourceInstanceId: 'node-1-copy', targetInstanceId: 'node-2-copy' });
    expect(store().selectedNodeId).toBe('node-1-copy');
  });

});
