import type { Node } from '@xyflow/react';

export function mergeFlowNodes<T extends Node>(current: T[], next: T[], selectedNodeId: string | null): T[] {
  const currentById = new Map(current.map((node) => [node.id, node]));
  return next.map((node) => {
    const previous = currentById.get(node.id);
    // A renamed node has a new canvas identity, but remains the inspected selection.
    if (!previous) return { ...node, selected: node.id === selectedNodeId };
    return { ...previous, ...node, position: node.position, selected: previous.selected, data: node.data };
  });
}
