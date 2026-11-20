import { studioPropertyChoices, validateStudioProperties } from '../block-properties/studio-properties';
import { useEffect, useMemo, useState, type KeyboardEvent, type ReactNode } from 'react';
import { useQueries } from '@tanstack/react-query';
import { PanelHeader } from '../../components/panel-header';
import { StatusPill } from '../../components/status-pill';
import { isAdvancedParameterName, isAdvancedUiHint } from '../../lib/utils/parameter-groups';
import { resolveRenderedPorts } from '../ports/model/resolveRenderedPorts';
import type { SchemaPort } from '../ports/model/types';
import { useBlockDetailsQuery } from './hooks/use-block-details-query';
import { useRuntimeBlockSettings } from './hooks/use-runtime-block-settings';
import { useSchedulersQuery } from './hooks/use-schedulers-query';
import {
  parseRuntimeSettingsArray,
  runtimeSettingToGraphLiteral,
  resolveRuntimeSettingsAvailability,
  toRuntimeSettingsErrorMessage,
} from './runtime-settings-model';
import { useEditorStore } from '../graph-editor/store/editorStore';
import { useGraphTabsStore, type EditorSnapshot } from '../graph-tabs/store/graphTabsStore';
import type { ApplicationMode } from '../graph-document/model/studio-workspace';
import { effectiveApplicationMode } from '../application/runtime/application-mode';
import { isControlPlaneWasmEnabled } from '../../lib/wasm/control-plane-wasm';
import type { RuntimeSettingsValue } from '../../lib/api/block-settings';
import { useRuntimeSessionStore } from '../runtime-session/store/runtimeSessionStore';
import { buildCurrentGraphSubmissionFromEditorSnapshot } from '../runtime-submission/model/current-graph-submission';
import { canDownloadCurrentGraph, downloadCurrentGraphAsGr4c } from '../document-file/gr4c-download';
import { SelectionHeader, SelectionParameters, SelectionPorts, SelectionAdvanced } from './selection-details';
import type { BlockDetails, BlockParameterMeta } from '../../lib/api/block-details';
import { getBlockDetails } from '../../lib/api/block-details';
import {
  buildStudioAuthoringBindingView,
  getAuthoringParameterLabel,
  isDescriptorBindingHiddenParameter,
} from '../graph-editor/runtime/studio-managed-runtime-authoring';
import {
  getEditorVirtualRouteIssues,
  getVirtualRoutingBlockDetails,
  isNoteBlockType,
  isVirtualRoutingBlockType,
} from '../graph-editor/model/virtual-routing';
import { SidePanelToggleButton } from '../../components/side-panel-toggle-button';
import { InspectorSection } from './inspector-components';
import { GraphDetails } from './graph-details';
import { SessionDetails } from './session-details';

type InspectorTabId = 'selection' | 'graph' | 'session';

const LOCAL_PLOT_SETTING_NAMES = new Set([
  'autoscale',
  'persistence',
  'phosphor_intensity',
  'phosphor_decay_ms',
  'x_min',
  'x_max',
  'y_min',
  'y_max',
  'z_min',
  'z_max',
]);

function EmptyState({ children }: { children: ReactNode }) {
  return (
    <div className="py-2 text-xs text-slate-400">
      {children}
    </div>
  );
}

function toSchemaPorts(details: NonNullable<ReturnType<typeof useBlockDetailsQuery>['data']>): SchemaPort[] {
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

function RuntimeSettingsSection({
  runtimeContext,
  graphDriftState,
  selectedBlock,
  blockDetails,
}: {
  runtimeContext: ReturnType<typeof useRuntimeSessionStore.getState>['contextsByTabId'][string] | undefined;
  graphDriftState: 'in-sync' | 'out-of-sync' | null | undefined;
  selectedBlock:
    | ReturnType<typeof useEditorStore.getState>['nodes'][number]
    | undefined;
  blockDetails?: BlockDetails;
}) {
  const updateNodeParameters = useEditorStore((state) => state.updateNodeParameters);
  const updateNodeParameterBindings = useEditorStore((state) => state.updateNodeParameterBindings);
  const selectedNodeRuntimeName = selectedBlock?.instanceId;
  const availability = resolveRuntimeSettingsAvailability({
    session: runtimeContext?.session,
    sessionId: runtimeContext?.sessionId,
    selectedNodeRuntimeName,
    graphDriftState,
  });
  const sessionId = availability.state === 'ready' ? availability.sessionId : undefined;
  const uniqueName = availability.state === 'ready' ? availability.uniqueName : undefined;
  const { query, mutation } = useRuntimeBlockSettings(sessionId, uniqueName, availability.state === 'ready');
  const [draftValues, setDraftValues] = useState<Record<string, string | boolean>>({});
  const [saveError, setSaveError] = useState<string | null>(null);
  const [applyMessage, setApplyMessage] = useState<string | null>(null);
  const [showHelp, setShowHelp] = useState(false);

  useEffect(() => {
    if (!query.data) {
      setDraftValues({});
      return;
    }

    const nextDraft: Record<string, string | boolean> = {};
    for (const [key, value] of Object.entries(query.data)) {
      if (typeof value === 'boolean') {
        nextDraft[key] = value;
      } else if (Array.isArray(value)) {
        nextDraft[key] = JSON.stringify(value);
      } else if (typeof value === 'string' || typeof value === 'number') {
        nextDraft[key] = String(value);
      }
    }
    setDraftValues(nextDraft);
    setSaveError(null);
    setApplyMessage(null);
  }, [query.data, uniqueName]);

  const savePatch = async (name: string, value: RuntimeSettingsValue) => {
    if (!sessionId || !uniqueName) {
      return;
    }

    const proposedValues = { ...query.data, [name]: value };
    const errors = validateStudioProperties(selectedBlock?.blockTypeId ?? '',
      Object.fromEntries(Object.entries(proposedValues)
        .filter(([key]) => !isDescriptorBindingHiddenParameter(selectedBlock?.blockTypeId ?? '', key))
        .map(([key, entry]) => [key, { value: String(entry), bindingKind: 'literal' as const }])));
    if (Object.keys(errors).length > 0) {
      setSaveError(Object.values(errors).join(' '));
      return;
    }
    setSaveError(null);
    try {
      await mutation.mutateAsync({
        patch: {
          [name]: value,
        },
        mode: 'staged',
      });
      if (
        selectedBlock &&
        LOCAL_PLOT_SETTING_NAMES.has(name.trim().toLowerCase()) &&
        (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' || value === null)
      ) {
        updateNodeParameterBindings(selectedBlock.instanceId, {
          [name]: {
            kind: 'literal',
            value,
          },
        });
      }
    } catch (error) {
      setSaveError(toRuntimeSettingsErrorMessage(error));
      throw error;
    }
  };

  const runtimeValues = query.data ?? {};
  const parameterMetaByName = useMemo(
    () =>
      new Map<string, BlockParameterMeta>(
        (blockDetails?.parameters ?? []).map((parameter) => [parameter.name, parameter]),
      ),
    [blockDetails],
  );

  const editableEntries: Array<[string, RuntimeSettingsValue]> = [];
  const advancedEntries: Array<[string, RuntimeSettingsValue]> = [];

  Object.entries(runtimeValues)
    .sort(([left], [right]) => left.localeCompare(right))
    .forEach(([name, value]) => {
      if (isDescriptorBindingHiddenParameter(selectedBlock?.blockTypeId ?? '', name)) return;
      const parameterMeta = parameterMetaByName.get(name);
      const advanced =
        isAdvancedParameterName(name) ||
        (parameterMeta ? isAdvancedUiHint(parameterMeta.uiHint) : false);

      if (advanced) {
        advancedEntries.push([name, value]);
        return;
      }

      if (parameterMeta && parameterMeta.mutable && !parameterMeta.readOnly) {
        editableEntries.push([name, value]);
        return;
      }

      return;
    });

  const applicableGraphPatch = useMemo(() => {
    if (!selectedBlock || !query.data) {
      return {};
    }

    const nextPatch: Record<string, string> = {};
    for (const [name, value] of Object.entries(query.data)) {
      const parameterMeta = parameterMetaByName.get(name);
      if (!parameterMeta || parameterMeta.readOnly || !parameterMeta.mutable) {
        continue;
      }
      const literal = runtimeSettingToGraphLiteral(value);
      if (literal !== undefined) {
        nextPatch[name] = literal;
      }
    }

    return nextPatch;
  }, [parameterMetaByName, query.data, selectedBlock]);

  const applyRuntimeToGraph = () => {
    if (!selectedBlock) {
      return;
    }

    const entries = Object.entries(applicableGraphPatch);
    if (entries.length === 0) {
      setApplyMessage('No editable runtime values can be applied to the graph.');
      return;
    }

    updateNodeParameters(selectedBlock.instanceId, applicableGraphPatch);
    setApplyMessage(`Applied ${entries.length} runtime value${entries.length === 1 ? '' : 's'} to graph properties.`);
  };

  const renderRuntimeValue = (name: string, value: RuntimeSettingsValue, editable: boolean) => {
    const parameterMeta = parameterMetaByName.get(name);
    const typeLabel = parameterMeta?.valueType ?? typeof value;
    const enumChoices = studioPropertyChoices(selectedBlock?.blockTypeId ?? '', name) ?? parameterMeta?.enumChoices ?? [];
    const hasEnumChoices = enumChoices.length > 0;

    if (Array.isArray(value)) {
      const draftValue = draftValues[name];
      const text = typeof draftValue === 'string' ? draftValue : JSON.stringify(value);
      const commitArray = async () => {
        if (!editable || text === JSON.stringify(value)) {
          return;
        }
        try {
          const next = parseRuntimeSettingsArray(text);
          await savePatch(name, next);
        } catch (error) {
          setSaveError(toRuntimeSettingsErrorMessage(error));
        }
      };
      return (
        <label key={name} className="block space-y-1">
          <p className="text-xs text-slate-300">{name}</p>
          <p className="text-[11px] text-slate-400">{typeLabel} · JSON list</p>
          <input
            type="text"
            value={text}
            disabled={!editable || mutation.isPending}
            onChange={(event) => setDraftValues((current) => ({ ...current, [name]: event.target.value }))}
            onBlur={() => {
              void commitArray();
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.currentTarget.blur();
              }
            }}
            className="inspector-input disabled:opacity-70"
          />
        </label>
      );
    }

    if (typeof value === 'boolean') {
      const checked = Boolean(draftValues[name]);
      return (
        <label key={name} className="flex items-center justify-between gap-3">
          <div>
            <p className="text-xs text-slate-300">{getAuthoringParameterLabel(selectedBlock?.blockTypeId ?? '', name, name)}</p>
            <p className="text-[11px] text-slate-400">{typeLabel}</p>
          </div>
          <input
            type="checkbox"
            checked={checked}
            disabled={!editable || mutation.isPending}
            onChange={(event) => {
              if (!editable) {
                return;
              }
              const next = event.target.checked;
              setDraftValues((current) => ({ ...current, [name]: next }));
              void savePatch(name, next);
            }}
            className="h-4 w-4 rounded border-slate-600 bg-slate-900 text-emerald-500"
          />
        </label>
      );
    }

    if (typeof value === 'string' || typeof value === 'number') {
      const draftValue = draftValues[name];
      const inputValue = typeof draftValue === 'string' ? draftValue : String(value);
      if (hasEnumChoices) {
        const selectValue = inputValue;
        const visibleChoices = inputValue && !enumChoices.includes(inputValue) ? [inputValue, ...enumChoices] : enumChoices;

        return (
          <label key={name} className="block space-y-1">
            <p className="text-xs text-slate-300">{getAuthoringParameterLabel(selectedBlock?.blockTypeId ?? '', name, name)}</p>
            <p className="text-[11px] text-slate-400">{typeLabel}</p>
            <select
              value={selectValue}
              disabled={!editable || mutation.isPending}
              onChange={(event) => {
                if (!editable) {
                  return;
                }
                const nextValue = event.target.value;
                setDraftValues((current) => ({ ...current, [name]: nextValue }));
                void savePatch(name, typeof value === 'number' ? Number(nextValue) : nextValue);
              }}
              className="inspector-input disabled:opacity-70"
            >
              {visibleChoices.map((choice) => (
                <option key={choice} value={choice}>
                  {choice}
                </option>
              ))}
            </select>
          </label>
        );
      }

      const commitScalar = async () => {
        if (!editable) {
          return;
        }
        const raw = typeof draftValues[name] === 'string' ? String(draftValues[name]) : String(value);
        const nextValue: RuntimeSettingsValue = typeof value === 'number' ? Number(raw) : raw;
        if (nextValue === value) {
          return;
        }
        await savePatch(name, nextValue);
      };

      const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
        if (event.key === 'Enter') {
          event.currentTarget.blur();
        }
      };

      return (
        <label key={name} className="block space-y-1">
          <p className="text-xs text-slate-300">{getAuthoringParameterLabel(selectedBlock?.blockTypeId ?? '', name, name)}</p>
          <p className="text-[11px] text-slate-400">{typeLabel}</p>
          <input
            type={typeof value === 'number' ? 'number' : 'text'}
            value={inputValue}
            disabled={!editable || mutation.isPending}
            onChange={(event) => {
              if (!editable) {
                return;
              }
              const nextValue = event.target.value;
              setDraftValues((current) => ({ ...current, [name]: nextValue }));
            }}
            onBlur={() => {
              void commitScalar();
            }}
            onKeyDown={onKeyDown}
            className="inspector-input disabled:opacity-70"
          />
        </label>
      );
    }

    return (
      <div key={name} className="space-y-1">
        <p className="text-xs text-slate-300">{getAuthoringParameterLabel(selectedBlock?.blockTypeId ?? '', name, name)}</p>
        <p className="text-[11px] text-slate-400">nested object</p>
        <pre className="whitespace-pre-wrap [overflow-wrap:anywhere] rounded bg-slate-950/70 p-2 text-[11px] text-slate-300">
          {JSON.stringify(value, null, 2)}
        </pre>
      </div>
    );
  };

  return (
    <InspectorSection>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="inspector-heading">Runtime</h3>
        {runtimeContext?.sessionId && <StatusPill status={runtimeContext.session?.state ?? 'unknown'} />}
      </div>

      {!runtimeContext?.sessionId ? (
        <p className="text-xs text-slate-400"><span aria-hidden="true">○ </span>No active session</p>
      ) : availability.state === 'unavailable' ? (
        <p className="text-xs text-slate-400">{availability.reason}</p>
      ) : null}

      {availability.state === 'ready' && (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-slate-400" title="Edits target the linked session. Use Apply to graph to copy editable values to the document. Tab-local plot settings retain their existing synchronization behavior.">
              Live session settings
            </span>
            <button type="button" className="inspector-button" aria-label="About runtime edits"
              title="Edits target the linked session. Apply to graph copies editable values into the document. Tab-local plot settings also synchronize with the graph."
              onClick={() => setShowHelp((current) => !current)} aria-expanded={showHelp}>?</button>
          </div>
          {showHelp && <p className="text-[11px] text-slate-400">
            Edits target the linked session. Apply to graph copies editable values into the document.
            Tab-local plot settings also synchronize with the graph.
          </p>}
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={applyRuntimeToGraph}
              disabled={query.isFetching || mutation.isPending || Object.keys(applicableGraphPatch).length === 0}
              className="inspector-button">Apply to graph</button>
            <button type="button" onClick={() => { void query.refetch(); }}
              disabled={query.isFetching || mutation.isPending} className="inspector-button">Refresh</button>
          </div>
        </>
      )}

      {availability.state === 'ready' && query.isPending && (
        <p className="text-sm text-slate-400">Loading runtime settings...</p>
      )}

      {availability.state === 'ready' && query.isError && (
        <p className="text-sm text-rose-300">{toRuntimeSettingsErrorMessage(query.error)}</p>
      )}

      {availability.state === 'ready' && saveError && (
        <p className="text-sm text-rose-300">{saveError}</p>
      )}

      {availability.state === 'ready' && applyMessage && (
        <p className="text-sm text-emerald-300">{applyMessage}</p>
      )}

      {availability.state === 'ready' && query.data && (
        <div className="space-y-3">
          {(query.isFetching || mutation.isPending) && <p role="status" className="text-[11px] text-slate-400">
            {mutation.isPending ? 'Saving…' : 'Refreshing…'}
          </p>}

          {editableEntries.length === 0 && advancedEntries.length === 0 && (
            <p className="text-sm text-slate-400">No live-editable runtime settings available for this block.</p>
          )}

          {editableEntries.length > 0 && (
            <div className="space-y-2">
              {editableEntries.map(([name, value]) => renderRuntimeValue(name, value, true))}
            </div>
          )}

          {advancedEntries.length > 0 && (
            <details className="inspector-disclosure">
              <summary className="text-xs text-slate-400">
                Runtime metadata ({advancedEntries.length})
              </summary>
              <div className="mt-2 space-y-2">
                {advancedEntries.map(([name, value]) => renderRuntimeValue(name, value, false))}
              </div>
            </details>
          )}
        </div>
      )}
    </InspectorSection>
  );
}

function SelectionTab({
  runtimeContext,
  graphDriftState,
}: {
  runtimeContext: ReturnType<typeof useRuntimeSessionStore.getState>['contextsByTabId'][string] | undefined;
  graphDriftState: 'in-sync' | 'out-of-sync' | null | undefined;
}) {
  const selectedBlock = useEditorStore((state) =>
    state.nodes.find((block) => block.instanceId === state.selectedNodeId),
  );
  const isVirtualRouting = selectedBlock ? isVirtualRoutingBlockType(selectedBlock.blockTypeId) : false;
  const isNote = selectedBlock ? isNoteBlockType(selectedBlock.blockTypeId) : false;
  const blockDetailsQuery = useBlockDetailsQuery(selectedBlock?.blockTypeId);

  const draftParameterValues = Object.entries(selectedBlock?.parameters ?? {}).reduce<Record<string, string>>(
    (acc, [name, value]) => {
      acc[name] = value.value;
      return acc;
    },
    {},
  );
  const effectiveParameterValues = useMemo(() => {
    const values: Record<string, string> = { ...draftParameterValues };

    if (blockDetailsQuery.data) {
      for (const parameter of blockDetailsQuery.data.parameters) {
        if (!(parameter.name in values)) {
          values[parameter.name] = parameter.defaultValue ?? '';
        }
      }
    }

    return values;
  }, [blockDetailsQuery.data, draftParameterValues]);
  const studioBinding = useMemo(
    () =>
      selectedBlock
        ? buildStudioAuthoringBindingView(selectedBlock.blockTypeId, effectiveParameterValues)
        : null,
    [effectiveParameterValues, selectedBlock],
  );

  const renderedPorts =
    blockDetailsQuery.data && selectedBlock
      ? resolveRenderedPorts({
          schemaPorts: toSchemaPorts(blockDetailsQuery.data),
          parameterValues: effectiveParameterValues,
        })
      : { inputs: [], outputs: [] };

  if (!selectedBlock) {
    return (
      <EmptyState>
        Select a block on the canvas.
        <p className="mt-2 text-xs text-slate-500">Double-click a block to open properties.</p>
      </EmptyState>
    );
  }

  return (
    <>
      <SelectionHeader block={selectedBlock} details={blockDetailsQuery.data} />

      {blockDetailsQuery.isPending && <EmptyState>Loading block properties…</EmptyState>}
      {blockDetailsQuery.isError && (
        <p role="alert" className="inspector-section text-xs text-rose-300 [overflow-wrap:anywhere]">
          Failed to load block properties: {blockDetailsQuery.error.message}
        </p>
      )}
      {blockDetailsQuery.data && <SelectionParameters key={`parameters:${selectedBlock.instanceId}`} block={selectedBlock} details={blockDetailsQuery.data} />}
      {studioBinding && (studioBinding.status === 'invalid' || studioBinding.status === 'unconfigured') && (
        <p role="alert" className="rounded border border-amber-600 bg-amber-900/20 p-2 text-xs text-amber-200 [overflow-wrap:anywhere]">
          Studio display binding: {studioBinding.reason}
        </p>
      )}

      <InspectorSection>
        <h3 className="inspector-heading">Ports</h3>
        {blockDetailsQuery.isPending && <p className="text-xs text-slate-400">Loading ports…</p>}
        {blockDetailsQuery.isError && <p className="text-xs text-slate-400">Ports unavailable.</p>}
        {blockDetailsQuery.data && <SelectionPorts ports={renderedPorts} />}
      </InspectorSection>

      {isVirtualRouting || isNote ? (
        <InspectorSection>
          <h3 className="inspector-heading">Runtime</h3>
          <p className="text-xs text-slate-400" title={isNote
            ? 'Notes are removed before runtime submission.'
            : 'Virtual routes become direct graph connections before runtime submission.'}>
            Editor-only {isNote ? 'note' : 'virtual route'}
          </p>
        </InspectorSection>
      ) : (
        <RuntimeSettingsSection
          key={`runtime:${selectedBlock.instanceId}`}
          runtimeContext={runtimeContext}
          graphDriftState={graphDriftState}
          selectedBlock={selectedBlock}
          blockDetails={blockDetailsQuery.data}
        />
      )}

      <SelectionAdvanced block={selectedBlock} binding={studioBinding}
        ports={renderedPorts} details={blockDetailsQuery.data} />
    </>
  );
}

export function InspectorPanel({ onCollapse }: { onCollapse?: () => void }) {
  const [activeTab, setActiveTab] = useState<InspectorTabId>('selection');
  const activeGraphTabId = useGraphTabsStore((state) => state.activeTabId);
  const activeGraphTab = useGraphTabsStore((state) =>
    state.activeTabId ? state.tabs.find((tab) => tab.id === state.activeTabId) ?? null : null,
  );
  const runtimeContext = useRuntimeSessionStore((state) =>
    activeGraphTabId ? state.contextsByTabId[activeGraphTabId] : undefined,
  );
  const refreshSessionStateForTab = useRuntimeSessionStore((state) => state.refreshSessionStateForTab);
  const getTabRuntimeView = useRuntimeSessionStore((state) => state.getTabRuntimeView);

  const documentName = useEditorStore((state) => state.documentName);
  const documentDescription = useEditorStore((state) => state.documentDescription);
  const setDocumentDescription = useEditorStore((state) => state.setDocumentDescription);
  const schedulerId = useEditorStore((state) => state.schedulerId);
  const setDocumentSchedulerId = useEditorStore((state) => state.setDocumentSchedulerId);
  const studioPanels = useEditorStore((state) => state.studioPanels);
  const studioVariables = useEditorStore((state) => state.studioVariables);
  const studioLayout = useEditorStore((state) => state.studioLayout);
  const studioPlotPalettes = useEditorStore((state) => state.studioPlotPalettes);
  const application = useEditorStore((state) => state.application);
  const setApplication = useEditorStore((state) => state.setApplication);
  const nodes = useEditorStore((state) => state.nodes);
  const edges = useEditorStore((state) => state.edges);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const uniqueBlockTypes = useMemo(() => Array.from(new Set(nodes.map((node) => node.blockTypeId))), [nodes]);
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
  const schedulersQuery = useSchedulersQuery(activeTab === 'graph' || activeTab === 'session');
  const schedulerOptions = useMemo(
    () => (schedulersQuery.data ?? []).map((scheduler) => scheduler.id),
    [schedulersQuery.data],
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
    [
      application,
      documentDescription,
      documentName,
      edges,
      nodes,
      schedulerId,
      studioLayout,
      studioPanels,
      studioPlotPalettes,
      studioVariables,
    ],
  );

  const virtualRouteIssues = useMemo(
    () => getEditorVirtualRouteIssues(nodes, edges),
    [edges, nodes],
  );
  const currentSubmissionResult = useMemo(() => {
    try {
      return {
        content: buildCurrentGraphSubmissionFromEditorSnapshot(currentSnapshot, { blockDetailsByType }).content,
        error: null,
      };
    } catch (error) {
      return {
        content: '',
        error: error instanceof Error ? error.message : 'Could not build graph submission.',
      };
    }
  }, [blockDetailsByType, currentSnapshot]);

  const runtimeView = activeGraphTabId
    ? getTabRuntimeView(activeGraphTabId, currentSubmissionResult.content, schedulerId)
    : null;
  const canExportCurrentGraph = canDownloadCurrentGraph(activeGraphTab);

  const handleDownloadGrc = () => {
    const result = downloadCurrentGraphAsGr4c({
      activeGraphName: activeGraphTab?.title,
      buildSubmission: () => buildCurrentGraphSubmissionFromEditorSnapshot(currentSnapshot, { blockDetailsByType }),
      win: window,
    });

    if (result.kind === 'error') {
      setDownloadError(result.message);
      return;
    }

    setDownloadError(null);
  };

  const tabItems = useMemo(
    () =>
      [
        { id: 'selection', label: 'Selection' },
        { id: 'graph', label: 'Graph' },
        { id: 'session', label: 'Session' },
      ] satisfies Array<{ id: InspectorTabId; label: string }>,
    [],
  );

  const inProcessControlPlane = isControlPlaneWasmEnabled();
  const applicationMode = effectiveApplicationMode(application?.mode ?? 'in_app', { inProcessControlPlane });
  const applicationTitle = application?.title ?? '';
  const updateApplicationMode = (mode: ApplicationMode) => {
    setApplication({
      mode,
      renderer: application?.renderer ?? 'react',
      title: application?.title,
    });
  };
  const updateApplicationTitle = (title: string) => {
    setApplication({
      mode: application?.mode ?? 'in_app',
      renderer: application?.renderer ?? 'react',
      title,
    });
  };

  return (
    <div className="inspector h-full min-h-0 min-w-0 flex flex-col" aria-label="Inspector">
      <PanelHeader title="Inspector">
        {onCollapse ? (
          <SidePanelToggleButton direction="right" label="Collapse inspector" onClick={onCollapse} />
        ) : null}
      </PanelHeader>

      <div className="shrink-0 border-b border-slate-700 px-2 py-2">
        <div className="grid grid-cols-3 gap-1">
          {tabItems.map((tab) => (
            <button
              key={tab.id}
              type="button"
              aria-pressed={activeTab === tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`rounded px-2 py-1 text-xs transition-colors ${
                activeTab === tab.id
                  ? 'bg-selected text-slate-100 ring-1 ring-inset ring-accent'
                  : 'bg-slate-900 text-slate-400 hover:bg-slate-800 hover:text-slate-200'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      <div className="inspector-content min-h-0 min-w-0 flex-1 px-3 py-3 overflow-y-auto [overflow-wrap:anywhere]">
        {activeTab === 'selection' && (
          <SelectionTab
            runtimeContext={runtimeContext}
            graphDriftState={runtimeView?.graphDriftState}
          />
        )}

        {activeTab === 'graph' && (
          <GraphDetails key={`graph:${activeGraphTabId}`} name={documentName} description={documentDescription} onDescriptionChange={setDocumentDescription}
            blockCount={nodes.length} connectionCount={edges.length} schedulerId={schedulerId} schedulers={schedulerOptions}
            schedulersPending={schedulersQuery.isPending} schedulersError={schedulersQuery.isError}
            onSchedulerChange={setDocumentSchedulerId} mode={applicationMode} displayTitle={applicationTitle}
            displayTitlePlaceholder={activeGraphTab?.document.displayName || documentName || 'Application'}
            inProcessControlPlane={inProcessControlPlane} onModeChange={updateApplicationMode} onDisplayTitleChange={updateApplicationTitle}
            runtimeView={runtimeView} canExport={canExportCurrentGraph} onExport={handleDownloadGrc} exportError={downloadError}
            issues={(virtualRouteIssues.length > 0 || currentSubmissionResult.error) && (
              <InspectorSection title="Graph issues">
                {currentSubmissionResult.error && <p role="alert" className="text-xs text-rose-300">{currentSubmissionResult.error}</p>}
                {virtualRouteIssues.map((issue) => <p key={`${issue.severity}:${issue.message}:${issue.nodeIds.join(',')}`}
                  className={`text-xs ${issue.severity === 'error' ? 'text-rose-300' : 'text-amber-200'}`}>{issue.message}</p>)}
              </InspectorSection>
            )}
          />
        )}

        {activeTab === 'session' && (
          <SessionDetails key={`session:${activeGraphTabId}:${runtimeContext?.sessionId ?? 'unlinked'}`} context={runtimeContext}
            runtimeView={runtimeView} canRefresh={Boolean(activeGraphTabId)}
            onRefresh={() => { if (activeGraphTabId) void refreshSessionStateForTab(activeGraphTabId); }} />
        )}

        {!activeGraphTabId && <EmptyState>No active graph tab selected.</EmptyState>}
      </div>
    </div>
  );
}
