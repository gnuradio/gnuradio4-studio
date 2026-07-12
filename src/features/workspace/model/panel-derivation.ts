import { lookupStudioKnownBlockBinding } from '../../graph-editor/runtime/known-block-bindings';
import type { StudioPanelKind, StudioPanelSpec } from '../../graph-document/model/studio-workspace';
import { buildDisambiguatedPanelTitles } from './panel-titles';

type PanelSourceNode = {
  instanceId: string;
  blockTypeId: string;
  displayName: string;
};

const PANEL_KIND_BY_FAMILY: Readonly<Record<string, Exclude<StudioPanelKind, 'control'>>> = {
  series: 'series',
  series2d: 'series2d',
  histogram: 'histogram',
  waterfall: 'waterfall',
  image: 'image',
  audio: 'audio',
  scalar: 'scalar',
  status: 'status',
};

function makeDeterministicPanelId(nodeId: string): string {
  return `studio-panel:${nodeId}`;
}

function comparePanelSourceNodes(a: PanelSourceNode, b: PanelSourceNode): number {
  const byId = a.instanceId.localeCompare(b.instanceId);
  if (byId !== 0) {
    return byId;
  }

  const byType = a.blockTypeId.localeCompare(b.blockTypeId);
  if (byType !== 0) {
    return byType;
  }

  return a.displayName.localeCompare(b.displayName);
}

export function deriveDefaultStudioPanelsFromNodes(
  nodes: readonly PanelSourceNode[],
): StudioPanelSpec[] {
  const titlesByNodeId = buildDisambiguatedPanelTitles(nodes);

  return [...nodes]
    .sort(comparePanelSourceNodes)
    .flatMap((node) => {
      const binding = lookupStudioKnownBlockBinding(node.blockTypeId);
      if (!binding) {
        return [];
      }

      const kind = PANEL_KIND_BY_FAMILY[binding.family];
      if (!kind) {
        return [];
      }

      const fallbackTitle = node.displayName.trim() || undefined;

      return [
        {
          id: makeDeterministicPanelId(node.instanceId),
          nodeId: node.instanceId,
          kind,
          title: titlesByNodeId.get(node.instanceId) ?? fallbackTitle,
          visible: true,
          previewOnCanvas: false,
        },
      ];
    });
}
