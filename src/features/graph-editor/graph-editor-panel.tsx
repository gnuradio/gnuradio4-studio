import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQueries } from '@tanstack/react-query';
import {
  applyNodeChanges,
  Background,
  ReactFlow,
  SelectionMode,
  useReactFlow,
  type Connection,
  type Edge,
  type EdgeChange,
  type Node,
  type NodeChange,
  type OnNodeDrag,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { getBlockDetails, type BlockDetails } from '../../lib/api/block-details';
import { useBlockCatalogQuery } from '../block-catalog/hooks/use-block-catalog-query';
import { normalizeTypeName } from '../ports/model/typeColors';
import { resolveRenderedPorts } from '../ports/model/resolveRenderedPorts';
import type { RenderedPort, SchemaPort } from '../ports/model/types';
import type { EditorGraphEdge, EditorGraphNode, FlowNodeData } from './model/types';
import { getNodeExecutionMode, isLinearBypassableBlock } from './model/node-execution';
import { rotateNodeRotation } from './model/node-rotation';
import {
  getVirtualRoutingBlockDetails,
  getVirtualRoutingCatalogBlocks,
  isNoteBlockType,
  isVirtualRoutingBlockType,
} from './model/virtual-routing';
import {
  buildBlockCardSummary,
  toCanonicalBlockDisplayName,
  toShortBlockName,
} from './model/presentation';
import { useEditorStore } from './store/editorStore';
import { GraphNode } from './graph-node';
import { isHttpTimeSeriesSink } from './runtime/http-time-series';

const nodeTypes = {
  gr4Node: GraphNode,
};

type FlowGraphNode = Node<FlowNodeData>;

function GraphCanvasControls() {
  const reactFlow = useReactFlow();

  return (
    <div className="absolute bottom-3 left-3 z-20 overflow-hidden rounded-xl border border-slate-700/80 bg-slate-950/90 p-0.5 shadow-[0_10px_30px_rgba(0,0,0,0.28)] backdrop-blur">
      <div className="flex flex-col gap-1">
        <button
          type="button"
          title="Zoom in"
          onClick={() => reactFlow.zoomIn({ duration: 160 })}
          className="flex h-7 w-7 items-center justify-center rounded-lg border border-slate-700 bg-slate-900 text-slate-100 transition-colors hover:border-slate-500 hover:bg-slate-800"
        >
          <span className="text-sm leading-none">+</span>
        </button>
        <button
          type="button"
          title="Zoom out"
          onClick={() => reactFlow.zoomOut({ duration: 160 })}
          className="flex h-7 w-7 items-center justify-center rounded-lg border border-slate-700 bg-slate-900 text-slate-100 transition-colors hover:border-slate-500 hover:bg-slate-800"
        >
          <span className="text-sm leading-none">−</span>
        </button>
        <button
          type="button"
          title="Fit view"
          onClick={() => {
            void reactFlow.fitView({ duration: 180, padding: 0.2 });
          }}
          className="flex h-7 w-7 items-center justify-center rounded-lg border border-slate-700 bg-slate-900 text-slate-100 transition-colors hover:border-slate-500 hover:bg-slate-800"
        >
          <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" aria-hidden="true">
            <path
              fill="currentColor"
              d="M3 2.5A.5.5 0 0 0 2.5 3v2a.5.5 0 0 0 1 0V3.5H5a.5.5 0 0 0 0-1H3Zm8 0a.5.5 0 0 0 0 1h1.5V5a.5.5 0 0 0 1 0V3a.5.5 0 0 0-.5-.5H11ZM2.5 11v2A.5.5 0 0 0 3 13.5h2a.5.5 0 0 0 0-1H3.5V11a.5.5 0 0 0-1 0Zm11 0v1.5H12a.5.5 0 0 0 0 1h2a.5.5 0 0 0 .5-.5v-2a.5.5 0 0 0-1 0ZM5.25 5.25l-.94-.94A.5.5 0 0 0 3.5 4.66l.94.94a.5.5 0 1 0 .71-.71Zm5.5 0a.5.5 0 0 0 .71.71l.94-.94a.5.5 0 1 0-.71-.71l-.94.94ZM4.67 12.5l-.94.94a.5.5 0 1 0 .71.71l.94-.94a.5.5 0 1 0-.71-.71Zm6.66 0a.5.5 0 0 0-.71.71l.94.94a.5.5 0 1 0 .71-.71l-.94-.94Z"
            />
          </svg>
        </button>
      </div>
    </div>
  );
}

function toSchemaPorts(details: BlockDetails): SchemaPort[] {
  return [...details.inputPorts, ...details.outputPorts]
    .filter((port) => port.direction === 'input' || port.direction === 'output')
    .map((port) => ({
      name: port.name,
      direction: port.direction as 'input' | 'output',
      cardinalityKind: port.cardinalityKind,
      isExplicitDynamicCollection: port.isExplicitDynamicCollection,
      currentPortCount: port.currentPortCount,
      renderPortCount: port.renderPortCount,
      minPortCount: port.minPortCount,
      maxPortCount: port.maxPortCount,
      sizeParameter: port.sizeParameter,
      handleNameTemplate: port.handleNameTemplate,
      typeName: port.valueType,
      isOptional: port.isOptional,
      description: port.description,
    }));
}

function toFlowNodeData(
  node: EditorGraphNode,
  openRuntimeVisualizationId: string | null,
  onOpenRuntimeVisualization: (instanceId: string) => void,
  onCloseRuntimeVisualization: () => void,
  missingFromCatalog: boolean,
  fallbackRenderedPorts: { inputs: RenderedPort[]; outputs: RenderedPort[] },
  blockDetails?: BlockDetails,
  shortDisplayNameOverride?: string,
): FlowGraphNode {
  const parameterValues = Object.entries(node.parameters).reduce<Record<string, string>>(
    (acc, [name, entry]) => {
      acc[name] = entry.value;
      return acc;
    },
    {},
  );

  const resolvedPorts = blockDetails
    ? resolveRenderedPorts({
        schemaPorts: toSchemaPorts(blockDetails),
        parameterValues,
      })
    : fallbackRenderedPorts;
  const cardSummary = buildBlockCardSummary(node, blockDetails);
  const supportsRuntimeVisualization = isHttpTimeSeriesSink(node.blockTypeId);
  const executionMode = getNodeExecutionMode(node.executionMode);
  const rotation = node.rotation ?? 0;

  return {
    id: node.instanceId,
    type: 'gr4Node',
    position: node.position,
    selected: false,
    data: {
      instanceId: node.instanceId,
      blockTypeId: node.blockTypeId,
      displayName: toCanonicalBlockDisplayName(node.displayName, node.blockTypeId),
      shortDisplayName: shortDisplayNameOverride ?? cardSummary.shortDisplayName,
      missingFromCatalog,
      category: node.category,
      executionMode,
      rotation,
      parameterValues,
      parameterLines: cardSummary.parameterLines,
      parameterOverflowCount: cardSummary.parameterOverflowCount,
      renderedInputPorts: resolvedPorts.inputs,
      renderedOutputPorts: resolvedPorts.outputs,
      isVirtualRouting: isVirtualRoutingBlockType(node.blockTypeId),
      isNote: isNoteBlockType(node.blockTypeId),
      supportsRuntimeVisualization,
      isRuntimeVisualizationOpen: supportsRuntimeVisualization && openRuntimeVisualizationId === node.instanceId,
      onOpenRuntimeVisualization,
      onCloseRuntimeVisualization,
    },
  };
}

function toFlowEdge(edge: EditorGraphEdge): Edge {
  return {
    id: edge.id,
    source: edge.sourceInstanceId,
    target: edge.targetInstanceId,
    sourceHandle: edge.sourcePort,
    targetHandle: edge.targetPort,
    animated: false,
  };
}

type NodePortTypeMap = {
  inputTypes: Map<string, string | undefined>;
  outputTypes: Map<string, string | undefined>;
  inputHandleIdsByPortId: Map<string, string>;
  outputHandleIdsByPortId: Map<string, string>;
  inputPortIdsByHandleId: Map<string, string>;
  outputPortIdsByHandleId: Map<string, string>;
};

function toReactFlowHandleId(portId: string): string {
  const safeToken = Array.from(portId)
    .map((char) => (/^[A-Za-z0-9_-]$/.test(char) ? char : `_${char.codePointAt(0)?.toString(16)}_`))
    .join('');

  return `handle_${safeToken}`;
}

function buildNodePortTypeMap(nodes: Node<FlowNodeData>[]): Map<string, NodePortTypeMap> {
  return new Map(
    nodes.map((node) => [
      node.id,
      {
        inputTypes: new Map(
          node.data.renderedInputPorts
            .filter((port) => typeof port.portId === 'string')
            .map((port) => [port.portId as string, port.typeName]),
        ),
        inputHandleIdsByPortId: new Map(
          node.data.renderedInputPorts
            .filter((port) => typeof port.portId === 'string')
            .map((port) => [port.portId as string, port.handleId ?? port.portId ?? '']),
        ),
        inputPortIdsByHandleId: new Map(
          node.data.renderedInputPorts
            .filter((port) => typeof port.portId === 'string')
            .map((port) => [port.handleId ?? port.portId ?? '', port.portId as string]),
        ),
        outputTypes: new Map(
          node.data.renderedOutputPorts
            .filter((port) => typeof port.portId === 'string')
            .map((port) => [port.portId as string, port.typeName]),
        ),
        outputHandleIdsByPortId: new Map(
          node.data.renderedOutputPorts
            .filter((port) => typeof port.portId === 'string')
            .map((port) => [port.portId as string, port.handleId ?? port.portId ?? '']),
        ),
        outputPortIdsByHandleId: new Map(
          node.data.renderedOutputPorts
            .filter((port) => typeof port.portId === 'string')
            .map((port) => [port.handleId ?? port.portId ?? '', port.portId as string]),
        ),
      },
    ]),
  );
}

function arePortTypesMismatched(sourceType?: string, targetType?: string): boolean {
  const source = normalizeTypeName(sourceType);
  const target = normalizeTypeName(targetType);

  if (!source || !target) {
    return false;
  }

  if (source === 'wildcard' || target === 'wildcard') {
    return false;
  }

  return source !== target;
}

function toStyledFlowEdge(
  edge: EditorGraphEdge,
  nodePortTypeMap: Map<string, NodePortTypeMap>,
): Edge {
  const sourceNodePorts = nodePortTypeMap.get(edge.sourceInstanceId);
  const targetNodePorts = nodePortTypeMap.get(edge.targetInstanceId);
  const sourceType = edge.sourcePort ? sourceNodePorts?.outputTypes.get(edge.sourcePort) : undefined;
  const targetType = edge.targetPort ? targetNodePorts?.inputTypes.get(edge.targetPort) : undefined;
  const sourceHandle = edge.sourcePort ? sourceNodePorts?.outputHandleIdsByPortId.get(edge.sourcePort) : undefined;
  const targetHandle = edge.targetPort ? targetNodePorts?.inputHandleIdsByPortId.get(edge.targetPort) : undefined;
  const isMismatched = arePortTypesMismatched(sourceType, targetType);

  return {
    ...toFlowEdge({
      ...edge,
      sourcePort: sourceHandle ?? edge.sourcePort,
      targetPort: targetHandle ?? edge.targetPort,
    }),
    style: isMismatched
      ? {
          stroke: '#ff2d2d',
          strokeWidth: 3,
        }
      : undefined,
    animated: isMismatched,
  };
}

function buildFallbackRenderedPort(portId: string, direction: 'input' | 'output'): RenderedPort {
  return {
    key: `${direction}:${portId}:fallback`,
    direction,
    displayLabel: portId,
    portId,
    handleId: toReactFlowHandleId(portId),
    sourceSchemaName: portId,
    cardinalityKind: 'fixed',
    inference: 'inferred',
    connectable: true,
  };
}

function buildFallbackPortMap(edges: EditorGraphEdge[]): Map<string, { inputs: RenderedPort[]; outputs: RenderedPort[] }> {
  const inputIdsByNode = new Map<string, Set<string>>();
  const outputIdsByNode = new Map<string, Set<string>>();

  edges.forEach((edge) => {
    if (edge.targetPort) {
      if (!inputIdsByNode.has(edge.targetInstanceId)) {
        inputIdsByNode.set(edge.targetInstanceId, new Set());
      }
      inputIdsByNode.get(edge.targetInstanceId)?.add(edge.targetPort);
    }
    if (edge.sourcePort) {
      if (!outputIdsByNode.has(edge.sourceInstanceId)) {
        outputIdsByNode.set(edge.sourceInstanceId, new Set());
      }
      outputIdsByNode.get(edge.sourceInstanceId)?.add(edge.sourcePort);
    }
  });

  const nodeIds = new Set([...inputIdsByNode.keys(), ...outputIdsByNode.keys()]);
  return new Map(
    Array.from(nodeIds).map((nodeId) => [
      nodeId,
      {
        inputs: Array.from(inputIdsByNode.get(nodeId) ?? []).map((portId) => buildFallbackRenderedPort(portId, 'input')),
        outputs: Array.from(outputIdsByNode.get(nodeId) ?? []).map((portId) => buildFallbackRenderedPort(portId, 'output')),
      },
    ]),
  );
}

function mergeFlowNodes(current: FlowGraphNode[], next: FlowGraphNode[]): FlowGraphNode[] {
  const currentById = new Map(current.map((node) => [node.id, node]));

    return next.map((node) => {
      const previous = currentById.get(node.id);
      if (!previous) {
        return node;
      }

    // Preserve React Flow-managed internals like measured dimensions while refreshing semantic data.
      return {
        ...previous,
        ...node,
        position: node.position,
        selected: previous.selected,
        data: node.data,
      };
    });
  }

function buildStoreNodeSignature(nodes: EditorGraphNode[]): string {
  return JSON.stringify(
    nodes.map((node) => ({
      id: node.instanceId,
      position: node.position,
      displayName: node.displayName,
      blockTypeId: node.blockTypeId,
      category: node.category ?? null,
      executionMode: node.executionMode ?? 'active',
      rotation: node.rotation ?? 0,
      parameters: node.parameters,
    })),
  );
}

function buildRenderedNodeSignature(nodes: FlowGraphNode[]): string {
  return JSON.stringify(
    nodes.map((node) => ({
      id: node.id,
      displayName: node.data.displayName,
      shortDisplayName: node.data.shortDisplayName,
      missingFromCatalog: node.data.missingFromCatalog,
      inputPorts: node.data.renderedInputPorts.map((port) => ({
        key: port.key,
        portId: port.portId ?? null,
        handleId: port.handleId ?? null,
        typeName: port.typeName ?? null,
        connectable: port.connectable,
      })),
      outputPorts: node.data.renderedOutputPorts.map((port) => ({
        key: port.key,
        portId: port.portId ?? null,
        handleId: port.handleId ?? null,
        typeName: port.typeName ?? null,
        connectable: port.connectable,
      })),
      parameterLines: node.data.parameterLines,
      parameterOverflowCount: node.data.parameterOverflowCount,
      executionMode: node.data.executionMode,
      rotation: node.data.rotation,
      runtimeOpen: node.data.isRuntimeVisualizationOpen,
    })),
  );
}

type GraphEditorPanelProps = {
  onOpenBlockProperties: (instanceId: string) => void;
  isBlockPropertiesOpen: boolean;
};

export function GraphEditorPanel({
  onOpenBlockProperties,
  isBlockPropertiesOpen,
}: GraphEditorPanelProps) {
  const blockCatalogQuery = useBlockCatalogQuery();
  const editorNodes = useEditorStore((state) => state.nodes);
  const editorEdges = useEditorStore((state) => state.edges);
  const selectedNodeId = useEditorStore((state) => state.selectedNodeId);
  const applyFlowNodeChanges = useEditorStore((state) => state.applyFlowNodeChanges);
  const applyFlowEdgeChanges = useEditorStore((state) => state.applyFlowEdgeChanges);
  const selectNode = useEditorStore((state) => state.selectNode);
  const setNodePosition = useEditorStore((state) => state.setNodePosition);
  const setNodeExecutionMode = useEditorStore((state) => state.setNodeExecutionMode);
  const addEdge = useEditorStore((state) => state.addEdge);
  const removeEdge = useEditorStore((state) => state.removeEdge);
  const copyNodesToClipboard = useEditorStore((state) => state.copyNodesToClipboard);
  const pasteClipboard = useEditorStore((state) => state.pasteClipboard);
  const [openRuntimeVisualizationId, setOpenRuntimeVisualizationId] = useState<string | null>(null);

  const onOpenRuntimeVisualization = useCallback((instanceId: string) => {
    setOpenRuntimeVisualizationId(instanceId);
  }, []);

  const onCloseRuntimeVisualization = useCallback(() => {
    setOpenRuntimeVisualizationId(null);
  }, []);

  const uniqueBlockTypes = useMemo(
    () => Array.from(new Set(editorNodes.map((node) => node.blockTypeId))),
    [editorNodes],
  );
  const blockDetailQueries = useQueries({
    queries: uniqueBlockTypes.map((blockTypeId) => ({
      queryKey: ['block-details', blockTypeId],
      queryFn: () => {
        const virtualDetails = getVirtualRoutingBlockDetails(blockTypeId);
        return virtualDetails ? Promise.resolve(virtualDetails) : getBlockDetails(blockTypeId);
      },
      staleTime: 60_000,
    })),
  });
  const blockDetailsByType = useMemo(() => {
    const map = new Map<string, BlockDetails>();
    uniqueBlockTypes.forEach((blockTypeId, index) => {
      const query = blockDetailQueries[index];
      if (query?.data) {
        map.set(blockTypeId, query.data);
      }
    });
    return map;
  }, [blockDetailQueries, uniqueBlockTypes]);
  const catalogBlockTypeIds = useMemo(() => {
    return new Set([
      ...getVirtualRoutingCatalogBlocks().map((block) => block.blockTypeId),
      ...(blockCatalogQuery.data ?? []).map((block) => block.blockTypeId),
    ]);
  }, [blockCatalogQuery.data]);
  const hasResolvedCatalog = blockCatalogQuery.isSuccess;
  const fallbackPortsByNodeId = useMemo(() => buildFallbackPortMap(editorEdges), [editorEdges]);

  const nodes = useMemo(
    () => {
      return editorNodes.map((block) => {
        return toFlowNodeData(
          block,
          openRuntimeVisualizationId,
          onOpenRuntimeVisualization,
          onCloseRuntimeVisualization,
          hasResolvedCatalog && !catalogBlockTypeIds.has(block.blockTypeId),
          fallbackPortsByNodeId.get(block.instanceId) ?? { inputs: [], outputs: [] },
          blockDetailsByType.get(block.blockTypeId),
          toShortBlockName(block.displayName, block.blockTypeId),
        );
      });
    },
    [
      blockDetailsByType,
      catalogBlockTypeIds,
      editorNodes,
      fallbackPortsByNodeId,
      hasResolvedCatalog,
      onCloseRuntimeVisualization,
      onOpenRuntimeVisualization,
      openRuntimeVisualizationId,
    ],
  );
  const nodePortTypeMap = useMemo(() => buildNodePortTypeMap(nodes), [nodes]);
  const flowEdges = useMemo(
    () => editorEdges.map((edge) => toStyledFlowEdge(edge, nodePortTypeMap)),
    [editorEdges, nodePortTypeMap],
  );
  const storeNodeSignature = useMemo(() => buildStoreNodeSignature(editorNodes), [editorNodes]);
  const renderedNodeSignature = useMemo(() => buildRenderedNodeSignature(nodes), [nodes]);
  const [flowNodes, setFlowNodes] = useState<FlowGraphNode[]>(nodes);
  const latestSemanticNodesRef = useRef(nodes);
  const latestFlowNodesRef = useRef(flowNodes);
  const pendingPasteSelectionRef = useRef<string[] | null>(null);
  const selectedFlowNodeIds = useMemo(
    () => flowNodes.filter((node) => node.selected).map((node) => node.id),
    [flowNodes],
  );

  useEffect(() => {
    // Keep the most recent semantic node payload available without forcing a local-flow reset every render.
    latestSemanticNodesRef.current = nodes;
  }, [nodes]);

  useEffect(() => {
    // Merge persisted graph changes and async-rendered node metadata into the local React Flow nodes.
    setFlowNodes((current) => mergeFlowNodes(current, latestSemanticNodesRef.current));
  }, [renderedNodeSignature, storeNodeSignature]);

  useEffect(() => {
    latestFlowNodesRef.current = flowNodes;
  }, [flowNodes]);

  useEffect(() => {
    const pendingSelection = pendingPasteSelectionRef.current;
    if (!pendingSelection) {
      return;
    }

    const selectedIds = new Set(pendingSelection);
    setFlowNodes((current) => current.map((node) => ({ ...node, selected: selectedIds.has(node.id) })));
    pendingPasteSelectionRef.current = null;
  }, [editorNodes, editorEdges]);

  const onNodesChange = useCallback(
    (changes: NodeChange<FlowGraphNode>[]) => {
      setFlowNodes((current) => applyNodeChanges(changes, current));

      const persistedChanges = changes.filter((change) => change.type === 'remove');
      if (persistedChanges.length > 0) {
        applyFlowNodeChanges(persistedChanges as NodeChange[]);
      }
    },
    [applyFlowNodeChanges],
  );

  const onSelectionChange = useCallback(
    ({ nodes: selectedNodes }: { nodes: FlowGraphNode[] }) => {
      selectNode(selectedNodes[selectedNodes.length - 1]?.id ?? null);
    },
    [selectNode],
  );

  const getTargetNodeIds = useCallback(() => {
    return selectedFlowNodeIds.length > 0 ? selectedFlowNodeIds : selectedNodeId ? [selectedNodeId] : [];
  }, [selectedFlowNodeIds, selectedNodeId]);

  const setNodeRotation = useEditorStore((state) => state.setNodeRotation);

  const isBypassableNodeId = useCallback(
    (nodeId: string) => {
      const flowNode = latestFlowNodesRef.current.find((entry) => entry.id === nodeId);
      if (flowNode) {
        return flowNode.data.renderedInputPorts.length === 1 && flowNode.data.renderedOutputPorts.length === 1;
      }

      const node = editorNodes.find((entry) => entry.instanceId === nodeId);
      return isLinearBypassableBlock(blockDetailsByType.get(node?.blockTypeId ?? ''));
    },
    [blockDetailsByType, editorNodes],
  );

  const onConnect = useCallback(
    (connection: Connection) => {
      if (!connection.source || !connection.target) {
        return;
      }

      const sourceNodePorts = nodePortTypeMap.get(connection.source);
      const targetNodePorts = nodePortTypeMap.get(connection.target);
      const sourcePort =
        (connection.sourceHandle && sourceNodePorts?.outputPortIdsByHandleId.get(connection.sourceHandle)) ||
        connection.sourceHandle ||
        undefined;
      const targetPort =
        (connection.targetHandle && targetNodePorts?.inputPortIdsByHandleId.get(connection.targetHandle)) ||
        connection.targetHandle ||
        undefined;

      addEdge({
        sourceInstanceId: connection.source,
        targetInstanceId: connection.target,
        sourcePort,
        targetPort,
      });
    },
    [addEdge, nodePortTypeMap],
  );

  const onEdgesChange = useCallback(
    (changes: EdgeChange[]) => {
      applyFlowEdgeChanges(changes);
    },
    [applyFlowEdgeChanges],
  );

  const onNodeDragStop = useCallback<OnNodeDrag<FlowGraphNode>>(
    (_event, node) => {
      const idsToPersist = selectedFlowNodeIds.length > 0 ? selectedFlowNodeIds : [node.id];
      const currentNodesById = new Map(latestFlowNodesRef.current.map((entry) => [entry.id, entry]));

      idsToPersist.forEach((id) => {
        const current = currentNodesById.get(id);
        if (current) {
          setNodePosition(id, current.position);
        }
      });
    },
    [selectedFlowNodeIds, setNodePosition],
  );

  useEffect(() => {
    if (!openRuntimeVisualizationId) {
      return;
    }

    const stillExists = editorNodes.some((node) => node.instanceId === openRuntimeVisualizationId);
    if (!stillExists) {
      setOpenRuntimeVisualizationId(null);
    }
  }, [editorNodes, openRuntimeVisualizationId]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isBlockPropertiesOpen) {
        return;
      }

      const target = event.target as HTMLElement | null;
      const isTextInputTarget =
        target?.tagName === 'INPUT' ||
        target?.tagName === 'TEXTAREA' ||
        target?.isContentEditable === true;
      if (isTextInputTarget) {
        return;
      }

      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'c') {
        const nodeIds = getTargetNodeIds();
        if (nodeIds.length === 0) {
          return;
        }
        event.preventDefault();
        copyNodesToClipboard(nodeIds);
        return;
      }

      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'v') {
        const pasted = pasteClipboard();
        if (!pasted) {
          return;
        }
        pendingPasteSelectionRef.current = pasted.nodeIds;
        event.preventDefault();
        return;
      }

      const idsToRemove = getTargetNodeIds();
      if (idsToRemove.length === 0) {
        return;
      }

      if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault();
        setFlowNodes((current) => current.filter((node) => !idsToRemove.includes(node.id)));
        applyFlowNodeChanges(idsToRemove.map((id) => ({ id, type: 'remove' } as NodeChange)));
        return;
      }

      const key = event.key.toLowerCase();
      if (key === 'arrowleft' || key === 'arrowright') {
        const direction = key === 'arrowright' ? 'right' : 'left';
        event.preventDefault();
        idsToRemove.forEach((nodeId) => {
          const node = editorNodes.find((entry) => entry.instanceId === nodeId);
          const currentRotation = node?.rotation ?? 0;
          setNodeRotation(nodeId, rotateNodeRotation(currentRotation, direction));
        });
        return;
      }

      if (key === 'd' || key === 'e' || key === 'b') {
        const bypassableIds = idsToRemove.filter((nodeId) => isBypassableNodeId(nodeId));
        const canBypass = key !== 'b' || bypassableIds.length > 0;

        if (!canBypass) {
          return;
        }

        event.preventDefault();
        idsToRemove.forEach((nodeId) => {
          if (key === 'b') {
            if (!isBypassableNodeId(nodeId)) {
              return;
            }

            const node = editorNodes.find((entry) => entry.instanceId === nodeId);
            const currentMode = getNodeExecutionMode(node?.executionMode);
            setNodeExecutionMode(nodeId, currentMode === 'bypassed' ? 'active' : 'bypassed');
            return;
          }

          setNodeExecutionMode(nodeId, key === 'd' ? 'disabled' : 'active');
        });
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    applyFlowNodeChanges,
    blockDetailsByType,
    copyNodesToClipboard,
    editorNodes,
    getTargetNodeIds,
    isBypassableNodeId,
    isBlockPropertiesOpen,
    pasteClipboard,
    selectedFlowNodeIds,
    selectedNodeId,
    setNodeExecutionMode,
    setNodeRotation,
  ]);

  return (
    <div className="relative h-full w-full">
      <div className="absolute left-3 top-3 z-10 rounded-md border border-slate-700 bg-slate-900/90 px-2 py-1 text-xs text-slate-300">
        Blocks: {editorNodes.length} | Edges: {editorEdges.length}
      </div>

      {editorNodes.length === 0 && (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center">
          <div className="rounded-md border border-dashed border-slate-700 bg-slate-900/80 px-4 py-3 text-sm text-slate-400">
            Add a block from the catalog to start building a graph.
          </div>
        </div>
      )}

      <ReactFlow
        nodes={flowNodes}
        edges={flowEdges}
        nodeTypes={nodeTypes}
        onPaneClick={() => {
          setFlowNodes((current) =>
            current.map((node) =>
              node.selected
                ? {
                    ...node,
                    selected: false,
                  }
                : node,
            ),
          );
          selectNode(null);
        }}
        onNodeDragStop={onNodeDragStop}
        onNodeDoubleClick={(_, node) => {
          selectNode(node.id);
          onOpenBlockProperties(node.id);
        }}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onEdgeDoubleClick={(_, edge) => removeEdge(edge.id)}
        onSelectionChange={onSelectionChange}
        selectionMode={SelectionMode.Partial}
      >
        <Background gap={16} size={1} color="#334155" />
        <GraphCanvasControls />
      </ReactFlow>
    </div>
  );
}
