import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQueries } from '@tanstack/react-query';
import { StatusPill } from '../components/status-pill';
import { StudioMark } from '../components/studio-mark';
import { StatusBadge } from '../components/status-badge';
import { WasmBackendPill } from '../components/wasm-backend-pill';
import { isControlPlaneWasmEnabled } from '../lib/wasm/control-plane-wasm';
import { ApplicationView } from '../features/application/application-view';
import { useAudioSessionStore } from '../features/application/audio/audio-session-store';
import { VariablesView } from '../features/variables/variables-view';
import {
  createDocumentPersistenceService,
  createUntitledDocumentIdentity,
  type PersistenceResult,
  type SourceKind,
} from '../features/document-file/document-persistence-service';
import { serializeEditorSnapshot, STUDIO_UNTITLED_NAME } from '../features/document-file/document-serialization';
import { useDocumentStore } from '../features/document-file/document-store';
import { registerBeforeUnloadUnsavedChangesGuard } from '../features/document-file/unsaved-changes-guard';
import { handleDocumentShortcutKeydown } from '../features/document-file/document-shortcuts';
import {
  buildCapabilityIndicatorText,
  buildDocumentCapabilityDiagnostics,
  buildOpenSuccessMessage,
  buildOpenTooltip,
  buildSaveAsTooltip,
  buildSaveSuccessMessage,
  buildSaveTooltip,
} from '../features/document-file/document-workflow-messaging';
import { dismissUnsupportedBrowserNotice, shouldShowUnsupportedBrowserNotice } from '../features/document-file/unsupported-browser-notice';
import { buildDefaultStudioPlotPalettes } from '../features/application/plotting/model/plot-style';
import { BlockCatalogPanel } from '../features/block-catalog/block-catalog-panel';
import { useBlockCatalogQuery } from '../features/block-catalog/hooks/use-block-catalog-query';
import { BlockPropertiesModal } from '../features/block-properties/block-properties-modal';
import { resolveControlPanelWidgetBindings } from '../features/control-panels/control-panel-binding-resolution';
import { graphDocumentFromEditor } from '../features/graph-document/model/fromEditor';
import {
  applySplitDropToLayout,
  applySplitSizesToLayout,
  type SplitDropPosition,
  type SplitNodePath,
} from '../features/graph-document/model/studio-layout';
import { GraphEditorPanel } from '../features/graph-editor/graph-editor-panel';
import { GraphTabsBar } from '../features/graph-tabs/components/graph-tabs-bar';
import { useGraphTabsStore, type EditorSnapshot } from '../features/graph-tabs/store/graphTabsStore';
import { useEditorStore } from '../features/graph-editor/store/editorStore';
import { getVirtualRoutingBlockDetails } from '../features/graph-editor/model/virtual-routing';
import { InspectorPanel } from '../features/inspector/inspector-panel';
import { GlobalSessionsDrawer } from '../features/runtime-session/components/global-sessions-drawer';
import { resolveCurrentSessionStudioBindingView } from '../features/runtime-session/model/runtime-binding-resolution';
import { useRuntimeSessionStore } from '../features/runtime-session/store/runtimeSessionStore';
import { setBlockSettings } from '../lib/api/block-settings';
import { buildCurrentGraphSubmissionFromEditorSnapshot } from '../features/runtime-submission/model/current-graph-submission';
import { shouldPropagateResolvedRuntimeSetting } from '../features/inspector/runtime-settings-model';
import { WorkspaceView, type WorkspacePanelViewModel } from '../features/workspace/workspace-view';
import { resolveGraphVariables } from '../features/variables/model/resolveGraphVariables';
import { deriveDefaultStudioPanelsFromNodes } from '../features/workspace/model/panel-derivation';
import { buildEffectiveRenderedStudioLayout, shouldShowPanelInRenderedLayout } from '../features/workspace/model/layout';
import { mergeSavedAndDerivedStudioPanels } from '../features/workspace/model/panel-merge';
import { buildDisambiguatedPanelTitles } from '../features/workspace/model/panel-titles';
import {
  addEmptyControlPanelToPanels,
  addControlWidgetToPanels,
  buildControlWidgetSpec,
  renameControlPanelTitle,
  moveControlWidgetInPanel,
  removeControlWidgetFromPanel,
  removeControlWidgetsBoundToVariable,
  moveControlWidgetToPanel,
  updateControlWidgetInputKind,
  updateControlWidgetLabel,
  updateControlWidgetSliderConfig,
} from '../features/control-panels/control-panel-authoring';
import { PlotStyleModal } from '../features/workspace/plot-style-modal';
import type {
  ApplicationMode,
  StudioControlWidgetSliderConfig,
  StudioPlotStyleConfig,
  StudioVariable,
} from '../features/graph-document/model/studio-workspace';
import { getBlockDetails, type BlockDetails } from '../lib/api/block-details';
import type { SessionRecord } from '../lib/api/sessionsApi';
import type { ExpressionBinding } from '../features/variables/model/types';
import { config } from '../lib/config';
import { isDescriptorBasedBindingFamily } from '../features/graph-editor/runtime/studio-managed-runtime-authoring';
import {
  buildDisplayApplicationUrl,
  subscribeToDisplayApplicationCommands,
  writeDisplayApplicationLaunchSnapshot,
} from '../features/application/runtime/display-application-launch';

type ConnectionStatus = 'idle' | 'loading' | 'connected' | 'error';
type CenterViewMode = 'graph' | 'variables' | 'workspace' | 'application';
type LaunchableApplicationMode = Extract<ApplicationMode, 'new_tab' | 'popout'>;
type PendingDestructiveAction = { type: 'close-tab'; tabId: string } | null;

function runButtonTitle(runIntent: 'none' | 'create-session' | 'replace-session-from-edits' | 'start-linked-session'): string {
  if (runIntent === 'create-session') {
    return 'Run: create and start a new session from the current graph';
  }
  if (runIntent === 'replace-session-from-edits') {
    return 'Run: replace the linked session with a new one from the current graph';
  }
  if (runIntent === 'start-linked-session') {
    return 'Run: start the linked session';
  }
  return 'Run / Play';
}

function getConnectionStatus(query: ReturnType<typeof useBlockCatalogQuery>): ConnectionStatus {
  if (query.isError) {
    return 'error';
  }
  if (query.isPending || query.fetchStatus === 'fetching') {
    return 'loading';
  }
  if (query.isSuccess) {
    return 'connected';
  }
  return 'idle';
}

function buildEffectiveParameterValues(
  nodeParameters: Record<string, { value: string }>,
  details?: BlockDetails,
): Record<string, string> {
  if (!details) {
    return Object.entries(nodeParameters).reduce<Record<string, string>>((acc, [name, draft]) => {
      acc[name] = draft.value;
      return acc;
    }, {});
  }

  const fromDefaults = details.parameters.reduce<Record<string, string>>((acc, parameter) => {
    acc[parameter.name] = parameter.defaultValue ?? '';
    return acc;
  }, {});

  Object.entries(nodeParameters).forEach(([name, draft]) => {
    fromDefaults[name] = draft.value;
  });

  return fromDefaults;
}

function stringifyResolvedParameterValue(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }
  return typeof value === 'string' ? value : String(value);
}

function buildResolvedParameterValues(
  parameterValues: Record<string, string>,
  resolvedParameters: ReturnType<typeof resolveGraphVariables>['parametersByNodeId'][string] | undefined,
): Record<string, string> {
  if (!resolvedParameters) {
    return parameterValues;
  }

  const resolvedValues = { ...parameterValues };
  Object.entries(resolvedParameters).forEach(([name, resolvedParameter]) => {
    if (resolvedParameter.state !== 'resolved') {
      return;
    }
    resolvedValues[name] = stringifyResolvedParameterValue(resolvedParameter.value);
  });
  return resolvedValues;
}

function buildNewUntitledSnapshot(): EditorSnapshot {
  return {
    metadata: {
      name: STUDIO_UNTITLED_NAME,
      description: undefined,
      schedulerId: undefined,
      studioPanels: [],
      studioVariables: [],
      studioLayout: undefined,
      studioPlotPalettes: undefined,
      application: undefined,
    },
    nodes: [],
    edges: [],
  };
}

function isPristineUntitledTab(tab: ReturnType<typeof useGraphTabsStore.getState>['tabs'][number]): boolean {
  return tab.document.isUntitled && !tab.document.isDirty && tab.snapshot.nodes.length === 0 && tab.snapshot.edges.length === 0;
}

export function StudioPage() {
  const persistenceService = useMemo(() => createDocumentPersistenceService(), []);
  const blockCatalogQuery = useBlockCatalogQuery();
  const connectionStatus = getConnectionStatus(blockCatalogQuery);

  const [editingBlockId, setEditingBlockId] = useState<string | null>(null);
  const [centerViewByTabId, setCenterViewByTabId] = useState<Record<string, CenterViewMode>>({});
  const [isSessionsDrawerOpen, setIsSessionsDrawerOpen] = useState(false);
  const [plotStyleEditorPanelId, setPlotStyleEditorPanelId] = useState<string | null>(null);
  const [pendingDestructiveAction, setPendingDestructiveAction] = useState<PendingDestructiveAction>(null);
  const [runtimeVariableOverridesByTabId, setRuntimeVariableOverridesByTabId] = useState<
    Record<string, { sessionId: string; valuesByName: Record<string, ExpressionBinding> }>
  >({});
  const [showUnsupportedNotice, setShowUnsupportedNotice] = useState<boolean>(() => {
    if (typeof window === 'undefined') {
      return false;
    }
    return shouldShowUnsupportedBrowserNotice(useDocumentStore.getState().capabilities, window.localStorage);
  });
  const displayLaunchWindowRef = useRef<Window | null>(null);
  const editorBoundTabIdRef = useRef<string | null>(null);
  const pendingEditorLoadRef = useRef<{ tabId: string; contentHash: string } | null>(null);

  const documentName = useEditorStore((state) => state.documentName);
  const documentDescription = useEditorStore((state) => state.documentDescription);
  const schedulerId = useEditorStore((state) => state.schedulerId);
  const studioPanels = useEditorStore((state) => state.studioPanels);
  const studioVariables = useEditorStore((state) => state.studioVariables);
  const studioLayout = useEditorStore((state) => state.studioLayout);
  const studioPlotPalettes = useEditorStore((state) => state.studioPlotPalettes);
  const application = useEditorStore((state) => state.application);
  const addVariable = useEditorStore((state) => state.addVariable);
  const updateVariable = useEditorStore((state) => state.updateVariable);
  const removeVariable = useEditorStore((state) => state.removeVariable);
  const nodes = useEditorStore((state) => state.nodes);
  const edges = useEditorStore((state) => state.edges);
  const replaceGraph = useEditorStore((state) => state.replaceGraph);
  const setStudioLayout = useEditorStore((state) => state.setStudioLayout);
  const setStudioPanels = useEditorStore((state) => state.setStudioPanels);
  const setStudioPlotPalettes = useEditorStore((state) => state.setStudioPlotPalettes);

  const tabs = useGraphTabsStore((state) => state.tabs);
  const activeTabId = useGraphTabsStore((state) => state.activeTabId);
  const initializedTabs = useGraphTabsStore((state) => state.initialized);
  const initializeFromSnapshot = useGraphTabsStore((state) => state.initializeFromSnapshot);
  const createTab = useGraphTabsStore((state) => state.createTab);
  const updateActiveSnapshot = useGraphTabsStore((state) => state.updateActiveSnapshot);
  const updateTabSnapshot = useGraphTabsStore((state) => state.updateTabSnapshot);
  const setTabDocument = useGraphTabsStore((state) => state.setTabDocument);
  const patchTabDocument = useGraphTabsStore((state) => state.patchTabDocument);
  const renameTabDocument = useGraphTabsStore((state) => state.renameTabDocument);
  const setActiveTab = useGraphTabsStore((state) => state.setActiveTab);
  const closeTab = useGraphTabsStore((state) => state.closeTab);

  const ensureTabContext = useRuntimeSessionStore((state) => state.ensureTabContext);
  const removeTabContext = useRuntimeSessionStore((state) => state.removeTabContext);
  const setRuntimeActiveTab = useRuntimeSessionStore((state) => state.setActiveTab);
  const runTab = useRuntimeSessionStore((state) => state.runTab);
  const stopSessionForTab = useRuntimeSessionStore((state) => state.stopSessionForTab);
  const deleteSessionForTab = useRuntimeSessionStore((state) => state.deleteSessionForTab);
  const getTabRuntimeView = useRuntimeSessionStore((state) => state.getTabRuntimeView);
  const runtimeContextsByTabId = useRuntimeSessionStore((state) => state.contextsByTabId);

  const capabilities = useDocumentStore((state) => state.capabilities);
  const isOpening = useDocumentStore((state) => state.isOpening);
  const isSaving = useDocumentStore((state) => state.isSaving);
  const isSaveAsInProgress = useDocumentStore((state) => state.isSaveAsInProgress);
  const documentError = useDocumentStore((state) => state.lastError);
  const documentStatusMessage = useDocumentStore((state) => state.lastStatusMessage);
  const setSaving = useDocumentStore((state) => state.setSaving);
  const setSaveAsInProgress = useDocumentStore((state) => state.setSaveAsInProgress);
  const setOpening = useDocumentStore((state) => state.setOpening);
  const setLastError = useDocumentStore((state) => state.setLastError);
  const setLastStatusMessage = useDocumentStore((state) => state.setLastStatusMessage);

  const activeTab = useMemo(
    () => (activeTabId ? tabs.find((tab) => tab.id === activeTabId) ?? null : null),
    [activeTabId, tabs],
  );

  const currentSnapshot: EditorSnapshot = useMemo(
    () => ({
      metadata: {
        name: documentName,
        description: documentDescription,
        schedulerId,
        studioPanels,
        studioVariables,
        studioLayout,
        studioPlotPalettes,
        application,
      },
      nodes,
      edges,
    }),
    [application, documentDescription, documentName, edges, nodes, schedulerId, studioLayout, studioPanels, studioPlotPalettes, studioVariables],
  );
  const serializedSnapshot = useMemo(() => serializeEditorSnapshot(currentSnapshot), [currentSnapshot]);
  const activeTabSerializedSnapshot = useMemo(
    () => (activeTab ? serializeEditorSnapshot(activeTab.snapshot) : null),
    [activeTab],
  );
  const replaceEditorFromTabSnapshot = useCallback(
    (tabId: string, snapshot: EditorSnapshot) => {
      pendingEditorLoadRef.current = {
        tabId,
        contentHash: serializeEditorSnapshot(snapshot).contentHash,
      };
      editorBoundTabIdRef.current = tabId;
      replaceGraph(snapshot);
      setEditingBlockId(null);
    },
    [replaceGraph],
  );
  const sessionByTabId = useMemo(
    () =>
      Object.fromEntries(
        Object.entries(runtimeContextsByTabId)
          .filter(([, context]) => Boolean(context.sessionId))
          .map(([tabId, context]) => [
            tabId,
            {
              sessionId: context.sessionId as string,
              status: context.session?.state,
            },
          ]),
      ),
    [runtimeContextsByTabId],
  );

  const derivedWorkspacePanels = useMemo(
    () =>
      deriveDefaultStudioPanelsFromNodes(
        nodes
          .filter((node) => (node.executionMode ?? 'active') === 'active')
          .map((node) => ({
            instanceId: node.instanceId,
            blockTypeId: node.blockTypeId,
            displayName: node.displayName,
          })),
      ),
    [nodes],
  );
  const uniqueBlockTypes = useMemo(
    () => Array.from(new Set(nodes.map((node) => node.blockTypeId))),
    [nodes],
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
  const currentSubmissionContent = useMemo(() => {
    try {
      return buildCurrentGraphSubmissionFromEditorSnapshot(currentSnapshot, { blockDetailsByType }).content;
    } catch {
      return null;
    }
  }, [blockDetailsByType, currentSnapshot]);
  const runtimeView = activeTabId ? getTabRuntimeView(activeTabId, currentSubmissionContent, schedulerId) : null;
  const activeRuntimeContext = activeTabId ? runtimeContextsByTabId[activeTabId] : null;
  const resolvedGraph = useMemo(
    () => resolveGraphVariables(serializedSnapshot.document),
    [serializedSnapshot.document],
  );
  const activeRuntimeVariableOverrides = useMemo(() => {
    if (!activeTabId || !activeRuntimeContext?.sessionId) {
      return {};
    }

    const overrides = runtimeVariableOverridesByTabId[activeTabId];
    if (!overrides || overrides.sessionId !== activeRuntimeContext.sessionId) {
      return {};
    }
    return overrides.valuesByName;
  }, [activeRuntimeContext?.sessionId, activeTabId, runtimeVariableOverridesByTabId]);
  const runtimeResolvedGraph = useMemo(
    () =>
      resolveGraphVariables(serializedSnapshot.document, {
        variableOverridesByName: activeRuntimeVariableOverrides,
      }),
    [activeRuntimeVariableOverrides, serializedSnapshot.document],
  );
  const runtimeVariableOverrideKey = useMemo(
    () => JSON.stringify(activeRuntimeVariableOverrides),
    [activeRuntimeVariableOverrides],
  );
  const resolvedGraphForRuntime = activeRuntimeContext?.sessionId ? runtimeResolvedGraph : resolvedGraph;
  const handleCreateVariable = useCallback(() => {
    addVariable();
  }, [addVariable]);
  const handleUpdateVariable = useCallback(
    (variableId: string, patch: Partial<Pick<StudioVariable, 'name' | 'binding'>>) => {
      updateVariable(variableId, patch);
    },
    [updateVariable],
  );
  const updateVariableValueByName = useCallback(
    (variableName: string, binding: StudioVariable['binding']) => {
      const targetVariable = (studioVariables ?? []).find((variable) => variable.name === variableName);
      if (!targetVariable) {
        return;
      }

      if (activeTabId && activeRuntimeContext?.sessionId && runtimeView?.executionState === 'running') {
        setRuntimeVariableOverridesByTabId((current) => {
          const existing = current[activeTabId];
          const valuesByName =
            existing && existing.sessionId === activeRuntimeContext.sessionId
              ? existing.valuesByName
              : {};
          return {
            ...current,
            [activeTabId]: {
              sessionId: activeRuntimeContext.sessionId as string,
              valuesByName: {
                ...valuesByName,
                [variableName]: binding,
              },
            },
          };
        });
        return;
      }

      updateVariable(targetVariable.id, { binding });
    },
    [activeRuntimeContext?.sessionId, activeTabId, runtimeView?.executionState, studioVariables, updateVariable],
  );
  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }
    return subscribeToDisplayApplicationCommands((command) => {
      if (command.type !== 'variable-update') {
        return;
      }
      if (command.sourceTabId !== activeTabId) {
        return;
      }
      const targetVariable = (studioVariables ?? []).find((variable) => variable.name === command.variableName);
      if (!targetVariable) {
        return;
      }
      if (activeRuntimeContext?.sessionId && runtimeView?.executionState === 'running') {
        setRuntimeVariableOverridesByTabId((current) => {
          const existing = current[activeTabId];
          const valuesByName =
            existing && existing.sessionId === activeRuntimeContext.sessionId
              ? existing.valuesByName
              : {};
          return {
            ...current,
            [activeTabId]: {
              sessionId: activeRuntimeContext.sessionId as string,
              valuesByName: {
                ...valuesByName,
                [command.variableName]: command.binding,
              },
            },
          };
        });
        return;
      }
      updateVariable(targetVariable.id, { binding: command.binding });
    });
  }, [activeRuntimeContext?.sessionId, activeTabId, runtimeView?.executionState, studioVariables, updateVariable]);
  useEffect(() => {
    setRuntimeVariableOverridesByTabId((current) => {
      let changed = false;
      const next: typeof current = {};

      Object.entries(current).forEach(([tabId, overrides]) => {
        const context = runtimeContextsByTabId[tabId];
        if (context?.sessionId === overrides.sessionId) {
          next[tabId] = overrides;
          return;
        }
        changed = true;
      });

      return changed ? next : current;
    });
  }, [runtimeContextsByTabId]);
  const mergedWorkspacePanels = useMemo(
    () =>
      mergeSavedAndDerivedStudioPanels({
        savedPanels: studioPanels,
        derivedPanels: derivedWorkspacePanels,
      }),
    [derivedWorkspacePanels, studioPanels],
  );
  const variableControlNames = useMemo(() => {
    const names = new Set<string>();
    mergedWorkspacePanels.forEach((panel) => {
      if (panel.kind !== 'control') {
        return;
      }
      panel.widgets.forEach((widget) => {
        if (widget.binding.kind === 'variable') {
          names.add(widget.binding.variableName);
        }
      });
    });
    return names;
  }, [mergedWorkspacePanels]);
  const handleRemoveVariable = useCallback(
    (variableId: string) => {
      const variable = (studioVariables ?? []).find((entry) => entry.id === variableId);
      if (variable) {
        setStudioPanels(removeControlWidgetsBoundToVariable(mergedWorkspacePanels, variable.name));
      }
      removeVariable(variableId);
    },
    [mergedWorkspacePanels, removeVariable, setStudioPanels, studioVariables],
  );
  const handleCreateVariableControl = useCallback(
    (variableName: string, inputValue?: string) => {
      const resolvedValue = resolvedGraph.variablesByName[variableName]?.value;
      const widget = buildControlWidgetSpec({
        variableName,
        label: variableName,
        initialValue: resolvedValue ?? inputValue ?? '',
      });
      const nextPanels = addControlWidgetToPanels(mergedWorkspacePanels, { widget });
      setStudioPanels(nextPanels);
    },
    [mergedWorkspacePanels, resolvedGraph.variablesByName, setStudioPanels],
  );
  const handleRemoveVariableControl = useCallback(
    (variableName: string) => {
      setStudioPanels(removeControlWidgetsBoundToVariable(mergedWorkspacePanels, variableName));
    },
    [mergedWorkspacePanels, setStudioPanels],
  );
  const effectiveStudioPlotPalettes = useMemo(
    () => (studioPlotPalettes && studioPlotPalettes.length > 0 ? studioPlotPalettes : buildDefaultStudioPlotPalettes()),
    [studioPlotPalettes],
  );
  const applicationMode = application?.mode ?? 'in_app';
  const applicationTitle = application?.title?.trim() || activeTab?.document.displayName || documentName || 'Application';
  const activeCenterView: CenterViewMode = activeTabId ? centerViewByTabId[activeTabId] ?? 'graph' : 'graph';
  const buildWorkspacePanelEntriesForRuntime = useCallback(
    (runtime: {
      sessionId: string | null;
      session: SessionRecord | null;
      executionState: NonNullable<typeof runtimeView>['executionState'];
      graphDriftState: NonNullable<typeof runtimeView>['graphDriftState'];
    } | null): WorkspacePanelViewModel[] => {
      const nodeById = new Map(nodes.map((node) => [node.instanceId, node]));
      const nodePanelTitlesById = buildDisambiguatedPanelTitles(
        nodes.map((node) => ({
          instanceId: node.instanceId,
          blockTypeId: node.blockTypeId,
          displayName: node.displayName,
        })),
      );
      const controlRuntime = runtime
        ? {
            sessionId: runtime.sessionId,
            executionState: runtime.executionState,
            graphDriftState: runtime.graphDriftState,
          }
        : null;

      return mergedWorkspacePanels.map((panel) => {
        if (!panel.nodeId) {
          if (panel.kind === 'control') {
            return {
              panel,
              controlWidgets: resolveControlPanelWidgetBindings({
                panel,
                nodeById,
                blockDetailsByType,
                resolvedGraph: resolvedGraphForRuntime,
                runtime: controlRuntime,
              }),
            };
          }
          return { panel };
        }

        const sourceNode = nodeById.get(panel.nodeId);
        if (!sourceNode) {
          if (panel.kind === 'control') {
            return {
              panel,
              controlWidgets: resolveControlPanelWidgetBindings({
                panel,
                nodeById,
                blockDetailsByType,
                resolvedGraph: resolvedGraphForRuntime,
                runtime: controlRuntime,
              }),
            };
          }
          return { panel };
        }

        const effectiveParameterValues = buildEffectiveParameterValues(
          sourceNode.parameters,
          blockDetailsByType.get(sourceNode.blockTypeId),
        );
        const resolvedParameterValues = buildResolvedParameterValues(
          effectiveParameterValues,
          resolvedGraphForRuntime.parametersByNodeId[sourceNode.instanceId],
        );
        const bindingView = resolveCurrentSessionStudioBindingView({
          blockTypeId: sourceNode.blockTypeId,
          nodeInstanceId: sourceNode.instanceId,
          parameterValues: resolvedParameterValues,
          session: runtime?.session,
        });

        const controlWidgets =
          panel.kind === 'control'
            ? resolveControlPanelWidgetBindings({
                panel,
                nodeById,
                blockDetailsByType,
                resolvedGraph: resolvedGraphForRuntime,
                runtime: controlRuntime,
              })
            : undefined;

        return {
          panel,
          studioPlotPalettes: effectiveStudioPlotPalettes,
          nodePanelTitle: nodePanelTitlesById.get(sourceNode.instanceId),
          nodeDisplayName: sourceNode.displayName,
          nodeBlockTypeId: sourceNode.blockTypeId,
          nodeParameters: effectiveParameterValues,
          controlWidgets,
          bindingStatus: bindingView.status,
          bindingTransport: bindingView.transport,
          bindingEndpoint: bindingView.endpoint,
          bindingShowEndpointInUi: !isDescriptorBasedBindingFamily(sourceNode.blockTypeId),
          bindingUpdateMs: bindingView.updateMs,
          bindingSampleRate: bindingView.sampleRate,
          bindingChannels: bindingView.channels,
          bindingSessionId: runtime?.sessionId ?? undefined,
          bindingReason: bindingView.reason,
        };
      });
    },
    [blockDetailsByType, effectiveStudioPlotPalettes, mergedWorkspacePanels, nodes, resolvedGraphForRuntime],
  );
  const lastPropagatedRuntimeSnapshotRef = useRef<string | null>(null);
  const workspacePanelEntries = useMemo<WorkspacePanelViewModel[]>(
    () =>
      buildWorkspacePanelEntriesForRuntime(
        activeRuntimeContext && runtimeView
          ? {
              sessionId: activeRuntimeContext.sessionId,
              session: activeRuntimeContext.session,
              executionState: runtimeView.executionState,
              graphDriftState: runtimeView.graphDriftState,
            }
          : null,
      ),
    [activeRuntimeContext, buildWorkspacePanelEntriesForRuntime, runtimeView],
  );

  const activeAudioSessionKeys = useMemo(() => {
    if (!activeRuntimeContext?.sessionId || runtimeView?.executionState !== 'running') {
      return [];
    }
    return workspacePanelEntries
      .filter(
        (entry) =>
          entry.panel.kind === 'audio' &&
          entry.panel.nodeId &&
          entry.bindingStatus === 'configured' &&
          entry.bindingTransport === 'websocket' &&
          entry.bindingEndpoint,
      )
      .map((entry) => `${activeRuntimeContext.sessionId}:${entry.panel.nodeId}`);
  }, [activeRuntimeContext?.sessionId, runtimeView?.executionState, workspacePanelEntries]);

  useEffect(() => {
    useAudioSessionStore.getState().cleanupMissingSessions(new Set(activeAudioSessionKeys));
  }, [activeAudioSessionKeys]);

  useEffect(() => {
    if (!activeTabId || !activeRuntimeContext?.sessionId || !runtimeView) {
      return;
    }

    if (runtimeView.executionState !== 'running') {
      return;
    }

    const propagationKey = `${activeTabId}:${activeRuntimeContext.sessionId}:${serializedSnapshot.contentHash}:${runtimeVariableOverrideKey}`;
    if (lastPropagatedRuntimeSnapshotRef.current === propagationKey) {
      return;
    }

    let cancelled = false;
    const pushResolvedValues = async () => {
      const updates = nodes.flatMap((node) => {
        const blockDetails = blockDetailsByType.get(node.blockTypeId);
        if (!blockDetails) {
          return [];
        }

        const resolvedParameters = resolvedGraphForRuntime.parametersByNodeId[node.instanceId];
        if (!resolvedParameters) {
          return [];
        }

        const patch: Record<string, string | number | boolean | null> = {};
        blockDetails.parameters.forEach((parameter) => {
          if (parameter.readOnly || !parameter.mutable) {
            return;
          }
          const resolvedParameter = resolvedParameters[parameter.name];
          if (!resolvedParameter || resolvedParameter.state !== 'resolved' || resolvedParameter.value === undefined) {
            return;
          }
          if (
            !shouldPropagateResolvedRuntimeSetting({
              name: parameter.name,
              bindingKind: resolvedParameter.binding.kind,
            })
          ) {
            return;
          }
          patch[parameter.name] = resolvedParameter.value;
        });

        if (Object.keys(patch).length === 0) {
          return [];
        }

        return [{ nodeId: node.instanceId, patch }];
      });

      await Promise.all(
        updates.map(async ({ nodeId, patch }) => {
          if (cancelled) {
            return;
          }
          await setBlockSettings(activeRuntimeContext.sessionId as string, nodeId, patch, 'staged');
        }),
      );

      if (!cancelled) {
        lastPropagatedRuntimeSnapshotRef.current = propagationKey;
      }
    };

    void pushResolvedValues();

    return () => {
      cancelled = true;
    };
  }, [
    activeRuntimeContext?.sessionId,
    activeTabId,
    blockDetailsByType,
    nodes,
    resolvedGraphForRuntime.parametersByNodeId,
    runtimeView,
    runtimeVariableOverrideKey,
    serializedSnapshot.contentHash,
  ]);

  const renderedWorkspacePanelEntries = useMemo(
    () =>
      workspacePanelEntries.filter(
        (entry) => shouldShowPanelInRenderedLayout(entry.panel),
      ),
    [workspacePanelEntries],
  );
  const workspaceLayout = useMemo(
    () => buildEffectiveRenderedStudioLayout(studioLayout, renderedWorkspacePanelEntries.map((entry) => entry.panel)),
    [renderedWorkspacePanelEntries, studioLayout],
  );

  const activePlotStyleEditorEntry = useMemo(
    () =>
      plotStyleEditorPanelId
        ? workspacePanelEntries.find((entry) => entry.panel.id === plotStyleEditorPanelId) ?? null
        : null,
    [plotStyleEditorPanelId, workspacePanelEntries],
  );

  const saveEnabled = activeTab
    ? (activeTab.document.isDirty || activeTab.document.isUntitled || !activeTab.document.hasWritableBacking)
    : false;
  const busy = isOpening || isSaving || isSaveAsInProgress;
  const anyTabDirty = tabs.some((tab) => tab.document.isDirty);
  const fallbackDocument = useMemo(() => createUntitledDocumentIdentity(capabilities), [capabilities]);
  const activeDocument = activeTab?.document ?? fallbackDocument;

  const capabilityDiagnostics = useMemo(
    () => buildDocumentCapabilityDiagnostics(capabilities, activeDocument),
    [activeDocument, capabilities],
  );
  const capabilityIndicatorText = useMemo(
    () => buildCapabilityIndicatorText(capabilities, activeDocument),
    [activeDocument, capabilities],
  );
  const openTooltip = useMemo(() => buildOpenTooltip(capabilities), [capabilities]);
  const saveTooltip = useMemo(
    () => buildSaveTooltip(capabilities, activeDocument),
    [activeDocument, capabilities],
  );
  const saveAsTooltip = useMemo(() => buildSaveAsTooltip(capabilities), [capabilities]);
  const backendEndpointLabel = config.controlPlaneBaseUrl.replace(/^https?:\/\//, '');
  const transportDiagnosticsTitle = [
    `Backend mode: ${config.backendMode}`,
    `Backend URL: ${config.controlPlaneBaseUrl}`,
    `Current-session routes: app-api (/api/*) via ${typeof window !== 'undefined' ? window.location.origin : 'app origin'}`,
    'Legacy authored absolute endpoints: direct compatibility fallback only',
  ].join('\n');

  useEffect(() => {
    if (!initializedTabs) {
      initializeFromSnapshot(currentSnapshot);
    }
  }, [currentSnapshot, initializeFromSnapshot, initializedTabs]);

  useEffect(() => {
    tabs.forEach((tab) => {
      ensureTabContext(tab.id);
    });
  }, [ensureTabContext, tabs]);

  useEffect(() => {
    if (activeTabId) {
      setRuntimeActiveTab(activeTabId);
    }
  }, [activeTabId, setRuntimeActiveTab]);

  useEffect(() => {
    if (!activeTabId || !activeTab) {
      return;
    }
    const pendingEditorLoad = pendingEditorLoadRef.current;
    if (pendingEditorLoad?.tabId === activeTabId) {
      if (serializedSnapshot.contentHash === pendingEditorLoad.contentHash) {
        pendingEditorLoadRef.current = null;
      }
      return;
    }
    if (editorBoundTabIdRef.current !== activeTabId) {
      return;
    }

    if (activeTabSerializedSnapshot?.contentHash === serializedSnapshot.contentHash) {
      return;
    }

    const persistedHash = activeTab.document.lastPersistedContentHash;
    const nextDirty = persistedHash ? serializedSnapshot.contentHash !== persistedHash : false;
    updateActiveSnapshot(currentSnapshot, { dirty: nextDirty });
  }, [
    activeTab,
    activeTabId,
    activeTabSerializedSnapshot?.contentHash,
    currentSnapshot,
    serializedSnapshot.contentHash,
    updateActiveSnapshot,
  ]);

  useEffect(() => {
    if (!activeTabId || !activeTab) {
      return;
    }
    if (editorBoundTabIdRef.current === activeTabId) {
      return;
    }

    replaceEditorFromTabSnapshot(activeTabId, activeTab.snapshot);
  }, [
    activeTab,
    activeTabId,
    replaceEditorFromTabSnapshot,
  ]);

  useEffect(() => {
    const titleName = activeTab?.document.displayName ?? STUDIO_UNTITLED_NAME;
    window.document.title = activeTab?.document.isDirty ? `• ${titleName} - gr4-studio` : `${titleName} - gr4-studio`;
  }, [activeTab]);

  useEffect(() => registerBeforeUnloadUnsavedChangesGuard(anyTabDirty), [anyTabDirty]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    console.info('[gr4-studio:file-workflow]', {
      fileSystemAccessSupported: capabilityDiagnostics.fileSystemAccessSupported,
      inPlaceSaveSupported: capabilityDiagnostics.inPlaceSaveSupported,
      savePickerSupported: capabilityDiagnostics.savePickerSupported,
      currentDocumentHasWritableBacking: capabilityDiagnostics.currentDocumentHasWritableBacking,
      activePath: capabilityDiagnostics.fileSystemAccessSupported ? 'file-system-access' : 'upload-download-fallback',
      tabs: tabs.length,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      handleDocumentShortcutKeydown(
        event,
        {
          onSave: () => {
            void handleSaveCurrentDocument();
          },
          onSaveAs: () => {
            void handleSaveAsCurrentDocument();
          },
          onOpen: () => {
            void handleOpenCommand();
          },
          onNew: () => {
            void handleNewCommand();
          },
        },
        {
          disabled: busy || Boolean(pendingDestructiveAction),
        },
      );
    };

    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  });

  const setActiveCenterView = (view: CenterViewMode) => {
    if (!activeTabId) {
      return;
    }

    setCenterViewByTabId((current) => ({
      ...current,
      [activeTabId]: view,
    }));
  };

  useEffect(() => {
    if (applicationMode === 'in_app' || activeCenterView !== 'application') {
      return;
    }
    setActiveCenterView('graph');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeCenterView, applicationMode]);

  const downgradeTabWritableBacking = (tabId: string, sourceKind: SourceKind = 'imported_file') => {
    patchTabDocument(tabId, (current) => ({
      ...current,
      sourceKind,
      fileHandle: null,
      hasWritableBacking: false,
    }));
  };

  const withUpdatedSnapshotName = (snapshot: EditorSnapshot, name: string): EditorSnapshot => ({
    ...snapshot,
    metadata: {
      ...snapshot.metadata,
      name,
    },
  });

  const saveTab = async (tabId: string, mode: 'save' | 'saveAs'): Promise<PersistenceResult> => {
    const tab = useGraphTabsStore.getState().tabs.find((entry) => entry.id === tabId);
    if (!tab) {
      return {
        kind: 'unsupported',
        message: 'No active tab to save.',
      };
    }

    if (mode === 'save') {
      setSaving(true);
    } else {
      setSaveAsInProgress(true);
    }
    setLastError(null);
    setLastStatusMessage(null);

    try {
      const result = mode === 'save'
        ? await persistenceService.saveCurrentDocument(tab.document, tab.snapshot, capabilities)
        : await persistenceService.saveCurrentDocumentAs(tab.document, tab.snapshot, capabilities);

      if (result.kind === 'success') {
        const nextSnapshot = withUpdatedSnapshotName(tab.snapshot, result.value.documentIdentity.displayName);
        setTabDocument(tabId, result.value.documentIdentity);
        updateTabSnapshot(tabId, nextSnapshot, { dirty: false });
        if (activeTabId === tabId) {
          replaceGraph(nextSnapshot);
        }
        setLastStatusMessage(buildSaveSuccessMessage(result.value.documentIdentity));
      } else if (result.kind !== 'canceled') {
        if (result.reason === 'permission_revoked') {
          downgradeTabWritableBacking(tabId, tab.document.sourceKind === 'file_handle' ? 'imported_file' : tab.document.sourceKind);
        }
        setLastError(result.message);
      }

      return result;
    } finally {
      if (mode === 'save') {
        setSaving(false);
      } else {
        setSaveAsInProgress(false);
      }
    }
  };

  const handleSaveCurrentDocument = async (): Promise<PersistenceResult> => {
    if (!activeTabId) {
      return {
        kind: 'unsupported',
        message: 'No active tab to save.',
      };
    }
    return saveTab(activeTabId, 'save');
  };

  const handleSaveAsCurrentDocument = async (): Promise<PersistenceResult> => {
    if (!activeTabId) {
      return {
        kind: 'unsupported',
        message: 'No active tab to save.',
      };
    }
    return saveTab(activeTabId, 'saveAs');
  };

  const handleRenameCurrentDocument = () => {
    if (!activeTabId || !activeTab) {
      return;
    }

    const nextName = window.prompt('Rename document', activeTab.document.displayName);
    if (nextName === null) {
      return;
    }
    const trimmed = nextName.trim();
    if (!trimmed) {
      return;
    }

    renameTabDocument(activeTabId, trimmed);
    const nextSnapshot = withUpdatedSnapshotName(currentSnapshot, trimmed);
    updateActiveSnapshot(nextSnapshot, { dirty: activeTab.document.isDirty });
    replaceEditorFromTabSnapshot(activeTabId, nextSnapshot);
  };

  const handleCreateTab = () => {
    const snapshot = buildNewUntitledSnapshot();
    const serialized = serializeEditorSnapshot(snapshot);
    const tab = createTab({
      snapshot,
      document: {
        ...createUntitledDocumentIdentity(capabilities),
        documentFormat: serialized.documentFormat,
        lastPersistedContentHash: serialized.contentHash,
      },
    });

    ensureTabContext(tab.id);
    setRuntimeActiveTab(tab.id);
    replaceEditorFromTabSnapshot(tab.id, tab.snapshot);
    setLastStatusMessage(`New tab: ${tab.document.displayName}`);
  };

  const handleNewCommand = () => {
    handleCreateTab();
  };

  const handleOpenCommand = async () => {
    setOpening(true);
    setLastError(null);
    setLastStatusMessage(null);

    try {
      const result = await persistenceService.openDocument(capabilities);
      if (result.kind !== 'success') {
        if (result.kind !== 'canceled') {
          setLastError(result.message);
        }
        return;
      }

      const previousActiveTabId = activeTabId;
      const shouldClosePreviousPristineUntitled =
        previousActiveTabId !== null && activeTab !== null && isPristineUntitledTab(activeTab);

      const newTab = createTab({
        snapshot: result.value.replacement,
        document: result.value.documentIdentity,
      });
      ensureTabContext(newTab.id);
      setRuntimeActiveTab(newTab.id);
      replaceEditorFromTabSnapshot(newTab.id, newTab.snapshot);

      if (shouldClosePreviousPristineUntitled && previousActiveTabId) {
        closeTab(previousActiveTabId);
        removeTabContext(previousActiveTabId);
      }
      setLastStatusMessage(buildOpenSuccessMessage(result.value.documentIdentity));
    } finally {
      setOpening(false);
    }
  };

  useEffect(() => {
    const onMenuCommand = window.gr4StudioShell?.onMenuCommand;
    if (!onMenuCommand) {
      return;
    }

    return onMenuCommand((command) => {
      if (command === 'new') {
        handleCreateTab();
        return;
      }
      if (command === 'open') {
        void handleOpenCommand();
        return;
      }
      if (command === 'save') {
        void handleSaveCurrentDocument();
        return;
      }
      if (command === 'saveAs') {
        void handleSaveAsCurrentDocument();
        return;
      }
      if (command === 'rename') {
        handleRenameCurrentDocument();
      }
    });
  }, [handleCreateTab, handleOpenCommand, handleRenameCurrentDocument, handleSaveAsCurrentDocument, handleSaveCurrentDocument]);

  const performCloseTab = (tabId: string) => {
    const result = closeTab(tabId);
    removeTabContext(tabId);

    if (result.nextActiveTabId) {
      const nextTab = useGraphTabsStore.getState().tabs.find((tab) => tab.id === result.nextActiveTabId);
      if (nextTab) {
        setRuntimeActiveTab(nextTab.id);
        replaceEditorFromTabSnapshot(nextTab.id, nextTab.snapshot);
      }
    }

    if (!result.nextActiveTabId && editorBoundTabIdRef.current === tabId) {
      editorBoundTabIdRef.current = null;
      setEditingBlockId(null);
    }
  };

  const handleCloseTab = (tabId: string) => {
    const tab = tabs.find((entry) => entry.id === tabId);
    if (!tab) {
      return;
    }

    if (tab.document.isDirty) {
      setPendingDestructiveAction({ type: 'close-tab', tabId });
      return;
    }

    performCloseTab(tabId);
  };

  const onUnsavedDialogSave = async () => {
    if (!pendingDestructiveAction) {
      return;
    }

    const saveResult = await saveTab(pendingDestructiveAction.tabId, 'save');
    if (saveResult.kind !== 'success') {
      setPendingDestructiveAction(null);
      return;
    }

    const targetTabId = pendingDestructiveAction.tabId;
    setPendingDestructiveAction(null);
    performCloseTab(targetTabId);
  };

  const launchDisplayApplication = (params: {
    mode: LaunchableApplicationMode;
    tabId: string;
    session: SessionRecord;
  }) => {
    const displayPanelEntries = buildWorkspacePanelEntriesForRuntime({
      sessionId: params.session.id,
      session: params.session,
      executionState: 'running',
      graphDriftState: 'in-sync',
    }).filter((entry) => shouldShowPanelInRenderedLayout(entry.panel));
    const displayLayout = buildEffectiveRenderedStudioLayout(
      studioLayout,
      displayPanelEntries.map((entry) => entry.panel),
    );
    const snapshot = writeDisplayApplicationLaunchSnapshot({
      sourceTabId: params.tabId,
      sessionId: params.session.id,
      title: applicationTitle,
      mode: params.mode,
      executionState: 'running',
      panelEntries: displayPanelEntries,
      layout: displayLayout,
    });
    const url = buildDisplayApplicationUrl(snapshot.launchId);
    const target = params.mode === 'new_tab' ? '_blank' : `gr4-studio-app-${snapshot.launchId}`;
    const features =
      params.mode === 'popout'
        ? 'popup=yes,width=1280,height=820,noopener,noreferrer'
        : 'noopener,noreferrer';
    const reservedWindow = displayLaunchWindowRef.current && !displayLaunchWindowRef.current.closed
      ? displayLaunchWindowRef.current
      : null;
    if (reservedWindow) {
      reservedWindow.location.href = url;
      reservedWindow.focus();
    }
    if (window.gr4StudioShell?.openDisplayApplication) {
      void window.gr4StudioShell.openDisplayApplication({
        launchId: snapshot.launchId,
        mode: params.mode,
        title: applicationTitle,
        snapshot,
      }).then((openResult) => {
        if (!openResult.ok) {
          setLastError(`Could not open display application: ${openResult.error}`);
        }
      });
    } else {
      const opened = reservedWindow ?? window.open(url, target, features);
      if (!opened) {
        setLastError('Browser blocked the display application window.');
      }
    }
    displayLaunchWindowRef.current = null;
  };

  const openActiveDisplayApplication = () => {
    if (
      !activeTabId ||
      !activeRuntimeContext?.session ||
      runtimeView?.executionState !== 'running' ||
      (applicationMode !== 'new_tab' && applicationMode !== 'popout')
    ) {
      return;
    }

    launchDisplayApplication({
      tabId: activeTabId,
      mode: applicationMode,
      session: activeRuntimeContext.session,
    });
  };

  const runActiveTab = async () => {
    if (!activeTabId || !activeTab) {
      return;
    }

    const launchMode = applicationMode;
    const nativeDisplayWindow =
      (launchMode === 'new_tab' || launchMode === 'popout') && Boolean(window.gr4StudioShell?.openDisplayApplication);
    if ((launchMode === 'new_tab' || launchMode === 'popout') && !nativeDisplayWindow) {
      const target = launchMode === 'new_tab' ? '_blank' : `gr4-studio-app-${activeTabId}`;
      const features = launchMode === 'popout' ? 'popup=yes,width=1280,height=820' : undefined;
      displayLaunchWindowRef.current = window.open('', target, features);
    } else {
      displayLaunchWindowRef.current = null;
    }

    const persistedHash = activeTab.document.lastPersistedContentHash;
    const nextDirty = persistedHash ? serializedSnapshot.contentHash !== persistedHash : activeTab.document.isDirty;
    updateActiveSnapshot(currentSnapshot, { dirty: nextDirty });

    const shouldSaveBeforeRun = nextDirty || activeTab.document.isUntitled || !activeTab.document.hasWritableBacking;
    if (shouldSaveBeforeRun) {
      const saveResult = await saveTab(activeTabId, 'save');
      if (saveResult.kind !== 'success') {
        displayLaunchWindowRef.current?.close();
        displayLaunchWindowRef.current = null;
        return;
      }
    }

    const latestTab = useGraphTabsStore.getState().tabs.find((tab) => tab.id === activeTabId);
    const document = graphDocumentFromEditor(latestTab?.snapshot ?? currentSnapshot);
    const result = await runTab(activeTabId, document, { blockDetailsByType });
    if (!result.ok) {
      displayLaunchWindowRef.current?.close();
      displayLaunchWindowRef.current = null;
      return;
    }

    if (launchMode === 'in_app' || launchMode === 'external') {
      setActiveCenterView('application');
      return;
    }

    launchDisplayApplication({
      tabId: activeTabId,
      mode: launchMode,
      session: result.session,
    });
  };

  const applyLayoutEditorSplitDrop = (
    draggedPanelId: string,
    targetPanelId: string,
    position: SplitDropPosition,
  ) => {
    const nextLayout = applySplitDropToLayout(
      workspaceLayout,
      draggedPanelId,
      targetPanelId,
      position,
      renderedWorkspacePanelEntries.map((entry) => entry.panel.id),
    );
    setStudioLayout(nextLayout);
  };

  const applyLayoutEditorSplitSizes = (splitPath: SplitNodePath, sizes: number[]) => {
    const nextLayout = applySplitSizesToLayout(
      workspaceLayout,
      splitPath,
      sizes,
      renderedWorkspacePanelEntries.map((entry) => entry.panel.id),
    );
    setStudioLayout(nextLayout);
  };

  const createEmptyControlPanel = () => {
    const result = addEmptyControlPanelToPanels(mergedWorkspacePanels);
    setStudioPanels(result.panels);
    setStudioLayout(buildEffectiveRenderedStudioLayout(studioLayout, result.panels));
  };

  const renameControlPanel = (panelId: string, title: string) => {
    setStudioPanels(renameControlPanelTitle(mergedWorkspacePanels, panelId, title));
  };

  const updateControlWidgetLabelInWorkspace = (panelId: string, widgetId: string, label: string) => {
    setStudioPanels(updateControlWidgetLabel(mergedWorkspacePanels, panelId, widgetId, label));
  };

  const updateControlWidgetInputKindInWorkspace = (
    panelId: string,
    widgetId: string,
    inputKind: 'text' | 'number' | 'slider' | 'boolean' | 'enum',
  ) => {
    setStudioPanels(updateControlWidgetInputKind(mergedWorkspacePanels, panelId, widgetId, inputKind));
  };
  const updateControlWidgetSliderConfigInWorkspace = (
    panelId: string,
    widgetId: string,
    slider: StudioControlWidgetSliderConfig,
  ) => {
    setStudioPanels(updateControlWidgetSliderConfig(mergedWorkspacePanels, panelId, widgetId, slider));
  };

  const moveControlWidgetInWorkspace = (panelId: string, widgetId: string, direction: 'up' | 'down') => {
    setStudioPanels(moveControlWidgetInPanel(mergedWorkspacePanels, panelId, widgetId, direction));
  };

  const removeControlWidgetInWorkspace = (panelId: string, widgetId: string) => {
    setStudioPanels(removeControlWidgetFromPanel(mergedWorkspacePanels, panelId, widgetId));
  };

  const moveControlWidgetToPanelInWorkspace = (panelId: string, widgetId: string, targetPanelId: string) => {
    setStudioPanels(
      moveControlWidgetToPanel(mergedWorkspacePanels, {
        sourcePanelId: panelId,
        targetPanelId,
        widgetId,
      }),
    );
  };

  const updatePanelPlotStyle = (panelId: string, plotStyle: StudioPlotStyleConfig | undefined) => {
    const nextPanels = mergedWorkspacePanels.map((panel) => {
      if (panel.id !== panelId) {
        return panel;
      }
      return {
        ...panel,
        plotStyle,
      };
    });
    setStudioPanels(nextPanels);
  };

  return (
    <div className="h-screen overflow-hidden bg-slate-900 text-slate-100 flex flex-col">
      <header className="h-16 shrink-0 border-b border-cyan-950/70 bg-slate-950/92 px-4 flex items-center justify-between gap-4 shadow-[0_10px_40px_rgba(2,132,199,0.06)]">
        <div className="min-w-0 flex items-center gap-3">
          <StudioMark className="h-9 w-9 shrink-0" />
          <div className="min-w-0">
            <h1 className="text-lg font-semibold tracking-[0.22em] uppercase text-slate-100">gr4-studio</h1>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <details className="relative">
            <summary className="cursor-pointer list-none rounded border border-slate-600 bg-slate-800 px-2 py-1 text-xs text-slate-200 hover:bg-slate-700">
              File
            </summary>
            <div className="absolute right-0 z-40 mt-1 w-52 rounded border border-slate-700 bg-slate-900 p-1 shadow-lg">
              <button
                type="button"
                onClick={handleCreateTab}
                disabled={busy}
                className="w-full rounded px-2 py-1 text-left text-xs text-slate-200 hover:bg-slate-800 disabled:opacity-50"
              >
                New
              </button>
              <button
                type="button"
                onClick={() => void handleOpenCommand()}
                disabled={busy}
                title={openTooltip}
                className="w-full rounded px-2 py-1 text-left text-xs text-slate-200 hover:bg-slate-800 disabled:opacity-50"
              >
                Open...
              </button>
              <button
                type="button"
                onClick={() => void handleSaveCurrentDocument()}
                disabled={busy || !saveEnabled}
                title={saveTooltip}
                className="w-full rounded px-2 py-1 text-left text-xs text-slate-200 hover:bg-slate-800 disabled:opacity-50"
              >
                Save
              </button>
              <button
                type="button"
                onClick={() => void handleSaveAsCurrentDocument()}
                disabled={busy || !activeTabId}
                title={saveAsTooltip}
                className="w-full rounded px-2 py-1 text-left text-xs text-slate-200 hover:bg-slate-800 disabled:opacity-50"
              >
                Save As...
              </button>
              <button
                type="button"
                onClick={handleRenameCurrentDocument}
                disabled={busy || !activeTabId}
                className="w-full rounded px-2 py-1 text-left text-xs text-slate-200 hover:bg-slate-800 disabled:opacity-50"
              >
                Rename...
              </button>
              <p className="mt-1 border-t border-slate-700 px-2 pt-1 text-[10px] text-slate-400">
                {capabilityIndicatorText}
              </p>
            </div>
          </details>

          <button
            type="button"
            onClick={() => void handleOpenCommand()}
            disabled={busy}
            title={openTooltip}
            className="rounded border border-slate-600 bg-slate-800 px-2 py-1 text-xs text-slate-200 hover:bg-slate-700 disabled:opacity-50"
          >
            Open...
          </button>
          <button
            type="button"
            onClick={() => void handleSaveCurrentDocument()}
            disabled={busy || !saveEnabled}
            title={saveTooltip}
            className="rounded border border-slate-600 bg-slate-800 px-2 py-1 text-xs text-slate-200 hover:bg-slate-700 disabled:opacity-50"
          >
            Save
          </button>
          <button
            type="button"
            onClick={() => void handleSaveAsCurrentDocument()}
            disabled={busy || !activeTabId}
            title={saveAsTooltip}
            className="rounded border border-slate-600 bg-slate-800 px-2 py-1 text-xs text-slate-200 hover:bg-slate-700 disabled:opacity-50"
          >
            Save As...
          </button>
          {isControlPlaneWasmEnabled() ? (
            <WasmBackendPill />
          ) : (
            <span
              className="rounded-full border border-slate-600 bg-slate-800 px-2.5 py-1 text-[11px] font-medium text-slate-200"
              title={transportDiagnosticsTitle}
            >
              {backendEndpointLabel}
            </span>
          )}
          <StatusBadge status={connectionStatus} />
        </div>
      </header>

      <GraphTabsBar
        tabs={tabs}
        activeTabId={activeTabId}
        sessionByTabId={sessionByTabId}
        onSelectTab={setActiveTab}
        onCreateTab={handleCreateTab}
        onCloseTab={handleCloseTab}
        onOpenSessions={() => setIsSessionsDrawerOpen(true)}
      />

      {documentError && (
        <div className="shrink-0 border-b border-rose-900 bg-rose-950/30 px-4 py-2 text-sm text-rose-200">
          {documentError}
        </div>
      )}
      {!documentError && documentStatusMessage && (
        <div className="shrink-0 border-b border-emerald-900 bg-emerald-950/30 px-4 py-2 text-sm text-emerald-200">
          {documentStatusMessage}
        </div>
      )}
      {showUnsupportedNotice && !capabilities.canUseFileSystemAccessApi && (
        <div className="shrink-0 border-b border-amber-900 bg-amber-950/30 px-4 py-2 text-xs text-amber-200 flex items-center justify-between gap-2">
          <span>
            This browser does not support direct file save/open. gr4-studio will use upload/download fallback. For desktop-style file save behavior, use a Chromium-based browser.
          </span>
          <button
            type="button"
            onClick={() => {
              if (typeof window !== 'undefined') {
                dismissUnsupportedBrowserNotice(window.localStorage);
              }
              setShowUnsupportedNotice(false);
            }}
            className="rounded border border-amber-700/70 bg-amber-900/35 px-2 py-1 text-[11px] text-amber-100 hover:bg-amber-800/45"
          >
            Dismiss
          </button>
        </div>
      )}

      <main className="min-h-0 flex-1 overflow-hidden grid grid-cols-[18rem_1fr_20rem]">
        <aside className="min-h-0 overflow-hidden border-r border-border bg-panel">
          <BlockCatalogPanel />
        </aside>

        <section className="relative min-h-0 overflow-hidden bg-slate-950 flex flex-col">
          <div className="h-10 shrink-0 border-b border-border bg-slate-950/80 px-3 flex items-center gap-2">
            <button
              type="button"
              onClick={() => setActiveCenterView('graph')}
              className={`rounded border px-2 py-1 text-xs ${
                activeCenterView === 'graph'
                  ? 'border-emerald-600/70 bg-emerald-900/30 text-emerald-100'
                  : 'border-slate-700 bg-slate-900 text-slate-300 hover:bg-slate-800'
              }`}
            >
              Graph
            </button>
            <button
              type="button"
              onClick={() => setActiveCenterView('variables')}
              className={`rounded border px-2 py-1 text-xs ${
                activeCenterView === 'variables'
                  ? 'border-emerald-600/70 bg-emerald-900/30 text-emerald-100'
                  : 'border-slate-700 bg-slate-900 text-slate-300 hover:bg-slate-800'
              }`}
            >
              Variables
            </button>
            <button
              type="button"
              onClick={() => setActiveCenterView('workspace')}
              className={`rounded border px-2 py-1 text-xs ${
                activeCenterView === 'workspace'
                  ? 'border-emerald-600/70 bg-emerald-900/30 text-emerald-100'
                  : 'border-slate-700 bg-slate-900 text-slate-300 hover:bg-slate-800'
              }`}
            >
              Layout Editor
            </button>
            {applicationMode === 'in_app' ? (
              <button
                type="button"
                onClick={() => setActiveCenterView('application')}
                className={`rounded border px-2 py-1 text-xs ${
                  activeCenterView === 'application'
                    ? 'border-emerald-600/70 bg-emerald-900/30 text-emerald-100'
                    : 'border-slate-700 bg-slate-900 text-slate-300 hover:bg-slate-800'
                }`}
              >
                In-app
              </button>
            ) : null}
            <div className="ml-auto flex items-center gap-2">
              {runtimeView && activeTabId && (
                <div className="flex items-center gap-1.5 rounded border border-slate-700 bg-slate-900/70 px-2 py-1">
                  <StatusPill status={runtimeView.executionState} />
                  <button
                    type="button"
                    onClick={() => void runActiveTab()}
                    disabled={busy || Boolean(activeRuntimeContext?.busy) || runtimeView.executionState === 'running'}
                    title={runButtonTitle(runtimeView.runIntent)}
                    className="h-6 w-6 rounded border border-emerald-700/70 bg-emerald-900/35 text-emerald-200 hover:bg-emerald-800/45 disabled:opacity-50"
                  >
                    <svg viewBox="0 0 16 16" className="mx-auto h-3.5 w-3.5 fill-current" aria-hidden="true">
                      <path d="M4 2.5v11l8-5.5z" />
                    </svg>
                  </button>
                  {applicationMode !== 'in_app' && (
                    <button
                      type="button"
                      onClick={openActiveDisplayApplication}
                      disabled={
                        Boolean(activeRuntimeContext?.busy) ||
                        !activeRuntimeContext?.session ||
                        runtimeView.executionState !== 'running'
                      }
                      title="Open display"
                      className="h-6 w-6 rounded border border-cyan-700/70 bg-cyan-900/35 text-cyan-200 hover:bg-cyan-800/45 disabled:opacity-50"
                    >
                      <svg viewBox="0 0 16 16" className="mx-auto h-3.5 w-3.5 fill-current" aria-hidden="true">
                        <path d="M2.5 3.5h11v7h-11zM4 12h8v1H4z" />
                      </svg>
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => void stopSessionForTab(activeTabId)}
                    disabled={Boolean(activeRuntimeContext?.busy) || !activeRuntimeContext?.sessionId || runtimeView.executionState !== 'running'}
                    title="Stop"
                    className="h-6 w-6 rounded border border-amber-700/70 bg-amber-900/35 text-amber-200 hover:bg-amber-800/45 disabled:opacity-50"
                  >
                    <svg viewBox="0 0 16 16" className="mx-auto h-3.5 w-3.5 fill-current" aria-hidden="true">
                      <rect x="3.5" y="3.5" width="9" height="9" rx="1" />
                    </svg>
                  </button>
                  <button
                    type="button"
                    onClick={() => void deleteSessionForTab(activeTabId)}
                    disabled={Boolean(activeRuntimeContext?.busy) || !activeRuntimeContext?.sessionId}
                    title="Delete session"
                    className="h-6 w-6 rounded border border-rose-700/70 bg-rose-900/35 text-rose-200 hover:bg-rose-800/45 disabled:opacity-50"
                  >
                    <svg viewBox="0 0 16 16" className="mx-auto h-3.5 w-3.5 fill-current" aria-hidden="true">
                      <path d="M6 2.5h4l.6 1.5H13v1H3v-1h2.4zM4.5 6h7l-.6 7.3a1 1 0 0 1-1 .9H6.1a1 1 0 0 1-1-.9z" />
                    </svg>
                  </button>
                </div>
              )}
            </div>
          </div>

          <div className="relative min-h-0 flex-1 overflow-hidden">
            {activeCenterView === 'graph' ? (
              <GraphEditorPanel
                key={`${activeTabId ?? 'no-active-tab'}:${activeTab?.document.internalDocumentId ?? 'no-document'}`}
                onOpenBlockProperties={setEditingBlockId}
                isBlockPropertiesOpen={Boolean(editingBlockId)}
              />
            ) : activeCenterView === 'workspace' ? (
              <WorkspaceView
                panelEntries={renderedWorkspacePanelEntries}
                layout={workspaceLayout}
                onSplitDrop={applyLayoutEditorSplitDrop}
                onSplitSizesChange={applyLayoutEditorSplitSizes}
                onOpenPanelPlotStyleEditor={(entry) => setPlotStyleEditorPanelId(entry.panel.id)}
                onCreateControlPanel={createEmptyControlPanel}
                onRenameControlPanel={renameControlPanel}
                onUpdateControlWidgetLabel={updateControlWidgetLabelInWorkspace}
                onUpdateControlWidgetInputKind={updateControlWidgetInputKindInWorkspace}
                onUpdateControlWidgetSliderConfig={updateControlWidgetSliderConfigInWorkspace}
                onMoveControlWidget={moveControlWidgetInWorkspace}
                onRemoveControlWidget={removeControlWidgetInWorkspace}
                onMoveControlWidgetToPanel={moveControlWidgetToPanelInWorkspace}
                onUpdateVariableValue={updateVariableValueByName}
              />
            ) : activeCenterView === 'variables' ? (
              <VariablesView
              variables={studioVariables}
              resolvedGraph={resolvedGraph}
              variableControlNames={variableControlNames}
              onCreateVariable={handleCreateVariable}
              onUpdateVariable={handleUpdateVariable}
              onRemoveVariable={handleRemoveVariable}
              onCreateVariableControl={handleCreateVariableControl}
              onRemoveVariableControl={handleRemoveVariableControl}
            />
            ) : (
              <ApplicationView
                panelEntries={renderedWorkspacePanelEntries}
                layout={workspaceLayout}
                executionState={runtimeView?.executionState}
                onUpdateVariableValue={updateVariableValueByName}
              />
            )}
            <PlotStyleModal
              open={Boolean(activePlotStyleEditorEntry)}
              panelEntry={activePlotStyleEditorEntry}
              studioPalettes={effectiveStudioPlotPalettes}
              onClose={() => setPlotStyleEditorPanelId(null)}
              onApply={({ panelId, plotStyle, studioPalettes: nextStudioPalettes }) => {
                updatePanelPlotStyle(panelId, plotStyle);
                setStudioPlotPalettes(nextStudioPalettes);
              }}
            />
          </div>
        </section>

        <aside className="min-h-0 overflow-hidden border-l border-border bg-panel">
          <InspectorPanel />
        </aside>
      </main>

      <GlobalSessionsDrawer
        open={isSessionsDrawerOpen}
        onClose={() => setIsSessionsDrawerOpen(false)}
        onJumpToTab={setActiveTab}
        activeTabId={activeTabId}
      />

      {editingBlockId && (
        <BlockPropertiesModal
          instanceId={editingBlockId}
          onClose={() => setEditingBlockId(null)}
        />
      )}

      {pendingDestructiveAction && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-slate-950/60" />
          <div className="relative w-[30rem] max-w-[calc(100%-2rem)] rounded border border-slate-700 bg-slate-900 p-4 shadow-xl">
            <h2 className="text-sm font-semibold text-slate-100">
              Save changes to {tabs.find((tab) => tab.id === pendingDestructiveAction.tabId)?.document.displayName ?? STUDIO_UNTITLED_NAME}?
            </h2>
            <p className="mt-2 text-sm text-slate-300">
              Your changes will be lost if you don&apos;t save them.
            </p>
            <div className="mt-4 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => void onUnsavedDialogSave()}
                disabled={busy}
                className="rounded border border-emerald-700/70 bg-emerald-900/35 px-3 py-1.5 text-xs text-emerald-100 hover:bg-emerald-800/45"
              >
                Save
              </button>
              <button
                type="button"
                onClick={() => {
                  const targetTabId = pendingDestructiveAction.tabId;
                  setPendingDestructiveAction(null);
                  performCloseTab(targetTabId);
                }}
                disabled={busy}
                className="rounded border border-amber-700/70 bg-amber-900/30 px-3 py-1.5 text-xs text-amber-100 hover:bg-amber-800/40"
              >
                Don&apos;t Save
              </button>
              <button
                type="button"
                onClick={() => setPendingDestructiveAction(null)}
                disabled={busy}
                className="rounded border border-slate-600 bg-slate-800 px-3 py-1.5 text-xs text-slate-100 hover:bg-slate-700"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
