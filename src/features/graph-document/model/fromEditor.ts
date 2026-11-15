import type { EditorGraphEdge, EditorGraphNode } from '../../graph-editor/model/types';
import type { ApplicationSpec, StudioLayoutSpec, StudioPanelSpec, StudioPlotPaletteSpec, StudioVariable } from './studio-workspace';
import type { GraphDocument, GraphParameterValue } from './types';
import { GRAPH_DOCUMENT_FORMAT, GRAPH_DOCUMENT_VERSION } from './types';
import type { ExpressionBinding, JsonPrimitive } from '../../variables/model/types';
import { deriveDefaultStudioPanelsFromNodes } from '../../workspace/model/panel-derivation';
import { mergeSavedAndDerivedStudioPanels, resolveStudioPanelLayout } from '../../workspace/model/panel-merge';

type EditorSnapshot = {
  metadata: {
    name: string;
    description?: string;
    schedulerId?: string;
    studioPanels?: StudioPanelSpec[];
    studioVariables?: StudioVariable[];
    studioLayout?: StudioLayoutSpec;
    studioPlotPalettes?: StudioPlotPaletteSpec[];
    application?: ApplicationSpec;
  };
  nodes: EditorGraphNode[];
  edges: EditorGraphEdge[];
};

function coerceLiteralValue(value: string): JsonPrimitive {
  const trimmed = value.trim();
  if (trimmed === 'null') {
    return null;
  }
  if (trimmed === 'true') {
    return true;
  }
  if (trimmed === 'false') {
    return false;
  }
  return value;
}

function toGraphParameterValue(value: EditorGraphNode['parameters'][string]): ExpressionBinding {
  if (value.bindingKind === 'expression') {
    return { kind: 'expression', expr: value.value };
  }
  return { kind: 'literal', value: coerceLiteralValue(value.value) };
}

export function graphDocumentFromEditor(snapshot: EditorSnapshot): GraphDocument {
  const derivedPanels = deriveDefaultStudioPanelsFromNodes(snapshot.nodes);
  const studioPanels = snapshot.metadata.studioPanels !== undefined || derivedPanels.length > 0
    ? mergeSavedAndDerivedStudioPanels({ savedPanels: snapshot.metadata.studioPanels, derivedPanels, preserveSavedPanels: true })
    : undefined;
  const studioVariables = snapshot.metadata.studioVariables;
  const studioLayout = resolveStudioPanelLayout(snapshot.metadata.studioLayout, studioPanels ?? [], derivedPanels);
  const studioPlotPalettes = snapshot.metadata.studioPlotPalettes;

  return {
    format: GRAPH_DOCUMENT_FORMAT,
    version: GRAPH_DOCUMENT_VERSION,
    metadata: {
      name: snapshot.metadata.name,
      description: snapshot.metadata.description,
      schedulerId: snapshot.metadata.schedulerId,
      application: snapshot.metadata.application,
      studio: studioPanels || studioVariables || studioLayout || studioPlotPalettes
        ? {
            panels: studioPanels ?? [],
            variables: studioVariables ?? [],
            layout: studioLayout,
            plotPalettes: studioPlotPalettes,
          }
        : undefined,
    },
    graph: {
      nodes: snapshot.nodes.map((node) => ({
        id: node.instanceId,
        blockType: node.blockTypeId,
        title: node.displayName,
        executionMode: node.executionMode ?? 'active',
        rotation: node.rotation ?? 0,
        position: {
          x: node.position.x,
          y: node.position.y,
        },
        parameters: Object.entries(node.parameters).reduce(
          (acc, [key, value]) => {
            acc[key] = toGraphParameterValue(value);
            return acc;
          },
          {} as Record<string, GraphParameterValue>,
        ),
      })),
      edges: snapshot.edges.map((edge) => ({
        id: edge.id,
        source: {
          nodeId: edge.sourceInstanceId,
          portId: edge.sourcePort,
        },
        target: {
          nodeId: edge.targetInstanceId,
          portId: edge.targetPort,
        },
      })),
    },
  };
}
