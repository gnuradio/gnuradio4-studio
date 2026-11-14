import { beforeEach, describe, expect, it } from 'vitest';
import { createStudioCommands } from '../../../lib/commands/studio-commands';
import { useEditorStore } from '../store/editorStore';
import { contextSelection, createSelectionCommands } from './selection-commands';
import type { EditorGraphNode } from './types';

const node = (instanceId: string, executionMode: EditorGraphNode['executionMode'], rotation: EditorGraphNode['rotation']): EditorGraphNode => ({
  instanceId, blockTypeId: 'test.block', displayName: instanceId, executionMode, rotation,
  parameters: {}, position: { x: 0, y: 0 },
});

function commands(nodeIds: string[], bypassableIds = nodeIds, canEdit = true) {
  const store = useEditorStore.getState();
  const registry = createStudioCommands();
  registry.register('graph', createSelectionCommands({
    nodes: store.nodes, nodeIds, canEdit,
    isBypassable: (id) => bypassableIds.includes(id),
    setRotation: store.setNodeRotation, setExecutionMode: store.setNodeExecutionMode,
  }));
  return registry;
}

describe('graph selection commands', () => {
  beforeEach(() => {
    useEditorStore.setState({ nodes: [node('a', 'active', 0), node('b', 'disabled', 270), node('c', 'bypassed', 90)], edges: [] });
  });

  it('preserves the selected group or selects only a newly targeted block', () => {
    expect(contextSelection(['a', 'b'], 'b')).toEqual(['a', 'b']);
    expect(contextSelection(['a', 'b'], 'c')).toEqual(['c']);
    expect(contextSelection([], 'c')).toEqual(['c']);
  });

  it('rotates the targeted group from each block’s existing rotation', async () => {
    await commands(contextSelection(['a', 'b'], 'b')).execute('rotateRight');
    expect(useEditorStore.getState().nodes.map((entry) => entry.rotation)).toEqual([90, 0, 90]);
    await commands(['a', 'b']).execute('rotateLeft');
    expect(useEditorStore.getState().nodes.map((entry) => entry.rotation)).toEqual([0, 270, 90]);
  });

  it('applies explicit execution states to a mixed group without changing other blocks', async () => {
    await commands(['a', 'b']).execute('enable');
    expect(useEditorStore.getState().nodes.map((entry) => entry.executionMode)).toEqual(['active', 'active', 'bypassed']);
    expect(commands(['a', 'b']).state().enable?.enabled).toBe(false);
    await commands(['a', 'b']).execute('disable');
    expect(useEditorStore.getState().nodes.map((entry) => entry.executionMode)).toEqual(['disabled', 'disabled', 'bypassed']);
  });

  it('rejects bypass for an incompatible group instead of partially changing it', async () => {
    const registry = commands(['a', 'b'], ['a']);
    expect(await registry.execute('bypass')).toBe(false);
    expect(useEditorStore.getState().nodes.map((entry) => entry.executionMode)).toEqual(['active', 'disabled', 'bypassed']);
    await commands(['a', 'b']).execute('bypass');
    expect(useEditorStore.getState().nodes.map((entry) => entry.executionMode)).toEqual(['bypassed', 'bypassed', 'bypassed']);
    expect(commands(['a', 'b']).state().bypass?.enabled).toBe(false);
  });

  it('disables selection actions with no targets or while editing is unavailable', async () => {
    for (const registry of [commands([]), commands(['a'], ['a'], false)]) {
      expect(Object.values(registry.state()).every((entry) => !entry.enabled)).toBe(true);
      expect(await registry.execute('rotateRight')).toBe(false);
      expect(await registry.execute('disable')).toBe(false);
    }
    expect(useEditorStore.getState().nodes[0]).toMatchObject({ rotation: 0, executionMode: 'active' });
  });
});
