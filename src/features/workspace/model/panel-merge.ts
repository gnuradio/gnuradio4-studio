import type { StudioLayoutNode, StudioLayoutSpec, StudioPanelSpec } from '../../graph-document/model/studio-workspace';
import { normalizeStudioLayoutSpec } from '../../graph-document/model/studio-layout';

type MergeStudioPanelsInput = {
  savedPanels?: readonly StudioPanelSpec[];
  derivedPanels: readonly StudioPanelSpec[];
  preserveSavedPanels?: boolean;
};

export function mergeSavedAndDerivedStudioPanels({
  savedPanels,
  derivedPanels,
  preserveSavedPanels = false,
}: MergeStudioPanelsInput): StudioPanelSpec[] {
  const derivedNodeIds = new Set(derivedPanels.map((panel) => panel.nodeId));
  const saved = savedPanels
    ? savedPanels.filter(
        (panel) =>
          panel.kind === 'control' ||
          preserveSavedPanels ||
          derivedNodeIds.has(panel.nodeId),
      )
    : [];
  const savedNodeIds = new Set(saved.map((panel) => panel.nodeId));
  const savedPanelIds = new Set(saved.map((panel) => panel.id));

  const derivedGaps = derivedPanels.filter(
    (panel) => !savedNodeIds.has(panel.nodeId) && !savedPanelIds.has(panel.id),
  );

  return [...saved, ...derivedGaps];
}

export function resolveStudioPanelLayout(
  layout: StudioLayoutSpec | undefined,
  panels: readonly StudioPanelSpec[],
  derivedPanels: readonly StudioPanelSpec[],
): StudioLayoutSpec | undefined {
  if (!layout) return undefined;
  const panelIds = new Set(panels.map((panel) => panel.id));
  const aliases = new Map<string, string>();
  // Older saves can contain generated pane IDs alongside authored panel IDs.
  // Repair only IDs belonging to the same exact node; authored IDs take precedence.
  for (const derived of derivedPanels) {
    const panel = panels.find((candidate) => candidate.kind !== 'control' && candidate.nodeId === derived.nodeId);
    if (panel && !panelIds.has(derived.id)) aliases.set(derived.id, panel.id);
  }
  const resolveId = (id: string) => aliases.get(id) ?? id;
  const resolveNode = (node: StudioLayoutNode): StudioLayoutNode => node.kind === 'pane'
    ? { ...node, panelId: resolveId(node.panelId) }
    : { ...node, children: node.children.map(resolveNode) };
  return normalizeStudioLayoutSpec({
    ...layout,
    root: resolveNode(layout.root),
    activePanelId: layout.activePanelId ? resolveId(layout.activePanelId) : undefined,
  }, [...panelIds]);
}
