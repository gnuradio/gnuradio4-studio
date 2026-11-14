import type { StudioCommands } from '../../../lib/commands/studio-commands';
import { getNodeExecutionMode } from './node-execution';
import type { EditorGraphNode } from './types';

export function contextSelection(selectedIds: readonly string[], clickedId: string): string[] {
  return selectedIds.includes(clickedId) ? [...selectedIds] : [clickedId];
}

export function createSelectionCommands(input: {
  nodes: readonly EditorGraphNode[];
  nodeIds: readonly string[];
  canEdit: boolean;
  isBypassable: (id: string) => boolean;
  rotateNodes: (ids: readonly string[], direction: 'left' | 'right') => void;
  setExecutionMode: (id: string, mode: 'active' | 'disabled' | 'bypassed') => void;
}): StudioCommands {
  const nodes = input.nodes.filter((node) => input.nodeIds.includes(node.instanceId));
  const enabled = input.canEdit && nodes.length > 0;
  const modeCommand = (mode: 'active' | 'disabled' | 'bypassed') => ({
    enabled: enabled && nodes.some((node) => getNodeExecutionMode(node.executionMode) !== mode) &&
      (mode !== 'bypassed' || nodes.every((node) => input.isBypassable(node.instanceId))),
    execute: () => nodes.forEach((node) => input.setExecutionMode(node.instanceId, mode)),
  });
  const rotate = (direction: 'left' | 'right') => ({
    enabled,
    execute: () => input.rotateNodes(nodes.map((node) => node.instanceId), direction),
  });
  return {
    rotateLeft: rotate('left'),
    rotateRight: rotate('right'),
    enable: modeCommand('active'),
    disable: modeCommand('disabled'),
    bypass: modeCommand('bypassed'),
  };
}
