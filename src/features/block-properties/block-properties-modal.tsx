import { lookupStudioKnownBlockBinding } from '../graph-editor/runtime/known-block-bindings';
import { studioFftSummary, studioPropertyChoices, studioPropertyGroup, validateStudioProperties } from './studio-properties';
import { Fragment, useEffect, useMemo, useState, type MouseEvent } from 'react';
import type { BlockDetails, BlockParameterMeta } from '../../lib/api/block-details';
import { isAdvancedParameterName, isAdvancedUiHint } from '../../lib/utils/parameter-groups';
import { useEditorStore } from '../graph-editor/store/editorStore';
import { useBlockDetailsQuery } from '../inspector/hooks/use-block-details-query';
import { toCanonicalBlockDisplayName } from '../graph-editor/model/presentation';
import type { StudioPanelSpec } from '../graph-document/model/studio-workspace';
import {
  addControlWidgetToPanels,
  buildControlWidgetSpec,
  isControlWidgetParameterTarget,
  removeControlWidgetFromPanel,
} from '../control-panels/control-panel-authoring';
import type { ExpressionBinding } from '../variables/model/types';
import { DoxygenText } from '../documentation/model/doxygen';
import {
  getAuthoringParameterLabel,
  getDescriptorBindingAuthoringMessage,
  isDescriptorBindingHiddenParameter,
} from '../graph-editor/runtime/studio-managed-runtime-authoring';
import {
  getEditorVirtualRouteIssues,
  isNoteBlockType,
  isVirtualRoutingBlockType,
  isVirtualSinkBlockType,
  isVirtualSourceBlockType,
} from '../graph-editor/model/virtual-routing';

type BlockPropertiesModalProps = {
  instanceId: string;
  onClose: () => void;
};

type ModalTab = 'general' | 'readonly' | 'advanced' | 'documentation';

type DraftValue = {
  value: string;
  bindingKind: 'literal' | 'expression';
};

type DraftMap = Record<string, DraftValue>;
const EMPTY_STUDIO_PANELS: readonly StudioPanelSpec[] = [];
const PARAMETER_ROW_GRID = 'grid grid-cols-[minmax(0,9.5rem)_6rem_minmax(0,1fr)_4rem_1.75rem] items-center gap-1.5';

function isAdvancedParameterMeta(parameter: BlockParameterMeta): boolean {
  return isAdvancedParameterName(parameter.name) || isAdvancedUiHint(parameter.uiHint);
}

export function getBlockParameterTypeLabel(parameter: BlockParameterMeta): string {
  return parameter.valueType?.trim() || (parameter.valueKind === 'enum' ? 'enum' : 'scalar');
}

export function getBlockParameterHoverTitle(parameter: BlockParameterMeta): string {
  return parameter.description?.trim() || parameter.label;
}

export function getBlockParameterEnumTypeLabel(parameter: BlockParameterMeta): string {
  return parameter.enumType?.trim() || '';
}

export function isBooleanBlockParameter(parameter: BlockParameterMeta): boolean {
  const normalized = parameter.valueType?.trim().toLowerCase();
  return normalized === 'bool' || normalized === 'boolean';
}

export function coerceBlockPropertyLiteralValue(value: string): string | number | boolean | null {
  const trimmed = value.trim();
  if (trimmed === 'true') {
    return true;
  }
  if (trimmed === 'false') {
    return false;
  }
  if (trimmed === 'null') {
    return null;
  }
  return value;
}

function buildInitialDraftValues(
  persistedValues: Record<string, { value: string; bindingKind: 'literal' | 'expression' }>,
  blockDetails: BlockDetails,
): DraftMap {
  const fromMetadata = blockDetails.parameters.reduce<DraftMap>((acc, parameter) => {
    acc[parameter.name] = {
      value: persistedValues[parameter.name]?.value ?? parameter.defaultValue ?? '',
      bindingKind: persistedValues[parameter.name]?.bindingKind ?? 'literal',
    };
    return acc;
  }, {});

  for (const [name, entry] of Object.entries(persistedValues)) {
    if (!(name in fromMetadata)) {
      fromMetadata[name] = {
        value: entry.value,
        bindingKind: entry.bindingKind,
      };
    }
  }

  return fromMetadata;
}

export function BlockPropertiesModal({ instanceId, onClose }: BlockPropertiesModalProps) {
  const block = useEditorStore((state) => state.getNodeById(instanceId));
  const nodes = useEditorStore((state) => state.nodes);
  const edges = useEditorStore((state) => state.edges);
  const updateNodeParameterBindings = useEditorStore((state) => state.updateNodeParameterBindings);
  const studioPanels = useEditorStore((state) => state.studioPanels);
  const setStudioPanels = useEditorStore((state) => state.setStudioPanels);

  const [activeTab, setActiveTab] = useState<ModalTab>('general');
  const [draftValues, setDraftValues] = useState<DraftMap>({});
  const [isDraftInitialized, setIsDraftInitialized] = useState(false);
  const [pendingControlParameter, setPendingControlParameter] = useState<BlockParameterMeta | null>(null);

  const blockDetailsQuery = useBlockDetailsQuery(block?.blockTypeId);
  const isNoteBlock = block ? isNoteBlockType(block.blockTypeId) : false;
  const isVirtualRoutingBlock = block ? isVirtualRoutingBlockType(block.blockTypeId) : false;
  const isVirtualSourceBlock = block ? isVirtualSourceBlockType(block.blockTypeId) : false;
  const virtualSinkStreamIds = useMemo(() => {
    const ids = nodes
      .filter((node) => isVirtualSinkBlockType(node.blockTypeId))
      .map((node) => node.parameters.stream_id?.value.trim() ?? '')
      .filter((value) => value.length > 0);
    return Array.from(new Set(ids)).sort((left, right) => left.localeCompare(right));
  }, [nodes]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  useEffect(() => {
    setActiveTab('general');
    setDraftValues({});
    setIsDraftInitialized(false);
    setPendingControlParameter(null);
  }, [instanceId]);

  useEffect(() => {
    if (!block || !blockDetailsQuery.data || isDraftInitialized) {
      return;
    }

    setDraftValues(buildInitialDraftValues(block.parameters, blockDetailsQuery.data));
    setIsDraftInitialized(true);
  }, [block, blockDetailsQuery.data, isDraftInitialized]);

  const parameterRows = useMemo(() => {
    if (!blockDetailsQuery.data) {
      return [];
    }

    return blockDetailsQuery.data.parameters;
  }, [blockDetailsQuery.data]);
  const controlPanels = useMemo(
    () => (studioPanels ?? EMPTY_STUDIO_PANELS).filter((panel) => panel.kind === 'control'),
    [studioPanels],
  );
  const findControlWidgetBinding = (parameterName: string) =>
    (studioPanels ?? EMPTY_STUDIO_PANELS)
      .filter((panel): panel is Extract<StudioPanelSpec, { kind: 'control' }> => panel.kind === 'control')
      .map((panel) => ({
        panel,
        widget: panel.widgets.find(
          (widget) =>
            widget.binding.kind === 'parameter' &&
            widget.binding.nodeId === blockInstanceId &&
            widget.binding.parameterName === parameterName,
        ),
      }))
      .find((entry): entry is { panel: Extract<StudioPanelSpec, { kind: 'control' }>; widget: NonNullable<typeof entry.widget> } =>
        Boolean(entry.widget),
      ) ?? null;
  const editableParameters = useMemo(
    () =>
      parameterRows.filter(
        (parameter) =>
          !isAdvancedParameterMeta(parameter) &&
          !isDescriptorBindingHiddenParameter(block?.blockTypeId ?? '', parameter.name) &&
          !parameter.readOnly &&
          parameter.mutable,
      ).sort((left, right) => {
        const groups = ['', 'Input', 'Display', 'Updates and connection'];
        return groups.indexOf(studioPropertyGroup(block?.blockTypeId ?? '', left.name)) -
          groups.indexOf(studioPropertyGroup(block?.blockTypeId ?? '', right.name));
      }),
    [block?.blockTypeId, parameterRows],
  );
  const readOnlyParameters = useMemo(
    () =>
      parameterRows.filter(
        (parameter) => !isDescriptorBindingHiddenParameter(block?.blockTypeId ?? '', parameter.name) && (parameter.readOnly || !parameter.mutable),
      ),
    [block?.blockTypeId, parameterRows],
  );
  const advancedParameters = useMemo(
    () =>
      parameterRows.filter(
        (parameter) =>
          isAdvancedParameterMeta(parameter) &&
          !isDescriptorBindingHiddenParameter(block?.blockTypeId ?? '', parameter.name) &&
          !parameter.readOnly &&
          parameter.mutable,
      ),
    [block?.blockTypeId, parameterRows],
  );
  const propertyErrors = validateStudioProperties(block?.blockTypeId ?? '',
    Object.fromEntries(Object.entries(draftValues).filter(([name]) =>
      !isDescriptorBindingHiddenParameter(block?.blockTypeId ?? '', name))));
  const fftSummary = studioFftSummary(block?.blockTypeId ?? '', draftValues);
  const canCommit = isDraftInitialized && !blockDetailsQuery.isPending && !blockDetailsQuery.isError &&
    Object.keys(propertyErrors).length === 0;
  const virtualRouteIssues = useMemo(() => {
    if (!block || !isVirtualRoutingBlock) {
      return [];
    }

    const draftedNodes = nodes.map((node) =>
      node.instanceId === block.instanceId
        ? {
            ...node,
            parameters: {
              ...node.parameters,
              stream_id: {
                value: draftValues.stream_id?.value ?? node.parameters.stream_id?.value ?? '',
                bindingKind: 'literal' as const,
              },
            },
          }
        : node,
    );

    return getEditorVirtualRouteIssues(draftedNodes, edges).filter((issue) =>
      issue.nodeIds.includes(block.instanceId),
    );
  }, [block, draftValues.stream_id?.value, edges, isVirtualRoutingBlock, nodes]);
  const setDraftValue = (parameterName: string, value: string) => {
    setDraftValues((prev) => ({
      ...prev,
      [parameterName]: {
        value,
        bindingKind: prev[parameterName]?.bindingKind ?? 'literal',
      },
    }));
  };

  const setDraftBindingKind = (parameterName: string, bindingKind: DraftValue['bindingKind']) => {
    setDraftValues((prev) => ({
      ...prev,
      [parameterName]: {
        value: prev[parameterName]?.value ?? '',
        bindingKind,
      },
    }));
  };

  const addControlForParameterToPanel = (parameter: BlockParameterMeta, targetPanelId?: string) => {
    if (!blockDetailsQuery.data || !isControlWidgetParameterTarget(parameter)) {
      return;
    }

    const widget = buildControlWidgetSpec({
      nodeId: blockInstanceId,
      parameter,
    });
    const nextPanels = addControlWidgetToPanels(studioPanels, { widget, targetPanelId });

    if (nextPanels !== studioPanels) {
      setStudioPanels(nextPanels);
    }

    setPendingControlParameter(null);
  };

  const handleControlAction = (parameter: BlockParameterMeta) => {
    const binding = findControlWidgetBinding(parameter.name);
    if (binding) {
      setStudioPanels(
        removeControlWidgetFromPanel(studioPanels, binding.panel.id, binding.widget.id),
      );
      return;
    }

    if (controlPanels.length === 0) {
      addControlForParameterToPanel(parameter);
      return;
    }

    if (controlPanels.length === 1) {
      addControlForParameterToPanel(parameter, controlPanels[0].id);
      return;
    }

    setPendingControlParameter(parameter);
  };

  const renderParameterValueInput = (parameter: BlockParameterMeta, disabled: boolean) => {
    const currentValue = draftValues[parameter.name]?.value ?? parameter.defaultValue ?? '';
    const bindingKind = draftValues[parameter.name]?.bindingKind ?? 'literal';
    const isLiteral = bindingKind === 'literal';
    const isBoolean = isBooleanBlockParameter(parameter);
    const enumChoices = studioPropertyChoices(block?.blockTypeId ?? '', parameter.name) ?? parameter.enumChoices ?? [];
    const enumTypeLabel = getBlockParameterEnumTypeLabel(parameter);
    const hasEnumChoices = enumChoices.length > 0;
    const isNoteTextParameter = isNoteBlock && parameter.name === 'text';
    const isVirtualStreamIdParameter = isVirtualRoutingBlock && parameter.name === 'stream_id';

    if (isNoteTextParameter && isLiteral) {
      return (
        <textarea
          value={currentValue}
          disabled={disabled}
          rows={5}
          onChange={(event) => setDraftValue(parameter.name, event.target.value)}
          className="w-full resize-y rounded border border-slate-600 bg-slate-900 px-2 py-1 text-sm leading-5 text-slate-100 disabled:opacity-60"
        />
      );
    }

    if (isVirtualStreamIdParameter && isLiteral) {
      const listId = `${block?.instanceId ?? 'virtual'}-stream-id-options`;
      return (
        <>
          <input
            type="text"
            value={currentValue}
            list={isVirtualSourceBlock && virtualSinkStreamIds.length > 0 ? listId : undefined}
            disabled={disabled}
            onChange={(event) => setDraftValue(parameter.name, event.target.value)}
            className="w-full rounded border border-slate-600 bg-slate-900 px-2 py-1 text-sm text-slate-100 disabled:opacity-60"
          />
          {isVirtualSourceBlock && virtualSinkStreamIds.length > 0 && (
            <datalist id={listId}>
              {virtualSinkStreamIds.map((streamId) => (
                <option key={streamId} value={streamId} />
              ))}
            </datalist>
          )}
        </>
      );
    }

    const binding = lookupStudioKnownBlockBinding(block?.blockTypeId ?? '');
    if (isLiteral && parameter.name === 'window_size' &&
        binding?.family === 'series2d' && binding.payloadFormat === 'dataset-xy-json-v1' && !binding.parameters.sampleRate) {
      return (
        <div className="flex min-w-0 gap-2">
          <select
            aria-label="Point limit"
            value={currentValue === '-1' ? 'all' : 'limit'}
            disabled={disabled}
            onChange={(event) => setDraftValue(parameter.name, event.target.value === 'all' ? '-1' : '1024')}
            className="min-w-0 rounded border border-slate-600 bg-slate-900 px-2 py-1 text-sm text-slate-100"
          >
            <option value="all">All points</option>
            <option value="limit">Limit points</option>
          </select>
          {currentValue !== '-1' && <input
            aria-label="Maximum points"
            type="number" min={1} step={1} value={currentValue} disabled={disabled}
            onChange={(event) => setDraftValue(parameter.name, event.target.value)}
            className="w-full min-w-0 rounded border border-slate-600 bg-slate-900 px-2 py-1 text-sm text-slate-100"
          />}
        </div>
      );
    }

    if (isBoolean && isLiteral) {
      const checked = coerceBlockPropertyLiteralValue(currentValue) === true;
      return (
        <label className="inline-flex min-w-0 items-center gap-2">
          <input
            type="checkbox"
            checked={checked}
            disabled={disabled}
            onChange={(event) => setDraftValue(parameter.name, event.currentTarget.checked ? 'true' : 'false')}
            className="h-4 w-4 rounded border-slate-600 bg-slate-900 text-emerald-500 focus:ring-emerald-500 disabled:opacity-60"
          />
          <span className="min-w-0 truncate text-xs text-slate-300">{checked ? 'true' : 'false'}</span>
        </label>
      );
    }

    if (!hasEnumChoices) {
      return (
        <input
          type="text"
          value={currentValue}
          disabled={disabled}
          onChange={(event) => setDraftValue(parameter.name, event.target.value)}
          className="w-full rounded border border-slate-600 bg-slate-900 px-2 py-1 text-sm text-slate-100 disabled:opacity-60"
        />
      );
    }

    const selectValue = currentValue;
    const visibleOptions = currentValue && !enumChoices.includes(currentValue) ? [currentValue, ...enumChoices] : enumChoices;

    return (
      <div className="flex min-w-0 items-center gap-2">
        <select
          value={selectValue}
          title={enumTypeLabel ? `enum_type: ${enumTypeLabel}` : undefined}
          disabled={disabled}
          onChange={(event) => {
            setDraftValue(parameter.name, event.target.value);
          }}
          className="w-full min-w-0 rounded border border-slate-600 bg-slate-900 px-2 py-1 text-sm text-slate-100 disabled:opacity-60"
        >
          {visibleOptions.map((option) => (
            <option key={option} value={option}>
              {parameter.enumLabels?.[option] ?? option}
            </option>
          ))}
        </select>
      </div>
    );
  };

  const commitDraft = () => {
    if (!block || !canCommit) {
      return;
    }

    const nextBindings = Object.entries(draftValues).reduce<Record<string, ExpressionBinding>>((acc, [name, draft]) => {
      if (draft.bindingKind === 'expression') {
        acc[name] = { kind: 'expression', expr: draft.value };
        return acc;
      }

      acc[name] = { kind: 'literal', value: coerceBlockPropertyLiteralValue(draft.value) };
      return acc;
    }, {});

    updateNodeParameterBindings(block.instanceId, nextBindings);
  };

  const handleApply = () => {
    commitDraft();
  };

  const handleOk = () => {
    commitDraft();
    onClose();
  };

  const handleBackdropClick = (event: MouseEvent<HTMLDivElement>) => {
    if (event.target === event.currentTarget) {
      onClose();
    }
  };

  if (!block) {
    return null;
  }

  const canonicalDisplayName = toCanonicalBlockDisplayName(block.displayName, block.blockTypeId);
  const blockInstanceId = block.instanceId;
  const descriptorBindingAuthoringMessage = getDescriptorBindingAuthoringMessage(block.blockTypeId);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/65 p-4"
      onMouseDown={handleBackdropClick}
    >
      <div className="w-full max-w-3xl rounded-lg border border-slate-700 bg-slate-900 shadow-xl">
        <header className="border-b border-slate-700 px-4 py-3">
          <h2 className="text-base font-semibold text-slate-100">Block Properties</h2>
          <p className="text-xs text-slate-400 mt-1">
            {canonicalDisplayName} · {block.instanceId}
          </p>
        </header>

        <div className="border-b border-slate-700 px-4 py-2 flex gap-2">
          {([
            ['general', 'General'],
            ['readonly', 'Read-Only'],
            ['advanced', 'Advanced'],
            ['documentation', 'Documentation'],
          ] as const).map(([tabValue, label]) => (
            <button
              key={tabValue}
              type="button"
              onClick={() => setActiveTab(tabValue)}
              className={`rounded px-2 py-1 text-xs ${
                activeTab === tabValue
                  ? 'bg-emerald-900/40 text-emerald-200 border border-emerald-700/60'
                  : 'bg-slate-800 text-slate-300 border border-slate-700'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="max-h-[60vh] overflow-y-auto p-4 space-y-3">
          {pendingControlParameter && (
            <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/70 p-4">
              <div className="w-full max-w-md rounded-lg border border-slate-700 bg-slate-900 shadow-2xl">
                <div className="border-b border-slate-700 px-4 py-3">
                  <p className="text-sm font-medium text-slate-100">Choose control panel</p>
                  <p className="text-[11px] text-slate-400">
                    {pendingControlParameter.label} · {pendingControlParameter.name}
                  </p>
                </div>
                <div className="space-y-3 px-4 py-3">
                  <p className="text-sm text-slate-400">Pick where to place this control.</p>
                  <div className="space-y-2">
                    {controlPanels.map((panel) => (
                      <button
                        key={panel.id}
                        type="button"
                        onClick={() => addControlForParameterToPanel(pendingControlParameter, panel.id)}
                        className="flex w-full items-center justify-between rounded border border-slate-600 bg-slate-950 px-3 py-2 text-left text-sm text-slate-100 hover:border-cyan-500 hover:bg-slate-900"
                      >
                        <span className="truncate">{panel.title?.trim() || 'Controls'}</span>
                        <span className="ml-3 shrink-0 text-[11px] text-slate-400">
                          {panel.widgets.length} widget{panel.widgets.length === 1 ? '' : 's'}
                        </span>
                      </button>
                    ))}
                  </div>
                  <div className="flex items-center justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => setPendingControlParameter(null)}
                      className="rounded border border-slate-600 bg-slate-800 px-3 py-1.5 text-sm text-slate-100 hover:bg-slate-700"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={() => addControlForParameterToPanel(pendingControlParameter)}
                      className="rounded border border-emerald-700/70 bg-emerald-900/35 px-3 py-1.5 text-sm text-emerald-100 hover:bg-emerald-800/45"
                    >
                      New control panel
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {blockDetailsQuery.isPending && (
            <p className="text-sm text-slate-400">Loading block details...</p>
          )}

          {blockDetailsQuery.isError && (
            <p className="text-sm text-rose-300">Failed to load block details: {blockDetailsQuery.error.message}</p>
          )}

          {activeTab === 'general' && blockDetailsQuery.data && (
            <div className="space-y-2">
              {descriptorBindingAuthoringMessage && (
                <div className="rounded border border-sky-800/70 bg-sky-950/25 p-3 text-xs text-sky-100">
                  {descriptorBindingAuthoringMessage}
                </div>
              )}
              {virtualRouteIssues.length > 0 && (
                <div className="rounded border border-slate-700 bg-slate-950/60 p-3 text-xs">
                  <p className="mb-2 font-semibold uppercase tracking-wide text-slate-300">Virtual Route</p>
                  <div className="space-y-1">
                    {virtualRouteIssues.map((issue) => (
                      <p
                        key={`${issue.severity}:${issue.message}`}
                        className={issue.severity === 'error' ? 'text-rose-300' : 'text-amber-200'}
                      >
                        {issue.message}
                      </p>
                    ))}
                  </div>
                </div>
              )}
              {fftSummary.length > 0 && (
                <div className="rounded border border-slate-700 bg-slate-950/40 p-3 text-xs text-slate-300 space-y-1">
                  {fftSummary.map((line) => <p key={line}>{line}</p>)}
                </div>
              )}
              {Object.keys(propertyErrors).length > 0 && (
                <div role="alert" className="space-y-1 text-xs text-rose-300">
                  {Object.entries(propertyErrors).map(([name, message]) => <p key={name}>{message}</p>)}
                </div>
              )}
              {editableParameters.length === 0 ? (
                <p className="text-sm text-slate-400">This block has no editable parameters in General.</p>
              ) : (
                editableParameters.map((parameter, index) => {
                  const binding = findControlWidgetBinding(parameter.name);
                  const enumTypeLabel = getBlockParameterEnumTypeLabel(parameter);

                  const group = studioPropertyGroup(block.blockTypeId, parameter.name);
                  const previousGroup = index > 0 ? studioPropertyGroup(block.blockTypeId, editableParameters[index - 1].name) : '';
                  return (
                    <Fragment key={parameter.name}>
                      {group && group !== previousGroup && <p className="pt-3 text-xs font-medium text-slate-400">{group}</p>}
                      <div
                        className="rounded border border-slate-700 bg-slate-800/60 px-1.5 py-2"
                      >
                        <div className={PARAMETER_ROW_GRID}>
                          <label
                            title={getBlockParameterHoverTitle(parameter)}
                            className="min-w-0 cursor-help truncate text-xs font-medium text-slate-200"
                          >
                            {getAuthoringParameterLabel(block.blockTypeId, parameter.name, parameter.label)}
                          </label>
                          <select
                            value={draftValues[parameter.name]?.bindingKind ?? 'literal'}
                            disabled={isVirtualRoutingBlock && parameter.name === 'stream_id'}
                            onChange={(event) =>
                              setDraftBindingKind(parameter.name, event.target.value as DraftValue['bindingKind'])
                            }
                            className="w-full min-w-0 rounded border border-slate-600 bg-slate-900 px-1.5 py-1 text-[11px] text-slate-200 disabled:opacity-60"
                          >
                            <option value="literal">Literal</option>
                            <option value="expression">Expression</option>
                          </select>
                          <div className="min-w-0">
                            {renderParameterValueInput(parameter, false)}
                          </div>
                          <span
                            title={enumTypeLabel ? `enum_type: ${enumTypeLabel}` : getBlockParameterTypeLabel(parameter)}
                            className="justify-self-end shrink-0 rounded border border-slate-600 bg-slate-800 px-1.5 py-1 text-[9px] uppercase tracking-wide text-slate-200"
                          >
                            {getBlockParameterTypeLabel(parameter)}
                          </span>
                          <button
                            type="button"
                            onClick={() => handleControlAction(parameter)}
                            disabled={!isControlWidgetParameterTarget(parameter)}
                            title={binding ? 'Remove control' : 'Add control'}
                            className={`justify-self-end inline-flex h-6 w-6 items-center justify-center rounded border text-sm leading-none ${
                              binding
                                ? 'border-rose-700/70 bg-rose-900/30 text-rose-100 hover:bg-rose-800/40'
                                : 'border-emerald-700/70 bg-emerald-900/35 text-emerald-100 hover:bg-emerald-800/45'
                            } disabled:cursor-not-allowed disabled:opacity-40`}
                          >
                            {binding ? '−' : '+'}
                          </button>
                        </div>
                        {propertyErrors[parameter.name] && <p className="mt-1 text-xs text-rose-300">{propertyErrors[parameter.name]}</p>}
                      </div>
                    </Fragment>
                  );
                })
              )}
            </div>
          )}

          {activeTab === 'readonly' && blockDetailsQuery.data && (
            <div className="space-y-2">
              {readOnlyParameters.length === 0 ? (
                <p className="text-sm text-slate-400">This block has no read-only parameters.</p>
              ) : (
                readOnlyParameters.map((parameter) => {
                  const enumTypeLabel = getBlockParameterEnumTypeLabel(parameter);

                  return (
                    <div
                      key={parameter.name}
                      className="rounded border border-slate-700 bg-slate-800/60 px-1.5 py-2"
                    >
                      <div className={PARAMETER_ROW_GRID}>
                        <label
                          title={getBlockParameterHoverTitle(parameter)}
                          className="min-w-0 cursor-help truncate text-xs font-medium text-slate-200"
                        >
                          {parameter.label}
                        </label>
                        <div className="min-w-0" aria-hidden="true" />
                        <div className="min-w-0">{renderParameterValueInput(parameter, true)}</div>
                        <span
                          title={enumTypeLabel ? `enum_type: ${enumTypeLabel}` : getBlockParameterTypeLabel(parameter)}
                          className="justify-self-end shrink-0 rounded border border-slate-600 bg-slate-800 px-1.5 py-1 text-[9px] uppercase tracking-wide text-slate-200"
                        >
                          {getBlockParameterTypeLabel(parameter)}
                        </span>
                        <div aria-hidden="true" />
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          )}

          {activeTab === 'advanced' && (
            <div className="space-y-2">
              {!blockDetailsQuery.data ? (
                <p className="text-sm text-slate-400">Advanced metadata will appear when block details are available.</p>
              ) : advancedParameters.length === 0 ? (
                <p className="text-sm text-slate-400">No advanced parameters found for this block.</p>
              ) : (
                advancedParameters.map((parameter) => {
                  const isEditable = !parameter.readOnly && parameter.mutable;
                  const enumTypeLabel = getBlockParameterEnumTypeLabel(parameter);

                  return (
                    <div
                      key={parameter.name}
                      className="rounded border border-slate-700 bg-slate-800/60 px-1.5 py-2"
                    >
                      <div className={PARAMETER_ROW_GRID}>
                        <label
                          title={getBlockParameterHoverTitle(parameter)}
                          className="min-w-0 cursor-help truncate text-xs font-medium text-slate-200"
                        >
                          {getAuthoringParameterLabel(block.blockTypeId, parameter.name, parameter.label)}
                        </label>
                        <select
                          value={draftValues[parameter.name]?.bindingKind ?? 'literal'}
                          onChange={(event) =>
                            setDraftBindingKind(parameter.name, event.target.value as DraftValue['bindingKind'])
                          }
                          className="w-full min-w-0 rounded border border-slate-600 bg-slate-900 px-1.5 py-1 text-[11px] text-slate-200"
                          >
                          <option value="literal">Literal</option>
                          <option value="expression">Expression</option>
                        </select>
                        <div className="min-w-0">
                          {renderParameterValueInput(parameter, !isEditable)}
                        </div>
                        <span
                          title={enumTypeLabel ? `enum_type: ${enumTypeLabel}` : getBlockParameterTypeLabel(parameter)}
                          className="justify-self-end shrink-0 rounded border border-slate-600 bg-slate-800 px-1.5 py-1 text-[9px] uppercase tracking-wide text-slate-200"
                        >
                          {getBlockParameterTypeLabel(parameter)}
                        </span>
                        <div aria-hidden="true" />
                      </div>
                    </div>
                  );
                })
              )}

              {blockDetailsQuery.data && (
                <div className="rounded border border-slate-700 bg-slate-800/50 p-3 text-xs text-slate-400">
                  {descriptorBindingAuthoringMessage && (
                    <p className="mb-2 text-sky-200">{descriptorBindingAuthoringMessage}</p>
                  )}
                  <p>Block Type ID: {blockDetailsQuery.data.blockTypeId}</p>
                  <p className="mt-1">
                    Ports: {blockDetailsQuery.data.inputPorts.length} input / {blockDetailsQuery.data.outputPorts.length} output
                  </p>
                </div>
              )}
            </div>
          )}

          {activeTab === 'documentation' && (
            <div className="rounded border border-slate-700 bg-slate-800/50 p-3 text-sm text-slate-300">
              {blockDetailsQuery.data?.description ? (
                <DoxygenText text={blockDetailsQuery.data.description} className="space-y-3" />
              ) : (
                <p className="text-slate-300">No documentation available for this block.</p>
              )}
            </div>
          )}
        </div>

        <footer className="border-t border-slate-700 px-4 py-3 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={handleOk}
            disabled={!canCommit}
            className="rounded border border-emerald-600 bg-emerald-700/30 px-3 py-1.5 text-sm text-emerald-200 hover:bg-emerald-700/45 disabled:opacity-50"
          >
            OK
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded border border-slate-600 bg-slate-800 px-3 py-1.5 text-sm text-slate-200 hover:bg-slate-700"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleApply}
            disabled={!canCommit}
            className="rounded border border-slate-500 bg-slate-700 px-3 py-1.5 text-sm text-slate-100 hover:bg-slate-600 disabled:opacity-50"
          >
            Apply
          </button>
        </footer>
      </div>
    </div>
  );
}
