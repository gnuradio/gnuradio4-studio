import type { EditorGraphNode, GraphPoint } from './types';
import type { NodeRotation } from '../../graph-document/model/types';

export const DEFAULT_NODE_ROTATION: NodeRotation = 0;

export type LogicalNodePortSide = 'input' | 'output';
export type VisualNodePortSide = 'left' | 'right' | 'top' | 'bottom';

export function normalizeNodeRotation(rotation?: NodeRotation): NodeRotation {
  return rotation ?? DEFAULT_NODE_ROTATION;
}

export function isQuarterTurnNodeRotation(rotation: NodeRotation): boolean {
  return rotation === 90 || rotation === 270;
}

export function rotateNodeRotation(rotation: NodeRotation, direction: 'left' | 'right'): NodeRotation {
  const orderedRotations: NodeRotation[] = [0, 90, 180, 270];
  const currentIndex = orderedRotations.indexOf(rotation);
  const safeIndex = currentIndex >= 0 ? currentIndex : 0;
  const delta = direction === 'right' ? 1 : -1;
  const nextIndex = (safeIndex + delta + orderedRotations.length) % orderedRotations.length;
  return orderedRotations[nextIndex] ?? DEFAULT_NODE_ROTATION;
}

export function resolveNodePortVisualSide(
  logicalSide: LogicalNodePortSide,
  rotation: NodeRotation,
): VisualNodePortSide {
  if (rotation === 90) {
    return logicalSide === 'input' ? 'top' : 'bottom';
  }

  if (rotation === 180) {
    return logicalSide === 'input' ? 'right' : 'left';
  }

  if (rotation === 270) {
    return logicalSide === 'input' ? 'bottom' : 'top';
  }

  return logicalSide === 'input' ? 'left' : 'right';
}

// Rotate block centers together while leaving each card's text upright.
export function rotateGraphNodes(
  nodes: readonly EditorGraphNode[],
  direction: 'left' | 'right',
  sizes: ReadonlyMap<string, { width: number; height: number }> = new Map(),
): EditorGraphNode[] {
  if (nodes.length === 0) return [];
  const centers = nodes.map((node) => {
    const size = sizes.get(node.instanceId);
    return { x: node.position.x + (size?.width ?? 0) / 2, y: node.position.y + (size?.height ?? 0) / 2 };
  });
  const pivot = centers.reduce<GraphPoint>(
    (sum, center) => ({ x: sum.x + center.x / nodes.length, y: sum.y + center.y / nodes.length }),
    { x: 0, y: 0 },
  );
  const sign = direction === 'right' ? 1 : -1;
  return nodes.map((node, index) => {
    const center = centers[index];
    const dx = center.x - pivot.x;
    const dy = center.y - pivot.y;
    return {
      ...node,
      rotation: rotateNodeRotation(node.rotation ?? 0, direction),
      position: nodes.length === 1 ? node.position : {
        x: node.position.x + pivot.x - sign * dy - center.x,
        y: node.position.y + pivot.y + sign * dx - center.y,
      },
    };
  });
}
