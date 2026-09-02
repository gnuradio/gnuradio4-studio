import { useEffect, useMemo, useState, type KeyboardEvent, type ReactNode } from 'react';
import { useQueries } from '@tanstack/react-query';
import { PanelHeader } from '../../components/panel-header';
import { StatusPill } from '../../components/status-pill';
import { formatTimestamp } from '../../lib/utils/ui-formatting';
import { isAdvancedParameterName, isAdvancedUiHint } from '../../lib/utils/parameter-groups';
import { resolveRenderedPorts } from '../ports/model/resolveRenderedPorts';
import type { SchemaPort } from '../ports/model/types';
import { useBlockDetailsQuery } from './hooks/use-block-details-query';
import { useRuntimeBlockSettings } from './hooks/use-runtime-block-settings';
import { useSchedulersQuery } from './hooks/use-schedulers-query';
import {
  resolveRuntimeSettingsAvailability,
  toRuntimeSettingsErrorMessage,
} from './runtime-settings-model';
import { useEditorStore } from '../graph-editor/store/editorStore';
import { useGraphTabsStore, type EditorSnapshot } from '../graph-tabs/store/graphTabsStore';
import type { ApplicationMode } from '../graph-document/model/studio-workspace';
import type { RuntimeSettingsValue } from '../../lib/api/block-settings';
import { useRuntimeSessionStore } from '../runtime-session/store/runtimeSessionStore';
import { buildCurrentGraphSubmissionFromEditorSnapshot } from '../runtime-submission/model/current-graph-submission';
import { canDownloadCurrentGraph, downloadCurrentGraphAsGr4c } from '../document-file/gr4c-download';
import { toCanonicalBlockDisplayName } from '../graph-editor/model/presentation';
import type { BlockDetails, BlockParameterMeta } from '../../lib/api/block-details';
import { getBlockDetails } from '../../lib/api/block-details';
import {
  buildStudioAuthoringBindingView,
  getDescriptorBindingAuthoringMessage,
} from '../graph-editor/runtime/studio-managed-runtime-authoring';
import {
  getEditorVirtualRouteIssues,
  getVirtualRoutingBlockDetails,
  isNoteBlockType,
  isVirtualRoutingBlockType,
} from '../graph-editor/model/virtual-routing';
import { SidePanelToggleButton } from '../../components/side-panel-toggle-button';

type InspectorTabId = 'selection' | 'graph' | 'session';

function graphSubmissionLabel(state: 'none' | 'current' | 'stale' | undefined): string {
  if (state === 'current') {
    return 'linked session snapshot current';
  }
  if (state === 'stale') {
    return 'linked session snapshot stale';
  }
  return 'no snapshot baseline';
}

function runIntentLabel(state: 'none' | 'create-session' | 'replace-session-from-edits' | 'start-linked-session' | undefined): string {
  if (state === 'create-session') {
    return 'Run creates and starts a new session from current graph.';
  }
  if (state === 'replace-session-from-edits') {
    return 'Run replaces the linked session with a new session from current graph edits.';
  }
  if (state === 'start-linked-session') {
    return 'Run starts the linked session.';
  }
  return 'Session currently running.';
}

function SummaryLabel({ children }: { children: string }) {
  return <p className="text-xs uppercase tracking-wide text-slate-400">{children}</p>;
}

function SummaryValue({ children }: { children: ReactNode }) {
  return <p className="text-sm text-slate-100 font-medium break-words">{children}</p>;
}

function SectionCard({ children }: { children: ReactNode }) {
  return <div className="rounded-md border border-slate-700 bg-slate-900/60 p-3 space-y-2">{children}</div>;
}

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
    <div className="rounded-md border border-dashed border-slate-700 p-3 text-sm text-slate-400">
      {children}
    </div>
  );
}

function bindingStateClass(state: 'unsupported' | 'unconfigured' | 'configured' | 'invalid'): string {
  if (state === 'configured') {
    return 'border-emerald-600/60 bg-emerald-900/20 text-emerald-200';
  }
  if (state === 'unconfigured') {
    return 'border-amber-600/60 bg-amber-900/20 text-amber-200';
  }
  if (state === 'invalid') {
    return 'border-rose-600/60 bg-rose-900/20 text-rose-200';
  }
  return 'border-slate-600 bg-slate-800/70 text-slate-300';
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

function RuntimeSettingsCard({
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

  useEffect(() => {
    if (!query.data) {
      setDraftValues({});
      return;
    }

    const nextDraft: Record<string, string | boolean> = {};
    for (const [key, value] of Object.entries(query.data)) {
      if (typeof value === 'boolean') {
        nextDraft[key] = value;
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
      if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
        nextPatch[name] = String(value);
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
    const enumChoices = parameterMeta?.enumChoices ?? [];
    const hasEnumChoices = enumChoices.length > 0;

    if (typeof value === 'boolean') {
      const checked = Boolean(draftValues[name]);
      return (
        <label key={name} className="flex items-center justify-between gap-3 rounded border border-slate-700 p-2">
          <div>
            <p className="text-xs uppercase tracking-wide text-slate-400">{name}</p>
            <p className="text-[11px] text-slate-500">{typeLabel}</p>
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
          <label key={name} className="block rounded border border-slate-700 p-2">
            <p className="text-xs uppercase tracking-wide text-slate-400">{name}</p>
            <p className="mb-2 text-[11px] text-slate-500">{typeLabel}</p>
            <select
              value={selectValue}
              disabled={!editable || mutation.isPending}
              onChange={(event) => {
                if (!editable) {
                  return;
                }
                const nextValue = event.target.value;
                setDraftValues((current) => ({ ...current, [name]: nextValue }));
                void savePatch(name, nextValue);
              }}
              className="w-full rounded border border-slate-600 bg-slate-900 px-2 py-1 text-sm text-slate-100 outline-none focus:border-cyan-500 disabled:opacity-70"
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
        <label key={name} className="block rounded border border-slate-700 p-2">
          <p className="text-xs uppercase tracking-wide text-slate-400">{name}</p>
          <p className="mb-2 text-[11px] text-slate-500">{typeLabel}</p>
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
            className="w-full rounded border border-slate-600 bg-slate-900 px-2 py-1 text-sm text-slate-100 outline-none focus:border-cyan-500 disabled:opacity-70"
          />
        </label>
      );
    }

    return (
      <div key={name} className="rounded border border-slate-700 p-2">
        <p className="text-xs uppercase tracking-wide text-slate-400">{name}</p>
        <p className="mb-2 text-[11px] text-slate-500">nested object</p>
        <pre className="overflow-x-auto whitespace-pre-wrap break-words rounded bg-slate-950/70 p-2 text-[11px] text-slate-300">
          {JSON.stringify(value, null, 2)}
        </pre>
      </div>
    );
  };

  return (
    <SectionCard>
      <div className="flex items-start justify-between gap-3">
        <div>
          <SummaryLabel>Runtime Settings</SummaryLabel>
          <p className="text-[11px] text-slate-500">
            Live runtime edits target the linked session only. They do not change the graph document.
          </p>
        </div>
        {availability.state === 'ready' && (
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={applyRuntimeToGraph}
              disabled={query.isFetching || mutation.isPending || Object.keys(applicableGraphPatch).length === 0}
              className="rounded border border-emerald-700/70 bg-emerald-900/30 px-2 py-1 text-[11px] text-emerald-100 hover:bg-emerald-800/40 disabled:opacity-50"
            >
              Apply To Graph
            </button>
            <button
              type="button"
              onClick={() => {
                void query.refetch();
              }}
              disabled={query.isFetching || mutation.isPending}
              className="rounded border border-slate-600 bg-slate-800 px-2 py-1 text-[11px] text-slate-100 hover:bg-slate-700 disabled:opacity-50"
            >
              Refresh
            </button>
          </div>
        )}
      </div>

      {availability.state === 'unavailable' && (
        <p className="text-sm text-slate-400">{availability.reason}</p>
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
          <div className="rounded border border-slate-700 bg-slate-950/50 px-2 py-1 text-[11px] text-slate-400">
            target: {uniqueName}
            {query.isFetching && ' · loading'}
            {mutation.isPending && ' · saving'}
          </div>

          {editableEntries.length === 0 && advancedEntries.length === 0 && (
            <p className="text-sm text-slate-400">No live-editable runtime settings available for this block.</p>
          )}

          {editableEntries.length > 0 && (
            <div className="space-y-2">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-emerald-300">Editable</p>
              {editableEntries.map(([name, value]) => renderRuntimeValue(name, value, true))}
            </div>
          )}

          {advancedEntries.length > 0 && (
            <details className="rounded border border-slate-700 bg-slate-950/30 p-2">
              <summary className="cursor-pointer text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                Advanced ({advancedEntries.length})
              </summary>
              <div className="mt-2 space-y-2">
                {advancedEntries.map(([name, value]) => renderRuntimeValue(name, value, false))}
              </div>
            </details>
          )}
        </div>
      )}
    </SectionCard>
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
  const canonicalDisplayName = selectedBlock
    ? toCanonicalBlockDisplayName(selectedBlock.displayName, selectedBlock.blockTypeId)
    : '';
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
  const descriptorBindingAuthoringMessage = selectedBlock
    ? getDescriptorBindingAuthoringMessage(selectedBlock.blockTypeId)
    : null;

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
      <SectionCard>
        <div>
          <SummaryLabel>Instance ID</SummaryLabel>
          <SummaryValue>{selectedBlock.instanceId}</SummaryValue>
        </div>
        <div>
          <SummaryLabel>Block Type ID</SummaryLabel>
          <SummaryValue>{selectedBlock.blockTypeId}</SummaryValue>
        </div>
        <div>
          <SummaryLabel>Display Name</SummaryLabel>
          <SummaryValue>{canonicalDisplayName}</SummaryValue>
        </div>
      </SectionCard>

      {isVirtualRouting || isNote ? (
        <SectionCard>
          <SummaryLabel>{isNote ? 'Note' : 'Virtual Route'}</SummaryLabel>
          <p className="text-sm text-slate-300">
            {isNote
              ? 'This block is editor-only. It displays text on the graph canvas and is removed before runtime submission.'
              : 'This block is editor-only. It is removed before runtime submission and replaced with direct graph connections through its matching stream_id.'}
          </p>
        </SectionCard>
      ) : (
        <RuntimeSettingsCard
          runtimeContext={runtimeContext}
          graphDriftState={graphDriftState}
          selectedBlock={selectedBlock}
          blockDetails={blockDetailsQuery.data}
        />
      )}

      <SectionCard>
        <SummaryLabel>Resolved Ports</SummaryLabel>

        {blockDetailsQuery.isPending && <p className="text-sm text-slate-400">Loading port schema...</p>}
        {blockDetailsQuery.isError && (
          <p className="text-sm text-rose-300">Failed to resolve ports: {blockDetailsQuery.error.message}</p>
        )}

        {blockDetailsQuery.data && renderedPorts.inputs.length === 0 && renderedPorts.outputs.length === 0 && (
          <p className="text-sm text-slate-400">No ports available for this block.</p>
        )}

        {renderedPorts.inputs.length > 0 && (
          <div>
            <p className="text-xs text-slate-400 mb-1">Inputs</p>
            <ul className="space-y-1">
              {renderedPorts.inputs.map((port) => (
                <li key={port.key} className="text-xs text-slate-300">
                  {port.displayLabel} · {port.inference}
                </li>
              ))}
            </ul>
          </div>
        )}

        {renderedPorts.outputs.length > 0 && (
          <div>
            <p className="text-xs text-slate-400 mb-1">Outputs</p>
            <ul className="space-y-1">
              {renderedPorts.outputs.map((port) => (
                <li key={port.key} className="text-xs text-slate-300">
                  {port.displayLabel} · {port.inference}
                </li>
              ))}
            </ul>
          </div>
        )}
      </SectionCard>

      {studioBinding && (
        <SectionCard>
          <SummaryLabel>Studio Binding</SummaryLabel>
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs uppercase tracking-wide text-slate-400">State</p>
              <span
                className={`rounded border px-2 py-0.5 text-[11px] font-medium ${bindingStateClass(studioBinding.status)}`}
              >
                {studioBinding.status}
              </span>
            </div>

            {studioBinding.family && (
              <div>
                <SummaryLabel>Binding Kind</SummaryLabel>
                <SummaryValue>{studioBinding.family}</SummaryValue>
              </div>
            )}

            {studioBinding.transport && (
              <div>
                <SummaryLabel>Transport</SummaryLabel>
                <SummaryValue>{studioBinding.transport}</SummaryValue>
              </div>
            )}

            {studioBinding.endpoint && (
              <div>
                <SummaryLabel>Endpoint</SummaryLabel>
                <SummaryValue>{studioBinding.endpoint}</SummaryValue>
              </div>
            )}

            {typeof studioBinding.updateMs === 'number' && (
              <div>
                <SummaryLabel>Update Interval (ms)</SummaryLabel>
                <SummaryValue>{String(studioBinding.updateMs)}</SummaryValue>
              </div>
            )}

            {typeof studioBinding.sampleRate === 'number' && (
              <div>
                <SummaryLabel>Sample Rate</SummaryLabel>
                <SummaryValue>{String(studioBinding.sampleRate)}</SummaryValue>
              </div>
            )}

            {typeof studioBinding.channels === 'number' && (
              <div>
                <SummaryLabel>Channels</SummaryLabel>
                <SummaryValue>{String(studioBinding.channels)}</SummaryValue>
              </div>
            )}

            {studioBinding.topic && (
              <div>
                <SummaryLabel>Topic</SummaryLabel>
                <SummaryValue>{studioBinding.topic}</SummaryValue>
              </div>
            )}

            {studioBinding.payloadFormat && (
              <div>
                <SummaryLabel>Payload Format</SummaryLabel>
                <SummaryValue>{studioBinding.payloadFormat}</SummaryValue>
              </div>
            )}

            {studioBinding.reason && (
              <p className="text-xs text-slate-300 break-words">{studioBinding.reason}</p>
            )}

            {descriptorBindingAuthoringMessage && (
              <p className="text-[11px] text-sky-200 break-words">{descriptorBindingAuthoringMessage}</p>
            )}

            <p className="text-[11px] text-slate-500">
              Local binding validation only; backend/runtime behavior remains authoritative.
            </p>
          </div>
        </SectionCard>
      )}
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

  const recentActivity = runtimeContext?.activity.slice(0, 15) ?? [];
  const applicationMode = application?.mode ?? 'in_app';
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
    <div className="h-full min-h-0 flex flex-col">
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
              onClick={() => setActiveTab(tab.id)}
              className={`rounded px-2 py-1 text-xs transition-colors ${
                activeTab === tab.id
                  ? 'bg-slate-700 text-slate-100'
                  : 'bg-slate-900 text-slate-400 hover:bg-slate-800 hover:text-slate-200'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      <div className="min-h-0 flex-1 p-3 space-y-3 overflow-y-auto">
        {activeTab === 'selection' && (
          <SelectionTab
            runtimeContext={runtimeContext}
            graphDriftState={runtimeView?.graphDriftState}
          />
        )}

        {activeTab === 'graph' && (
          <>
            <SectionCard>
              <SummaryLabel>Local Graph</SummaryLabel>
              <div className="space-y-2">
                <div>
                  <SummaryLabel>Name</SummaryLabel>
                  <SummaryValue>{documentName}</SummaryValue>
                </div>
                <div>
                  <SummaryLabel>Description</SummaryLabel>
                  <SummaryValue>{documentDescription || 'N/A'}</SummaryValue>
                </div>
                <div>
                  <SummaryLabel>Scheduler</SummaryLabel>
                  <select
                    value={schedulerId ?? ''}
                    onChange={(event) => setDocumentSchedulerId(event.target.value || undefined)}
                    disabled={schedulersQuery.isPending || schedulersQuery.isError}
                    className="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 text-sm text-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <option value="">Default scheduler</option>
                    {schedulerOptions.map((id) => (
                      <option key={id} value={id}>
                        {id}
                      </option>
                    ))}
                  </select>
                  {schedulersQuery.isError && <SummaryValue>Failed to load schedulers.</SummaryValue>}
                </div>
                <div>
                  <SummaryLabel>Display Mode</SummaryLabel>
                  <select
                    value={applicationMode}
                    onChange={(event) => updateApplicationMode(event.target.value as ApplicationMode)}
                    className="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 text-sm text-slate-100"
                  >
                    <option value="in_app">In-app</option>
                    <option value="new_tab">New tab</option>
                    <option value="popout">Popout</option>
                  </select>
                </div>
                <div>
                  <SummaryLabel>Display Title</SummaryLabel>
                  <input
                    type="text"
                    value={applicationTitle}
                    onChange={(event) => updateApplicationTitle(event.target.value)}
                    placeholder={activeGraphTab?.document.displayName || documentName || 'Application'}
                    className="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 text-sm text-slate-100 placeholder:text-slate-500"
                  />
                </div>
                <div>
                  <SummaryLabel>Blocks</SummaryLabel>
                  <SummaryValue>{String(nodes.length)}</SummaryValue>
                </div>
                <div>
                  <SummaryLabel>Connections</SummaryLabel>
                  <SummaryValue>{String(edges.length)}</SummaryValue>
                </div>
                <div>
                  <SummaryLabel>Submission Snapshot</SummaryLabel>
                  <SummaryValue>{graphSubmissionLabel(runtimeView?.graphSubmissionState)}</SummaryValue>
                </div>
                <div>
                  <SummaryLabel>Submitted At</SummaryLabel>
                  <SummaryValue>{formatTimestamp(new Date(runtimeView?.graphSubmissionUpdatedAt ?? '').getTime())}</SummaryValue>
                </div>
                <div>
                  <SummaryLabel>Run Intent</SummaryLabel>
                  <SummaryValue>{runIntentLabel(runtimeView?.runIntent)}</SummaryValue>
                </div>
              </div>
              {(virtualRouteIssues.length > 0 || currentSubmissionResult.error) && (
                <div className="space-y-2 rounded border border-slate-700 bg-slate-950/50 p-2">
                  <SummaryLabel>Graph Issues</SummaryLabel>
                  {currentSubmissionResult.error && (
                    <p className="text-xs text-rose-300">{currentSubmissionResult.error}</p>
                  )}
                  {virtualRouteIssues.map((issue) => (
                    <p
                      key={`${issue.severity}:${issue.message}:${issue.nodeIds.join(',')}`}
                      className={`text-xs ${issue.severity === 'error' ? 'text-rose-300' : 'text-amber-200'}`}
                    >
                      {issue.message}
                    </p>
                  ))}
                </div>
              )}
              <div className="pt-2">
                <button
                  type="button"
                  onClick={handleDownloadGrc}
                  disabled={!canExportCurrentGraph}
                  title={canExportCurrentGraph ? 'Download the current graph as a .gr4c file.' : 'No active graph to export.'}
                  className="rounded border border-slate-600 bg-slate-800 px-2 py-1 text-xs text-slate-100 hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Download .gr4c
                </button>
              </div>
              {downloadError && <p className="text-sm text-rose-300">{downloadError}</p>}
            </SectionCard>
          </>
        )}

        {activeTab === 'session' && (
          <>
            <SectionCard>
              <SummaryLabel>Session</SummaryLabel>
              <div className="space-y-2">
                <div>
                  <SummaryLabel>Session ID</SummaryLabel>
                  <SummaryValue>{runtimeContext?.sessionId ?? 'none'}</SummaryValue>
                </div>
                <div className="flex items-center gap-2">
                  <SummaryLabel>State</SummaryLabel>
                  <StatusPill status={runtimeContext?.session?.state ?? (runtimeContext?.sessionId ? 'unknown' : 'unlinked')} />
                </div>
                <div>
                  <SummaryLabel>Session Name</SummaryLabel>
                  <SummaryValue>{runtimeContext?.session?.name ?? 'N/A'}</SummaryValue>
                </div>
                <div>
                  <SummaryLabel>Scheduler</SummaryLabel>
                  <SummaryValue>{runtimeContext?.session?.schedulerId ?? 'default'}</SummaryValue>
                </div>
                <div>
                  <SummaryLabel>Session Created</SummaryLabel>
                  <SummaryValue>{formatTimestamp(new Date(runtimeContext?.session?.createdAt ?? '').getTime())}</SummaryValue>
                </div>
                <div>
                  <SummaryLabel>Session Updated</SummaryLabel>
                  <SummaryValue>{formatTimestamp(new Date(runtimeContext?.session?.updatedAt ?? '').getTime())}</SummaryValue>
                </div>
                <div>
                  <SummaryLabel>Session Refreshed</SummaryLabel>
                  <SummaryValue>{formatTimestamp(new Date(runtimeContext?.sessionRefreshedAt ?? '').getTime())}</SummaryValue>
                </div>
                <div>
                  <SummaryLabel>Graph/Session Sync</SummaryLabel>
                  <SummaryValue>{runtimeView?.graphDriftState === 'out-of-sync' ? 'linked session stale' : 'linked session in sync'}</SummaryValue>
                </div>
                <div>
                  <SummaryLabel>Last Error</SummaryLabel>
                  <SummaryValue>{runtimeContext?.lastError ?? runtimeContext?.session?.lastError ?? 'none'}</SummaryValue>
                </div>
              </div>

              <div className="pt-2">
                <button
                  type="button"
                  disabled={!activeGraphTabId || !runtimeContext?.sessionId || runtimeContext?.busy}
                  onClick={() => {
                    if (activeGraphTabId) {
                      void refreshSessionStateForTab(activeGraphTabId);
                    }
                  }}
                  className="rounded border border-slate-600 bg-slate-800 px-2 py-1 text-xs text-slate-100 hover:bg-slate-700 disabled:opacity-50"
                >
                  Refresh Session
                </button>
              </div>
            </SectionCard>

            {!runtimeContext?.sessionId && <EmptyState>No session linked to this tab yet.</EmptyState>}

            {runtimeContext?.sessionId && (
              <SectionCard>
                <SummaryLabel>Recent Activity</SummaryLabel>
                {recentActivity.length === 0 ? (
                  <p className="text-sm text-slate-400">No activity yet.</p>
                ) : (
                  <ul className="space-y-2">
                    {recentActivity.map((entry, index) => (
                      <li key={`${entry.timestamp}-${index}`} className="rounded border border-slate-700 p-2">
                        <p className="text-[11px] text-slate-400">{formatTimestamp(new Date(entry.timestamp).getTime())}</p>
                        <p className="text-xs text-slate-100 break-words">{entry.message}</p>
                        <p className={`text-[11px] ${entry.level === 'error' ? 'text-rose-300' : 'text-slate-500'}`}>action: {entry.action}</p>
                      </li>
                    ))}
                  </ul>
                )}
              </SectionCard>
            )}
          </>
        )}

        {!activeGraphTabId && <EmptyState>No active graph tab selected.</EmptyState>}
        {activeGraphTabId && !runtimeContext && <EmptyState>Execution context not initialized for this tab yet.</EmptyState>}
      </div>
    </div>
  );
}
