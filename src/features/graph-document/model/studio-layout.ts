import type { StudioLayoutNode, StudioLayoutSpec } from './studio-workspace';

const EMPTY_LAYOUT_PANEL_ID = '__studio_layout_empty__';
export type SplitDropPosition = 'left' | 'right' | 'top' | 'bottom';
export type SplitNodePath = number[];
const MIN_SPLIT_CHILD_SIZE = 0.1;

function isPositiveFinite(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

function buildNormalizedSplitSizes(childrenCount: number, sizes?: readonly number[]): number[] {
  if (sizes && sizes.length === childrenCount && sizes.every((size) => isPositiveFinite(size))) {
    return [...sizes];
  }
  return Array.from({ length: childrenCount }, () => 1);
}

function roundLayoutSize(value: number): number {
  return Number.parseFloat(value.toFixed(6));
}

export function normalizeStudioLayoutNode(
  node: StudioLayoutNode,
  allowedPanelIds?: ReadonlySet<string>,
): StudioLayoutNode | null {
  if (node.kind === 'pane') {
    if (!node.panelId.trim()) {
      return null;
    }
    if (allowedPanelIds && !allowedPanelIds.has(node.panelId)) {
      return null;
    }
    return node;
  }

  const normalizedChildren = node.children
    .map((child) => normalizeStudioLayoutNode(child, allowedPanelIds))
    .filter((child): child is StudioLayoutNode => child !== null);

  if (normalizedChildren.length === 0) {
    return null;
  }

  if (normalizedChildren.length === 1) {
    return normalizedChildren[0];
  }

  const hasValidSizes =
    node.sizes !== undefined &&
    node.sizes.length === normalizedChildren.length &&
    node.sizes.every((size) => isPositiveFinite(size));

  return {
    kind: 'split',
    direction: node.direction,
    children: normalizedChildren,
    sizes: hasValidSizes ? node.sizes : undefined,
  };
}

export function collectLayoutPaneIds(node: StudioLayoutNode): string[] {
  if (node.kind === 'pane') {
    return [node.panelId];
  }

  return node.children.flatMap((child) => collectLayoutPaneIds(child));
}

export function buildColumnLayoutRoot(panelIds: readonly string[]): StudioLayoutNode {
  if (panelIds.length === 0) {
    return { kind: 'pane', panelId: EMPTY_LAYOUT_PANEL_ID };
  }
  if (panelIds.length === 1) {
    return { kind: 'pane', panelId: panelIds[0] };
  }
  return {
    kind: 'split',
    direction: 'column',
    children: panelIds.map((panelId) => ({ kind: 'pane', panelId })),
  };
}

export function normalizeStudioLayoutSpec(
  layout: StudioLayoutSpec,
  panelIds?: readonly string[],
): StudioLayoutSpec {
  const allowedPanelIds = panelIds ? new Set(panelIds) : undefined;
  const normalizedRoot = normalizeStudioLayoutNode(layout.root, allowedPanelIds) ?? buildColumnLayoutRoot(panelIds ?? []);
  const rootPaneIds = collectLayoutPaneIds(normalizedRoot);
  const seen = new Set(rootPaneIds);
  const missingPanelIds = (panelIds ?? []).filter((panelId) => !seen.has(panelId));
  const withMissingRoot =
    missingPanelIds.length > 0
      ? {
          kind: 'split' as const,
          direction: 'column' as const,
          children: [normalizedRoot, ...missingPanelIds.map((panelId) => ({ kind: 'pane' as const, panelId }))],
          sizes: [Math.max(1, rootPaneIds.length), ...missingPanelIds.map(() => 1)],
        }
      : normalizedRoot;
  const paneIds = collectLayoutPaneIds(withMissingRoot).filter((panelId) => panelId !== EMPTY_LAYOUT_PANEL_ID);
  const activePanelId =
    layout.activePanelId && paneIds.includes(layout.activePanelId) ? layout.activePanelId : paneIds[0];

  return {
    version: 2,
    root: withMissingRoot,
    activePanelId,
  };
}

function removePaneFromNode(
  node: StudioLayoutNode,
  panelId: string,
): { node: StudioLayoutNode | null; removed: boolean } {
  if (node.kind === 'pane') {
    if (node.panelId === panelId) {
      return { node: null, removed: true };
    }
    return { node, removed: false };
  }

  let removed = false;
  const mappedChildren = node.children
    .map((child) => {
      const result = removePaneFromNode(child, panelId);
      removed = removed || result.removed;
      return result.node;
    });
  if (!removed) return { node, removed: false };
  const nextChildren = mappedChildren.filter((child): child is StudioLayoutNode => child !== null);

  if (nextChildren.length === 0) {
    return { node: null, removed };
  }

  if (nextChildren.length === 1) {
    return { node: nextChildren[0], removed };
  }

  return {
    node: {
      kind: 'split',
      direction: node.direction,
      children: nextChildren,
      sizes: node.sizes?.length === node.children.length
        ? node.sizes.filter((_, index) => mappedChildren[index] !== null)
        : undefined,
    },
    removed,
  };
}

function insertPaneAroundTarget(
  node: StudioLayoutNode,
  targetPanelId: string,
  draggedPanelId: string,
  position: SplitDropPosition,
): { node: StudioLayoutNode; inserted: boolean } {
  if (node.kind === 'pane') {
    if (node.panelId !== targetPanelId) {
      return { node, inserted: false };
    }

    const direction = position === 'left' || position === 'right' ? 'row' : 'column';
    const draggedPane: StudioLayoutNode = { kind: 'pane', panelId: draggedPanelId };
    const targetPane: StudioLayoutNode = { kind: 'pane', panelId: targetPanelId };
    const children =
      position === 'left' || position === 'top'
        ? [draggedPane, targetPane]
        : [targetPane, draggedPane];

    return {
      node: {
        kind: 'split',
        direction,
        children,
      },
      inserted: true,
    };
  }

  let inserted = false;
  const nextChildren: StudioLayoutNode[] = [];
  for (const child of node.children) {
    if (inserted) {
      nextChildren.push(child);
      continue;
    }
    const result = insertPaneAroundTarget(child, targetPanelId, draggedPanelId, position);
    if (result.inserted) {
      inserted = true;
      nextChildren.push(result.node);
      continue;
    }
    nextChildren.push(child);
  }

  return {
    node: inserted
      ? {
          ...node,
          children: nextChildren,
        }
      : node,
    inserted,
  };
}

export function applySplitDropToLayout(
  layout: StudioLayoutSpec,
  draggedPanelId: string,
  targetPanelId: string,
  position: SplitDropPosition,
  allPanelIds: readonly string[] = [],
): StudioLayoutSpec {
  if (!draggedPanelId || !targetPanelId || draggedPanelId === targetPanelId) {
    return layout;
  }

  const removed = removePaneFromNode(layout.root, draggedPanelId);
  if (!removed.removed || !removed.node) {
    return layout;
  }

  const inserted = insertPaneAroundTarget(removed.node, targetPanelId, draggedPanelId, position);
  if (!inserted.inserted) {
    return layout;
  }

  return normalizeStudioLayoutSpec(
    {
      version: 2,
      root: inserted.node,
      activePanelId: draggedPanelId,
    },
    allPanelIds,
  );
}

function mapNodeAtPath(
  node: StudioLayoutNode,
  path: readonly number[],
  mapTarget: (targetNode: StudioLayoutNode) => StudioLayoutNode,
): { node: StudioLayoutNode; updated: boolean; changed: boolean } {
  if (path.length === 0) {
    const mappedNode = mapTarget(node);
    return {
      node: mappedNode,
      updated: true,
      changed: mappedNode !== node,
    };
  }

  if (node.kind !== 'split') {
    return { node, updated: false, changed: false };
  }

  const [index, ...rest] = path;
  if (!Number.isInteger(index) || index < 0 || index >= node.children.length) {
    return { node, updated: false, changed: false };
  }

  const mappedChild = mapNodeAtPath(node.children[index], rest, mapTarget);
  if (!mappedChild.updated) {
    return { node, updated: false, changed: false };
  }
  if (!mappedChild.changed) {
    return { node, updated: true, changed: false };
  }

  const nextChildren = [...node.children];
  nextChildren[index] = mappedChild.node;
  return {
    node: {
      ...node,
      children: nextChildren,
    },
    updated: true,
    changed: true,
  };
}

export function applySplitResizeToLayout(
  layout: StudioLayoutSpec,
  splitPath: readonly number[],
  handleIndex: number,
  deltaSize: number,
  allPanelIds: readonly string[] = [],
): StudioLayoutSpec {
  if (!Number.isFinite(deltaSize) || deltaSize === 0) {
    return layout;
  }

  const mapped = mapNodeAtPath(layout.root, splitPath, (node) => {
    if (node.kind !== 'split') {
      return node;
    }

    const childCount = node.children.length;
    if (childCount < 2 || handleIndex < 0 || handleIndex >= childCount - 1) {
      return node;
    }

    const sizes = buildNormalizedSplitSizes(childCount, node.sizes);
    const leftSize = sizes[handleIndex];
    const rightSize = sizes[handleIndex + 1];
    const maxIncrease = rightSize - MIN_SPLIT_CHILD_SIZE;
    const maxDecrease = -(leftSize - MIN_SPLIT_CHILD_SIZE);
    const clampedDelta = Math.min(Math.max(deltaSize, maxDecrease), maxIncrease);

    if (!Number.isFinite(clampedDelta) || clampedDelta === 0) {
      return node;
    }

    const nextSizes = [...sizes];
    nextSizes[handleIndex] = roundLayoutSize(leftSize + clampedDelta);
    nextSizes[handleIndex + 1] = roundLayoutSize(rightSize - clampedDelta);
    return {
      ...node,
      sizes: nextSizes,
    };
  });

  if (!mapped.updated || !mapped.changed) {
    return layout;
  }

  return normalizeStudioLayoutSpec(
    {
      version: 2,
      root: mapped.node,
      activePanelId: layout.activePanelId,
    },
    allPanelIds,
  );
}

export function applySplitSizesToLayout(
  layout: StudioLayoutSpec,
  splitPath: readonly number[],
  sizes: readonly number[],
  allPanelIds: readonly string[] = [],
): StudioLayoutSpec {
  if (sizes.length === 0 || sizes.some((size) => !isPositiveFinite(size))) {
    return layout;
  }

  const mapped = mapNodeAtPath(layout.root, splitPath, (node) => {
    if (node.kind !== 'split') {
      return node;
    }
    if (node.children.length !== sizes.length) {
      return node;
    }
    const roundedSizes = sizes.map((size) => roundLayoutSize(size));
    const previousSizes = buildNormalizedSplitSizes(node.children.length, node.sizes);
    const previousTotal = previousSizes.reduce((sum, size) => sum + size, 0);
    const nextTotal = roundedSizes.reduce((sum, size) => sum + size, 0);
    if (previousSizes.every((size, index) => Math.abs(size / previousTotal - roundedSizes[index] / nextTotal) < 0.000001)) {
      return node;
    }
    return {
      ...node,
      sizes: roundedSizes,
    };
  });

  if (!mapped.updated || !mapped.changed) {
    return layout;
  }

  return normalizeStudioLayoutSpec(
    {
      version: 2,
      root: mapped.node,
      activePanelId: layout.activePanelId,
    },
    allPanelIds,
  );
}
