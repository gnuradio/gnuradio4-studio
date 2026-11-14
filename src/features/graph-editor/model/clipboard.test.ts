import { describe, expect, it } from 'vitest';
import { buildGraphClipboardPayload, pasteGraphClipboardPayload } from './clipboard';
import type { EditorGraphEdge, EditorGraphNode } from './types';

function makeNode(instanceId: string, x: number, y: number): EditorGraphNode {
  return {
    instanceId,
    blockTypeId: 'test.block',
    displayName: instanceId,
    category: 'Test',
    executionMode: instanceId === 'node-2' ? 'bypassed' : 'active',
    rotation: instanceId === 'node-2' ? 90 : 0,
    parameters: {
      frequency: { value: '1000', bindingKind: 'literal' },
    },
    position: { x, y },
  };
}

describe('graph clipboard helpers', () => {
  it('copies only selected nodes and internal edges', () => {
    const nodes = [makeNode('node-1', 10, 20), makeNode('node-2', 40, 50), makeNode('node-3', 70, 80)];
    const edges: EditorGraphEdge[] = [
      {
        id: 'edge-1',
        sourceInstanceId: 'node-1',
        targetInstanceId: 'node-2',
      },
      {
        id: 'edge-2',
        sourceInstanceId: 'node-2',
        targetInstanceId: 'node-3',
      },
    ];

    const clipboard = buildGraphClipboardPayload(nodes, edges, ['node-1', 'node-2']);

    expect(clipboard?.nodes.map((node) => node.instanceId)).toEqual(['node-1', 'node-2']);
    expect(clipboard?.edges).toHaveLength(1);
    expect(clipboard?.edges[0]).toEqual({
      sourceInstanceId: 'node-1',
      targetInstanceId: 'node-2',
      sourcePort: undefined,
      targetPort: undefined,
    });
  });

  it('pastes copied nodes with remapped ids and offset positions', () => {
    const clipboard = buildGraphClipboardPayload(
      [makeNode('node-1', 10, 20), makeNode('node-2', 40, 50)],
      [
        {
          id: 'edge-1',
          sourceInstanceId: 'node-1',
          targetInstanceId: 'node-2',
        },
      ],
      ['node-1', 'node-2'],
    );

    expect(clipboard).not.toBeNull();
    const pasted = pasteGraphClipboardPayload(clipboard!, {
      existingNodeIds: ['node-1'],
      pasteSequence: 0,
    });

    expect(pasted.nodes).toHaveLength(2);
    expect(pasted.selectedNodeIds).toHaveLength(2);
    expect(pasted.nodes[0].instanceId).toBe('node-1-copy');
    expect(pasted.nodes[1].instanceId).toBe('node-2-copy');
    expect(pasted.nodes[0].executionMode).toBe('active');
    expect(pasted.nodes[1].executionMode).toBe('bypassed');
    expect(pasted.nodes[0].rotation).toBe(0);
    expect(pasted.nodes[1].rotation).toBe(90);
    expect(pasted.nodes[0].position).toEqual({ x: 34, y: 44 });
    expect(pasted.nodes[1].position).toEqual({ x: 64, y: 74 });
    expect(pasted.edges).toEqual([
      {
        id: 'node-1-copy->node-2-copy',
        sourceInstanceId: 'node-1-copy',
        targetInstanceId: 'node-2-copy',
        sourcePort: undefined,
        targetPort: undefined,
      },
    ]);
  });
  it('anchors a distant subgraph in the destination while preserving ports and spacing', () => {
    const payload = buildGraphClipboardPayload(
      [makeNode('a', -5000, 8000), makeNode('b', -4800, 8100)],
      [{ id: 'edge', sourceInstanceId: 'a', targetInstanceId: 'b', sourcePort: 'out:0', targetPort: 'in:1' }],
      ['a', 'b'],
    )!;
    const pasted = pasteGraphClipboardPayload(payload, {
      existingNodeIds: ['a-copy', 'b-copy'], pasteSequence: 0, targetPosition: { x: 100, y: 200 },
    });
    expect(pasted.nodes.map((node) => node.position)).toEqual([{ x: 124, y: 224 }, { x: 324, y: 324 }]);
    expect(pasted.edges[0]).toMatchObject({ sourceInstanceId: 'a-copy-2', targetInstanceId: 'b-copy-2', sourcePort: 'out:0', targetPort: 'in:1' });
  });

  it('keeps a snapshot independent of source edits and previous pastes', () => {
    const source = makeNode('a', 0, 0);
    source.parameters.frequency.bindingKind = 'expression';
    const payload = buildGraphClipboardPayload([source], [], ['a'])!;
    source.parameters.frequency.value = 'changed';
    source.position.x = 999;
    const first = pasteGraphClipboardPayload(payload, { existingNodeIds: [], pasteSequence: 0 });
    first.nodes[0].parameters.frequency.value = 'also changed';
    const second = pasteGraphClipboardPayload(payload, { existingNodeIds: ['a-copy'], pasteSequence: 1 });
    expect(second.nodes[0].parameters.frequency).toEqual({ value: '1000', bindingKind: 'expression' });
    expect(second.nodes[0].position).toEqual({ x: 48, y: 48 });
    expect(second.nodes[0].instanceId).toBe('a-copy-2');
  });

  it('does not copy edges without selected endpoints', () => {
    expect(buildGraphClipboardPayload([makeNode('a', 0, 0)], [], [])).toBeNull();
  });

});
