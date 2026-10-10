import { create } from 'zustand';
import type { EdgeChange, NodeChange } from '@xyflow/react';
import type { ExpressionBinding } from '../../variables/model/types';
import { createNextVariableName, createUniqueVariableName } from '../../variables/model/variable-binding';
import type { BlockDetails } from '../../../lib/api/block-details';
import type { ApplicationSpec, StudioLayoutSpec, StudioPanelSpec, StudioPlotPaletteSpec, StudioVariable } from '../../graph-document/model/studio-workspace';
import {
  buildInitialParameterDrafts,
  createEditorNode,
  createEdgeId,
  getNextNodePosition,
} from '../model/nodeFactory';
import {
  buildGraphClipboardPayload,
  pasteGraphClipboardPayload,
  type GraphClipboardPayload,
} from '../model/clipboard';
import type {
  EditorCatalogBlock,
  EditorGraphEdge,
  EditorGraphNode,
  EditorNodeParameterDrafts,
  GraphPoint,
} from '../model/types';

type AddEdgeInput = {
  sourceInstanceId: string;
  targetInstanceId: string;
  sourcePort?: string;
  targetPort?: string;
};

type EditorState = {
  nodes: EditorGraphNode[];
  edges: EditorGraphEdge[];
  documentName: string;
  documentDescription?: string;
  schedulerId?: string;
  studioPanels?: StudioPanelSpec[];
  studioVariables?: StudioVariable[];
  studioLayout?: StudioLayoutSpec;
  studioPlotPalettes?: StudioPlotPaletteSpec[];
  application?: ApplicationSpec;
  clipboard: GraphClipboardPayload | null;
  clipboardPasteSequence: number;
  selectedNodeId: string | null;
  nextNodeSequence: number;
  getNodeById: (instanceId: string) => EditorGraphNode | undefined;
  getGraphSnapshot: () => {
    nodes: EditorGraphNode[];
    edges: EditorGraphEdge[];
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
  };
  setDocumentMetadata: (metadata: {
    name: string;
    description?: string;
    schedulerId?: string;
    studioPanels?: StudioPanelSpec[];
    studioVariables?: StudioVariable[];
    studioLayout?: StudioLayoutSpec;
    studioPlotPalettes?: StudioPlotPaletteSpec[];
    application?: ApplicationSpec;
  }) => void;
  setStudioPanels: (panels: StudioPanelSpec[]) => void;
  setDocumentSchedulerId: (schedulerId?: string) => void;
  setStudioVariables: (variables: StudioVariable[]) => void;
  setStudioPlotPalettes: (palettes: StudioPlotPaletteSpec[]) => void;
  setStudioLayout: (layout: StudioLayoutSpec) => void;
  setApplication: (application: ApplicationSpec | undefined) => void;
  clearGraph: () => void;
  replaceGraph: (input: {
    nodes: EditorGraphNode[];
    edges: EditorGraphEdge[];
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
  }) => void;
  addNodeFromCatalogItem: (block: EditorCatalogBlock, position?: GraphPoint) => void;
  applyFlowNodeChanges: (changes: NodeChange[]) => void;
  applyFlowEdgeChanges: (changes: EdgeChange[]) => void;
  selectNode: (nodeId: string | null) => void;
  setNodePosition: (nodeId: string, position: GraphPoint) => void;
  setNodeExecutionMode: (nodeId: string, executionMode: 'active' | 'disabled' | 'bypassed') => void;
  setNodeRotation: (nodeId: string, rotation: 0 | 90 | 180 | 270) => void;
  removeNode: (nodeId: string) => void;
  addEdge: (input: AddEdgeInput) => void;
  removeEdge: (edgeId: string) => void;
  updateNodeParameter: (instanceId: string, parameterName: string, value: string) => void;
  updateNodeParameters: (instanceId: string, parameterValues: Record<string, string>) => void;
  updateNodeParameterBinding: (instanceId: string, parameterName: string, binding: ExpressionBinding) => void;
  updateNodeParameterBindings: (instanceId: string, parameterValues: Record<string, ExpressionBinding>) => void;
  ensureNodeParametersInitialized: (instanceId: string, blockDetails: BlockDetails) => void;
  addVariable: (input?: { name?: string; binding?: ExpressionBinding }) => string;
  updateVariable: (variableId: string, patch: Partial<Pick<StudioVariable, 'name' | 'binding'>>) => void;
  removeVariable: (variableId: string) => void;
  copyNodesToClipboard: (nodeIds: readonly string[]) => void;
  pasteClipboard: () => { nodeIds: string[] } | null;
};

export const useEditorStore = create<EditorState>((set, get) => ({
  nodes: [],
  edges: [],
  documentName: 'Untitled Graph',
  documentDescription: undefined,
  schedulerId: undefined,
  studioPanels: undefined,
  studioVariables: undefined,
  studioLayout: undefined,
  studioPlotPalettes: undefined,
  application: undefined,
  clipboard: null,
  clipboardPasteSequence: 0,
  selectedNodeId: null,
  nextNodeSequence: 1,
  getNodeById: (instanceId) => {
    return get().nodes.find((node) => node.instanceId === instanceId);
  },
  getGraphSnapshot: () => {
    const state = get();
    return {
      nodes: state.nodes,
      edges: state.edges,
      metadata: {
        name: state.documentName,
        description: state.documentDescription,
        schedulerId: state.schedulerId,
        studioPanels: state.studioPanels,
        studioVariables: state.studioVariables,
        studioLayout: state.studioLayout,
        studioPlotPalettes: state.studioPlotPalettes,
        application: state.application,
      },
    };
  },
  setDocumentMetadata: ({ name, description, schedulerId, studioPanels, studioVariables, studioLayout, studioPlotPalettes, application }) => {
    set((state) => ({
      documentName: name,
      documentDescription: description,
      schedulerId: schedulerId ?? state.schedulerId,
      studioPanels: studioPanels ?? state.studioPanels,
      studioVariables: studioVariables ?? state.studioVariables,
      studioLayout: studioLayout ?? state.studioLayout,
      studioPlotPalettes: studioPlotPalettes ?? state.studioPlotPalettes,
      application: application ?? state.application,
    }));
  },
  setStudioPanels: (panels) => {
    set({
      studioPanels: panels,
    });
  },
  setDocumentSchedulerId: (schedulerId) => {
    set({
      schedulerId,
    });
  },
  setStudioVariables: (variables) => {
    set({
      studioVariables: variables,
    });
  },
  setStudioPlotPalettes: (palettes) => {
    set({
      studioPlotPalettes: palettes,
    });
  },
  setStudioLayout: (layout) => {
    set({
      studioLayout: layout,
    });
  },
  setApplication: (application) => {
    set({
      application,
    });
  },
  clearGraph: () => {
    set({
      nodes: [],
      edges: [],
      studioPanels: undefined,
      studioVariables: undefined,
      studioLayout: undefined,
      studioPlotPalettes: undefined,
      application: undefined,
      schedulerId: undefined,
      selectedNodeId: null,
      nextNodeSequence: 1,
    });
  },
  replaceGraph: ({ nodes, edges, metadata }) => {
    const maxSuffix = nodes.reduce((max, node) => {
      const match = node.instanceId.match(/_(\d+)$/);
      if (!match) {
        return max;
      }

      const value = Number.parseInt(match[1], 10);
      return Number.isFinite(value) ? Math.max(max, value) : max;
    }, 0);

    set((state) => ({
      nodes,
      edges,
      documentName: metadata.name,
      documentDescription: metadata.description,
      schedulerId: metadata.schedulerId,
      studioPanels: metadata.studioPanels,
      studioVariables: metadata.studioVariables,
      studioLayout: metadata.studioLayout,
      studioPlotPalettes: metadata.studioPlotPalettes,
      application: metadata.application,
      clipboard: state.clipboard,
      clipboardPasteSequence: state.clipboardPasteSequence,
      selectedNodeId: null,
      nextNodeSequence: Math.max(maxSuffix + 1, nodes.length + 1, 1),
    }));
  },
  addNodeFromCatalogItem: (block, dropPosition) => {
    const { nextNodeSequence, nodes } = get();
    const position = dropPosition ?? getNextNodePosition(nodes.length);
    const node = createEditorNode(block, nextNodeSequence, position);

    set((state) => ({
      nodes: [...state.nodes, node],
      selectedNodeId: node.instanceId,
      nextNodeSequence: state.nextNodeSequence + 1,
    }));
  },
  applyFlowNodeChanges: (changes) => {
    if (changes.length === 0) {
      return;
    }

    set((state) => {
      const removedNodeIds = new Set<string>();
      const positionByNodeId = new Map<string, GraphPoint>();
      let nextSelectedNodeId = state.selectedNodeId;
      let selectionTouched = false;

      changes.forEach((change) => {
        if (change.type === 'remove') {
          removedNodeIds.add(change.id);
          if (nextSelectedNodeId === change.id) {
            nextSelectedNodeId = null;
            selectionTouched = true;
          }
          return;
        }

        if (change.type === 'position') {
          const nextPosition =
            change.position ??
            ((change as NodeChange & { positionAbsolute?: GraphPoint }).positionAbsolute ?? null);
          if (nextPosition) {
            positionByNodeId.set(change.id, nextPosition);
          }
          return;
        }

        if (change.type === 'select') {
          selectionTouched = true;
          if (change.selected) {
            nextSelectedNodeId = change.id;
          } else if (nextSelectedNodeId === change.id) {
            nextSelectedNodeId = null;
          }
        }
      });

      let nodesChanged = false;
      const nextNodes = state.nodes
        .filter((node) => {
          const keep = !removedNodeIds.has(node.instanceId);
          if (!keep) {
            nodesChanged = true;
          }
          return keep;
        })
        .map((node) => {
          const nextPosition = positionByNodeId.get(node.instanceId);
          if (!nextPosition) {
            return node;
          }
          if (node.position.x === nextPosition.x && node.position.y === nextPosition.y) {
            return node;
          }
          nodesChanged = true;
          return {
            ...node,
            position: {
              x: nextPosition.x,
              y: nextPosition.y,
            },
          };
        });

      let edgesChanged = false;
      const nextEdges = removedNodeIds.size > 0
        ? state.edges.filter((edge) => {
            const keep = !removedNodeIds.has(edge.sourceInstanceId) && !removedNodeIds.has(edge.targetInstanceId);
            if (!keep) {
              edgesChanged = true;
            }
            return keep;
          })
        : state.edges;

      const selectionChanged = selectionTouched && nextSelectedNodeId !== state.selectedNodeId;
      if (!nodesChanged && !edgesChanged && !selectionChanged) {
        return state;
      }

      return {
        nodes: nextNodes,
        edges: nextEdges,
        selectedNodeId: nextSelectedNodeId,
      };
    });
  },
  applyFlowEdgeChanges: (changes) => {
    if (changes.length === 0) {
      return;
    }

    const removedEdgeIds = new Set(changes.filter((change) => change.type === 'remove').map((change) => change.id));
    if (removedEdgeIds.size === 0) {
      return;
    }

    set((state) => {
      const nextEdges = state.edges.filter((edge) => !removedEdgeIds.has(edge.id));
      if (nextEdges.length === state.edges.length) {
        return state;
      }
      return {
        edges: nextEdges,
      };
    });
  },
  selectNode: (nodeId) => {
    set({ selectedNodeId: nodeId });
  },
  setNodePosition: (nodeId, position) => {
    set((state) => ({
      nodes: state.nodes.map((node) =>
        node.instanceId === nodeId ? { ...node, position: { ...position } } : node,
      ),
    }));
  },
  setNodeExecutionMode: (nodeId, executionMode) => {
    set((state) => ({
      nodes: state.nodes.map((node) =>
        node.instanceId === nodeId
          ? {
              ...node,
              executionMode,
            }
          : node,
      ),
    }));
  },
  setNodeRotation: (nodeId, rotation) => {
    set((state) => ({
      nodes: state.nodes.map((node) =>
        node.instanceId === nodeId
          ? {
              ...node,
              rotation,
            }
          : node,
      ),
    }));
  },
  removeNode: (nodeId) => {
    set((state) => ({
      nodes: state.nodes.filter((node) => node.instanceId !== nodeId),
      edges: state.edges.filter(
        (edge) => edge.sourceInstanceId !== nodeId && edge.targetInstanceId !== nodeId,
      ),
      selectedNodeId: state.selectedNodeId === nodeId ? null : state.selectedNodeId,
    }));
  },
  addEdge: ({ sourceInstanceId, targetInstanceId, sourcePort, targetPort }) => {
    if (sourceInstanceId === targetInstanceId) {
      return;
    }

    const edgeId = createEdgeId(sourceInstanceId, targetInstanceId, sourcePort, targetPort);

    set((state) => {
      const duplicateExists = state.edges.some((edge) => edge.id === edgeId);
      if (duplicateExists) {
        return state;
      }

      const edge: EditorGraphEdge = {
        id: edgeId,
        sourceInstanceId,
        targetInstanceId,
        sourcePort,
        targetPort,
      };

      return {
        edges: [...state.edges, edge],
      };
    });
  },
  removeEdge: (edgeId) => {
    set((state) => ({
      edges: state.edges.filter((edge) => edge.id !== edgeId),
    }));
  },
  updateNodeParameter: (instanceId, parameterName, value) => {
    set((state) => ({
      nodes: state.nodes.map((node) => {
        if (node.instanceId !== instanceId) {
          return node;
        }

        return {
          ...node,
          parameters: {
            ...node.parameters,
            [parameterName]: { value, bindingKind: 'literal' },
          },
        };
      }),
    }));
  },
  updateNodeParameters: (instanceId, parameterValues) => {
    const parameters: EditorNodeParameterDrafts = Object.entries(parameterValues).reduce(
      (acc, [name, value]) => {
        acc[name] = { value, bindingKind: 'literal' };
        return acc;
      },
      {} as EditorNodeParameterDrafts,
    );

    set((state) => ({
      nodes: state.nodes.map((node) => {
        if (node.instanceId !== instanceId) {
          return node;
        }

        return {
          ...node,
          parameters,
        };
      }),
    }));
  },
  updateNodeParameterBinding: (instanceId, parameterName, binding) => {
    set((state) => ({
      nodes: state.nodes.map((node) => {
        if (node.instanceId !== instanceId) {
          return node;
        }

        return {
          ...node,
          parameters: {
            ...node.parameters,
            [parameterName]:
              binding.kind === 'literal'
                ? { value: String(binding.value), bindingKind: 'literal' }
                : { value: binding.expr, bindingKind: 'expression' },
          },
        };
      }),
    }));
  },
  updateNodeParameterBindings: (instanceId, parameterValues) => {
    set((state) => ({
      nodes: state.nodes.map((node) => {
        if (node.instanceId !== instanceId) {
          return node;
        }

        const nextParameters: EditorNodeParameterDrafts = {
          ...node.parameters,
        };

        Object.entries(parameterValues).forEach(([name, binding]) => {
          nextParameters[name] =
            binding.kind === 'literal'
              ? { value: String(binding.value), bindingKind: 'literal' }
              : { value: binding.expr, bindingKind: 'expression' };
        });

        return {
          ...node,
          parameters: nextParameters,
        };
      }),
    }));
  },
  ensureNodeParametersInitialized: (instanceId, blockDetails) => {
    set((state) => ({
      nodes: state.nodes.map((node) => {
        if (node.instanceId !== instanceId) {
          return node;
        }

        if (Object.keys(node.parameters).length > 0) {
          return node;
        }

        return {
          ...node,
          parameters: buildInitialParameterDrafts(blockDetails),
        };
        }),
    }));
  },
  addVariable: (input) => {
    let createdId = '';
    set((state) => {
      const variables = state.studioVariables ?? [];
      const existingNames = new Set(variables.map((variable) => variable.name));
      const nextName =
        input?.name !== undefined
          ? createUniqueVariableName(existingNames, input.name)
          : createNextVariableName(existingNames);

      createdId = `variable-${variables.length + 1}`;
      return {
        studioVariables: [
          ...variables,
          {
            id: createdId,
            name: nextName,
            binding: input?.binding ?? { kind: 'literal', value: 0 },
          },
        ],
      };
    });
    return createdId;
  },
  updateVariable: (variableId, patch) => {
    set((state) => {
      const variables = state.studioVariables ?? [];
      const index = variables.findIndex((variable) => variable.id === variableId);
      if (index < 0) {
        return state;
      }

      const current = variables[index];
      const desiredName = (patch.name ?? current.name).trim() || current.name;
      const namesInUse = new Set(variables.filter((variable) => variable.id !== variableId).map((variable) => variable.name));
      const nextName = createUniqueVariableName(namesInUse, desiredName);

      const nextVariables = [...variables];
      nextVariables[index] = {
        ...current,
        ...patch,
        name: nextName,
      };

      return {
        studioVariables: nextVariables,
      };
    });
  },
  removeVariable: (variableId) => {
    set((state) => ({
      studioVariables: (state.studioVariables ?? []).filter((variable) => variable.id !== variableId),
    }));
  },
  copyNodesToClipboard: (nodeIds) => {
    set((state) => {
      const clipboard = buildGraphClipboardPayload(state.nodes, state.edges, nodeIds);
      if (!clipboard) {
        return {};
      }

      return {
        clipboard,
      };
    });
  },
  pasteClipboard: () => {
    const state = get();
    if (!state.clipboard) {
      return null;
    }

    const pasted = pasteGraphClipboardPayload(state.clipboard, {
      existingNodeIds: state.nodes.map((node) => node.instanceId),
      pasteSequence: state.clipboardPasteSequence,
    });

    if (pasted.nodes.length === 0) {
      return null;
    }

    set((current) => ({
      nodes: [...current.nodes, ...pasted.nodes],
      edges: [...current.edges, ...pasted.edges],
      selectedNodeId: pasted.selectedNodeIds[0] ?? current.selectedNodeId,
      clipboardPasteSequence: current.clipboardPasteSequence + 1,
    }));

    return { nodeIds: pasted.selectedNodeIds };
  },
}));
