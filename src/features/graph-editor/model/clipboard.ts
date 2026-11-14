import type { EditorGraphEdge, EditorGraphNode } from './types';
import { createEdgeId } from './nodeFactory';

export type GraphClipboardNode = {
  instanceId: string;
  blockTypeId: string;
  displayName: string;
  category?: string;
  executionMode?: EditorGraphNode['executionMode'];
  rotation?: EditorGraphNode['rotation'];
  parameters: EditorGraphNode['parameters'];
  position: {
    x: number;
    y: number;
  };
};

export type GraphClipboardEdge = {
  sourceInstanceId: string;
  targetInstanceId: string;
  sourcePort?: string;
  targetPort?: string;
};

export type GraphClipboardPayload = {
  version: 1;
  sourceGraphId?: string;
  nodes: GraphClipboardNode[];
  edges: GraphClipboardEdge[];
};

function makeUniqueCopyId(existingIds: Set<string>, sourceId: string): string {
  const baseId = `${sourceId}-copy`;
  if (!existingIds.has(baseId)) {
    return baseId;
  }

  for (let index = 2; index < 10_000; index += 1) {
    const nextId = `${baseId}-${index}`;
    if (!existingIds.has(nextId)) {
      return nextId;
    }
  }

  return `${baseId}-${Math.random().toString(36).slice(2, 8)}`;
}

export function buildGraphClipboardPayload(
  nodes: readonly EditorGraphNode[],
  edges: readonly EditorGraphEdge[],
  selectedNodeIds: readonly string[],
): GraphClipboardPayload | null {
  const selectedSet = new Set(selectedNodeIds);
  const selectedNodes = nodes.filter((node) => selectedSet.has(node.instanceId));
  if (selectedNodes.length === 0) {
    return null;
  }

  return {
    version: 1,
    nodes: selectedNodes.map((node) => ({
      instanceId: node.instanceId,
      blockTypeId: node.blockTypeId,
      displayName: node.displayName,
      category: node.category,
      executionMode: node.executionMode,
      rotation: node.rotation,
      parameters: Object.entries(node.parameters).reduce<EditorGraphNode['parameters']>(
        (acc, [name, draft]) => {
          acc[name] = { ...draft };
          return acc;
        },
        {},
      ),
      position: {
        x: node.position.x,
        y: node.position.y,
      },
    })),
    edges: edges
      .filter((edge) => selectedSet.has(edge.sourceInstanceId) && selectedSet.has(edge.targetInstanceId))
      .map((edge) => ({
        sourceInstanceId: edge.sourceInstanceId,
        targetInstanceId: edge.targetInstanceId,
        sourcePort: edge.sourcePort,
        targetPort: edge.targetPort,
      })),
  };
}

export function pasteGraphClipboardPayload(
  payload: GraphClipboardPayload,
  input: {
    existingNodeIds: readonly string[];
    pasteSequence: number;
    targetPosition?: { x: number; y: number };
  },
): {
  nodes: EditorGraphNode[];
  edges: EditorGraphEdge[];
  selectedNodeIds: string[];
} {
  const existingIds = new Set(input.existingNodeIds);
  const idMap = new Map<string, string>();
  const offset = (input.pasteSequence + 1) * 24;
  const origin = {
    x: Math.min(...payload.nodes.map((node) => node.position.x)),
    y: Math.min(...payload.nodes.map((node) => node.position.y)),
  };
  const translation = input.targetPosition
    ? { x: input.targetPosition.x - origin.x, y: input.targetPosition.y - origin.y }
    : { x: 0, y: 0 };
  const nodes = payload.nodes.map((node) => {
    const nextId = makeUniqueCopyId(existingIds, node.instanceId);
    existingIds.add(nextId);
    idMap.set(node.instanceId, nextId);
    return {
      instanceId: nextId,
      blockTypeId: node.blockTypeId,
      displayName: node.displayName,
      category: node.category,
      executionMode: node.executionMode,
      rotation: node.rotation,
      parameters: Object.entries(node.parameters).reduce<EditorGraphNode['parameters']>(
        (acc, [name, draft]) => {
          acc[name] = { ...draft };
          return acc;
        },
        {},
      ),
      position: {
        x: node.position.x + translation.x + offset,
        y: node.position.y + translation.y + offset,
      },
    };
  });

  const edges = payload.edges.flatMap((edge) => {
    const sourceInstanceId = idMap.get(edge.sourceInstanceId);
    const targetInstanceId = idMap.get(edge.targetInstanceId);
    if (!sourceInstanceId || !targetInstanceId) {
      return [];
    }

    const nextEdge: EditorGraphEdge = {
      id: createEdgeId(sourceInstanceId, targetInstanceId, edge.sourcePort, edge.targetPort),
      sourceInstanceId,
      targetInstanceId,
      ...(edge.sourcePort ? { sourcePort: edge.sourcePort } : {}),
      ...(edge.targetPort ? { targetPort: edge.targetPort } : {}),
    };

    return [nextEdge];
  });

  return {
    nodes,
    edges,
    selectedNodeIds: nodes.map((node) => node.instanceId),
  };
}
