import { createPortal } from 'react-dom';
import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import type { RuntimeSettingsValue } from '../../lib/api/block-settings';
import { useRuntimeBlockSettings } from '../inspector/hooks/use-runtime-block-settings';
import { toRuntimeSettingsErrorMessage } from '../inspector/runtime-settings-model';
import { getCompatibleControlWidgetInputKinds, getControlWidgetTargetLabel } from './control-panel-authoring';
import type { ResolvedControlWidget } from './control-panel-binding-resolution';
import type { ExpressionBinding } from '../variables/model/types';
import type { StudioControlWidgetSliderConfig } from '../graph-document/model/studio-workspace';
import {
  applyLocalVariableControlValues,
  expressionBindingToLocalValue,
  type LocalVariableControlValues,
} from './local-variable-state';

function stateLabel(state: ResolvedControlWidget['state']): string {
  if (state === 'missing_node') {
    return 'missing node';
  }
  if (state === 'missing_parameter') {
    return 'missing parameter';
  }
  if (state === 'missing_variable') {
    return 'missing variable';
  }
  if (state === 'incompatible_widget') {
    return 'incompatible';
  }
  return state;
}

function isTruthyBoolean(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return normalized === 'true' || normalized === '1' || normalized === 'yes' || normalized === 'on';
}

function runtimeValueToString(value: RuntimeSettingsValue | undefined): string {
  if (value === null || value === undefined) {
    return '';
  }

  if (typeof value === 'string') {
    return value;
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }

  return JSON.stringify(value);
}

function runtimeValueToBoolean(value: RuntimeSettingsValue | undefined): boolean {
  if (typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'number') {
    return value !== 0;
  }

  if (typeof value === 'string') {
    return isTruthyBoolean(value);
  }

  return false;
}

function enumOptionsForWidget(widget: ResolvedControlWidget, currentValue: string): string[] {
  const options = [...(widget.enumOptions ?? [])];
  if (currentValue && !options.includes(currentValue)) {
    options.unshift(currentValue);
  }
  if (options.length === 0) {
    options.push('');
  }
  return options;
}

function widgetValueLabel(widget: ResolvedControlWidget, value: string): string {
  if (widget.inputKind === 'boolean') {
    return value ? 'On' : 'Off';
  }

  if (widget.inputKind === 'enum') {
    return widget.enumLabels?.[value] ?? value;
  }

  return value;
}

function isNumericWidget(widget: ResolvedControlWidget): boolean {
  return widget.inputKind === 'number' || widget.inputKind === 'slider';
}

function resolveSliderConfig(config: StudioControlWidgetSliderConfig | undefined): Required<StudioControlWidgetSliderConfig> {
  const min = Number.isFinite(config?.min) ? (config?.min as number) : -100;
  const max = Number.isFinite(config?.max) ? (config?.max as number) : 100;
  return {
    min: max > min ? min : -100,
    max: max > min ? max : 100,
    step: Number.isFinite(config?.step) && (config?.step as number) > 0 ? (config?.step as number) : 1,
  };
}

type ControlPanelTargetOption = {
  id: string;
  title?: string;
  widgetCount: number;
};

type ControlWidgetFieldProps = {
  widget: ResolvedControlWidget;
  panelId: string;
  isEditable: boolean;
  isPanelSelected: boolean;
  controlPanelOptions: readonly ControlPanelTargetOption[];
  onUpdateVariableValue?: (variableName: string, binding: ExpressionBinding) => void;
  onUpdateWidgetLabel?: (panelId: string, widgetId: string, label: string) => void;
  onUpdateWidgetInputKind?: (
    panelId: string,
    widgetId: string,
    inputKind: 'text' | 'number' | 'slider' | 'boolean' | 'enum',
  ) => void;
  onUpdateWidgetSliderConfig?: (
    panelId: string,
    widgetId: string,
    slider: StudioControlWidgetSliderConfig,
  ) => void;
  onMoveWidget?: (panelId: string, widgetId: string, direction: 'up' | 'down') => void;
  onRemoveWidget?: (panelId: string, widgetId: string) => void;
  onMoveWidgetToPanel?: (panelId: string, widgetId: string, targetPanelId: string) => void;
};

function ControlWidgetField({
  widget,
  panelId,
  isEditable,
  isPanelSelected,
  controlPanelOptions,
  onUpdateVariableValue,
  onUpdateWidgetLabel,
  onUpdateWidgetInputKind,
  onUpdateWidgetSliderConfig,
  onMoveWidget,
  onRemoveWidget,
  onMoveWidgetToPanel,
}: ControlWidgetFieldProps) {
  const canWrite =
    widget.binding.kind === 'parameter'
      ? widget.state === 'ready' && Boolean(widget.runtimeSessionId)
      : widget.state === 'ready';
  const { query, mutation } = useRuntimeBlockSettings(
    widget.binding.kind === 'parameter' ? widget.runtimeSessionId ?? undefined : undefined,
    widget.binding.kind === 'parameter' ? widget.binding.nodeId : undefined,
    canWrite && widget.binding.kind === 'parameter',
  );
  const runtimeValue =
    widget.binding.kind === 'parameter' ? query.data?.[widget.binding.parameterName] : undefined;
  const committedValue = runtimeValue !== undefined ? runtimeValue : widget.currentValue;
  const committedText = runtimeValueToString(committedValue);
  const [draftText, setDraftText] = useState<string>(committedText);
  const [checked, setChecked] = useState<boolean>(() => runtimeValueToBoolean(committedValue));
  const [validationError, setValidationError] = useState<string | null>(null);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [labelDraft, setLabelDraft] = useState(widget.label);
  const [destinationPanelId, setDestinationPanelId] = useState('');
  const [menuStyle, setMenuStyle] = useState<CSSProperties>({});
  const queuedWriteRef = useRef<{ value: RuntimeSettingsValue } | null>(null);
  const flushingWriteRef = useRef(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    setValidationError(null);
    if (widget.inputKind === 'boolean') {
      setChecked(runtimeValueToBoolean(committedValue));
      return;
    }
    setDraftText(committedText);
  }, [committedText, committedValue, widget.inputKind]);

  useEffect(() => {
    setLabelDraft(widget.label ?? '');
  }, [widget.id, widget.label]);

  const destinationPanelOptions = controlPanelOptions.filter((option) => option.id !== panelId);

  useEffect(() => {
    if (!isMenuOpen) {
      return;
    }

    setDestinationPanelId((current) => {
      if (current && destinationPanelOptions.some((option) => option.id === current)) {
        return current;
      }
      return destinationPanelOptions[0]?.id ?? '';
    });
  }, [destinationPanelOptions, isMenuOpen]);

  useEffect(() => {
    if (!isMenuOpen) {
      return;
    }

    const updateMenuPosition = () => {
      const triggerRect = triggerRef.current?.getBoundingClientRect();
      if (!triggerRect) {
        return;
      }

      const desiredWidth = 320;
      const viewportPadding = 12;
      const gap = 10;
      const left = Math.max(12, Math.min(triggerRect.right - desiredWidth, window.innerWidth - desiredWidth - 12));
      const menuHeight = menuRef.current?.offsetHeight ?? 360;
      const maxHeight = Math.max(220, window.innerHeight - viewportPadding * 2);
      const renderedHeight = Math.min(menuHeight, maxHeight);
      const spaceBelow = window.innerHeight - triggerRect.bottom - viewportPadding;
      const spaceAbove = triggerRect.top - viewportPadding;
      const opensBelow = spaceBelow >= renderedHeight || spaceBelow >= spaceAbove;
      const top = opensBelow
        ? Math.min(triggerRect.bottom + gap, window.innerHeight - renderedHeight - viewportPadding)
        : Math.max(viewportPadding, triggerRect.top - renderedHeight - gap);
      setMenuStyle({
        left,
        top,
        maxHeight,
      });
    };

    updateMenuPosition();

    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node) || !menuRef.current || menuRef.current.contains(target)) {
        return;
      }
      setIsMenuOpen(false);
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsMenuOpen(false);
      }
    };

    const onWindowChange = () => {
      updateMenuPosition();
    };

    window.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('resize', onWindowChange);
    window.addEventListener('scroll', onWindowChange, true);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('resize', onWindowChange);
      window.removeEventListener('scroll', onWindowChange, true);
    };
  }, [isMenuOpen]);

  const savePatch = async (nextValue: RuntimeSettingsValue) => {
    if (!canWrite) {
      return;
    }

    if (widget.binding.kind === 'variable') {
      onUpdateVariableValue?.(widget.binding.variableName, {
        kind: 'literal',
        value:
          typeof nextValue === 'number' || typeof nextValue === 'boolean' || typeof nextValue === 'string' || nextValue === null
            ? nextValue
            : String(nextValue),
      });
      return;
    }

    queuedWriteRef.current = { value: nextValue };
    if (flushingWriteRef.current) {
      return;
    }

    flushingWriteRef.current = true;
    try {
      const parameterName = widget.binding.kind === 'parameter' ? widget.binding.parameterName : null;
      if (!parameterName) {
        return;
      }
      while (queuedWriteRef.current !== null) {
        const pendingValue = queuedWriteRef.current.value;
        queuedWriteRef.current = null;
        setValidationError(null);
        await mutation.mutateAsync({
          patch: {
            [widget.binding.parameterName]: pendingValue,
          },
          mode: 'staged',
        });
      }
    } catch (error) {
      setValidationError(toRuntimeSettingsErrorMessage(error));
    } finally {
      flushingWriteRef.current = false;
    }
  };

  const isPending = mutation.isPending;
  const errorMessage = validationError ?? (mutation.isError ? toRuntimeSettingsErrorMessage(mutation.error) : null);
  const isDisabled = !canWrite;
  const rowTooltip =
    errorMessage ??
    (isPending
      ? 'Saving live setting...'
      : isDisabled
        ? widget.reason ?? stateLabel(widget.state)
        : undefined);
  const rowClass = [
    'group relative grid items-center gap-2 rounded-md border px-3 py-2 transition-colors',
    isEditable
      ? 'grid-cols-[minmax(0,1.1fr)_minmax(0,1.4fr)_minmax(0,auto)_auto]'
      : 'grid-cols-[minmax(0,1.1fr)_minmax(0,1.4fr)_auto]',
    isDisabled
      ? 'border-slate-700/80 bg-slate-950/25 opacity-65'
      : 'border-slate-700/70 bg-slate-950/35 hover:border-slate-600/90',
  ].join(' ');
  const displayText = draftText.length > 0 ? draftText : committedText;
  const labelText =
    widget.label ?? (widget.binding.kind === 'parameter' ? widget.binding.parameterName : widget.binding.variableName);
  const inputKindOptions = widget.parameterMeta
    ? getCompatibleControlWidgetInputKinds(widget.parameterMeta)
    : ['text', 'number', 'slider', 'boolean', 'enum'];
  const resolvedInputKindOptions = inputKindOptions.includes(widget.inputKind)
    ? inputKindOptions
    : [widget.inputKind, ...inputKindOptions];
  const selectedControlPanelTitle =
    destinationPanelOptions.find((option) => option.id === destinationPanelId)?.title?.trim() || 'Select panel';
  const widgetActionMenu =
    isEditable && isMenuOpen
      ? createPortal(
          <div className="fixed inset-0 z-[120] bg-slate-950/35" onClick={() => setIsMenuOpen(false)}>
            <div
              ref={menuRef}
              role="dialog"
              aria-label="Widget actions"
              aria-modal="true"
              onClick={(event) => event.stopPropagation()}
              className="fixed flex w-80 flex-col overflow-hidden rounded-lg border border-slate-700 bg-slate-950 shadow-2xl ring-1 ring-black/30"
              style={menuStyle}
            >
              <div className="shrink-0 border-b border-slate-700 px-3 py-2">
                <p className="text-xs font-semibold text-slate-100">Widget actions</p>
                <p className="mt-0.5 text-[11px] text-slate-400">
                  {getControlWidgetTargetLabel(widget)} ·{' '}
                  {widget.binding.kind === 'parameter' ? widget.binding.parameterName : widget.binding.variableName}
                </p>
              </div>
              <div className="min-h-0 space-y-3 overflow-y-auto p-3">
                <div className="space-y-1">
                  <label className="block text-[11px] uppercase tracking-wide text-slate-400">Label</label>
                  <input
                    type="text"
                    value={labelDraft}
                    onChange={(event) => setLabelDraft(event.target.value)}
                    onBlur={(event) => onUpdateWidgetLabel?.(panelId, widget.id, event.currentTarget.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        event.currentTarget.blur();
                      }
                    }}
                    className="w-full rounded border border-slate-600 bg-slate-900 px-2 py-1 text-sm text-slate-100 outline-none focus:border-cyan-500"
                  />
                </div>
                {widget.inputKind === 'slider' && (
                  <div className="grid grid-cols-3 gap-2">
                    {(['min', 'max', 'step'] as const).map((key) => (
                      <label key={key} className="space-y-1">
                        <span className="block text-[11px] uppercase tracking-wide text-slate-400">{key}</span>
                        <input
                          type="number"
                          value={widget.slider?.[key] ?? ''}
                          placeholder={key === 'min' ? '-100' : key === 'max' ? '100' : '1'}
                          onChange={(event) => {
                            const text = event.target.value.trim();
                            const next = text === '' ? undefined : Number(text);
                            if (text !== '' && !Number.isFinite(next)) {
                              return;
                            }
                            onUpdateWidgetSliderConfig?.(panelId, widget.id, {
                              ...(widget.slider ?? {}),
                              [key]: next,
                            });
                          }}
                          className="w-full rounded border border-slate-600 bg-slate-900 px-2 py-1 text-sm text-slate-100 outline-none focus:border-cyan-500"
                        />
                      </label>
                    ))}
                  </div>
                )}
                <div className="space-y-1">
                  <label className="block text-[11px] uppercase tracking-wide text-slate-400">Type</label>
                  <select
                    value={widget.inputKind}
                    onChange={(event) =>
                      onUpdateWidgetInputKind?.(
                        panelId,
                        widget.id,
                        event.target.value as 'text' | 'number' | 'slider' | 'boolean' | 'enum',
                      )
                    }
                    className="w-full rounded border border-slate-600 bg-slate-900 px-2 py-1 text-sm text-slate-100 outline-none focus:border-cyan-500"
                  >
                    {resolvedInputKindOptions.map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="block text-[11px] uppercase tracking-wide text-slate-400">Move to panel</label>
                  <div className="flex gap-2">
                    <select
                      value={destinationPanelId}
                      onChange={(event) => setDestinationPanelId(event.target.value)}
                      disabled={destinationPanelOptions.length === 0}
                      className="min-w-0 flex-1 rounded border border-slate-600 bg-slate-900 px-2 py-1 text-sm text-slate-100 outline-none focus:border-cyan-500 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {destinationPanelOptions.length === 0 ? (
                        <option value="">No other control panels</option>
                      ) : (
                        destinationPanelOptions.map((option) => (
                          <option key={option.id} value={option.id}>
                            {option.title?.trim() || 'Controls'} ({option.widgetCount})
                          </option>
                        ))
                      )}
                    </select>
                    <button
                      type="button"
                      disabled={!destinationPanelId || destinationPanelOptions.length === 0}
                      onClick={() => {
                        if (!onMoveWidgetToPanel || !destinationPanelId) {
                          return;
                        }
                        onMoveWidgetToPanel(panelId, widget.id, destinationPanelId);
                        setIsMenuOpen(false);
                      }}
                      className="rounded border border-slate-600 bg-slate-800 px-2 py-1 text-sm text-slate-100 hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      Move
                    </button>
                  </div>
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    disabled={!onMoveWidget}
                    onClick={() => onMoveWidget?.(panelId, widget.id, 'up')}
                    className="flex-1 rounded border border-slate-600 bg-slate-800 px-2 py-1 text-sm text-slate-100 hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Move up
                  </button>
                  <button
                    type="button"
                    disabled={!onMoveWidget}
                    onClick={() => onMoveWidget?.(panelId, widget.id, 'down')}
                    className="flex-1 rounded border border-slate-600 bg-slate-800 px-2 py-1 text-sm text-slate-100 hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Move down
                  </button>
                </div>
                <button
                  type="button"
                  disabled={!onRemoveWidget}
                  onClick={() => {
                    onRemoveWidget?.(panelId, widget.id);
                    setIsMenuOpen(false);
                  }}
                  className="w-full rounded border border-rose-700/70 bg-rose-900/35 px-2 py-1 text-sm text-rose-100 hover:bg-rose-800/45 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Remove widget
                </button>
                {destinationPanelOptions.length > 0 && (
                  <p className="text-[11px] text-slate-500">
                    Current target: {selectedControlPanelTitle}
                  </p>
                )}
              </div>
            </div>
          </div>,
          document.body,
        )
      : null;

  if (widget.inputKind === 'boolean') {
    return (
      <label className={rowClass} title={rowTooltip}>
        <span className="min-w-0 truncate text-sm font-medium text-slate-100">{labelText}</span>
        <span className="flex items-center justify-center">
          <input
            type="checkbox"
            checked={checked}
            disabled={isDisabled}
            onChange={(event) => {
              if (isDisabled) {
                return;
              }
              const next = event.target.checked;
              setChecked(next);
              void savePatch(next);
            }}
            className="h-4 w-4 rounded border-slate-600 bg-slate-900 text-emerald-500 disabled:cursor-not-allowed disabled:opacity-60"
          />
        </span>
        <span className="justify-self-end text-xs tabular-nums text-slate-400">
          {checked ? 'On' : 'Off'}
        </span>
        {isEditable && (
          <div className="relative justify-self-end">
            <button
              ref={triggerRef}
              type="button"
              onClick={(event) => {
                event.preventDefault();
                setIsMenuOpen((current) => !current);
              }}
              title="Widget actions"
              className={`inline-flex h-7 w-7 items-center justify-center rounded border border-slate-600 bg-slate-800 text-sm text-slate-100 hover:bg-slate-700 ${
                isMenuOpen || isPanelSelected
                  ? 'opacity-100'
                  : 'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100'
              }`}
            >
              ⚙
            </button>
            {widgetActionMenu}
          </div>
        )}
      </label>
    );
  }

  if (isNumericWidget(widget)) {
    const numericCommittedValue = Number(committedText);
    const numericDraftValue = Number(draftText);
    const sliderConfig = resolveSliderConfig(widget.slider);
    const sliderValue =
      Number.isFinite(numericDraftValue) && draftText !== '' ? numericDraftValue : numericCommittedValue;
    return (
      <label className={rowClass} title={rowTooltip}>
        <span className="min-w-0 truncate text-sm font-medium text-slate-100">{labelText}</span>
        {widget.inputKind === 'slider' ? (
          <input
            type="range"
            min={sliderConfig.min}
            max={sliderConfig.max}
            step={sliderConfig.step}
            value={Number.isFinite(sliderValue) ? sliderValue : sliderConfig.min}
            disabled={isDisabled}
            onChange={(event) => {
              if (isDisabled) {
                return;
              }
              const nextText = event.target.value;
              setDraftText(nextText);
              void savePatch(Number(nextText));
            }}
            className="h-4 w-full cursor-pointer accent-emerald-500 disabled:cursor-not-allowed disabled:opacity-60"
          />
        ) : (
          <input
            type="number"
            value={draftText}
            disabled={isDisabled}
            onChange={(event) => {
              if (isDisabled) {
                return;
              }
              setDraftText(event.target.value);
            }}
            onBlur={() => {
              if (isDisabled) {
                return;
              }
              const trimmed = draftText.trim();
              if (trimmed === '') {
                void savePatch(null);
                return;
              }

              const nextValue = Number(trimmed);
              if (!Number.isFinite(nextValue)) {
                setValidationError('Enter a valid number.');
                return;
              }

              if (String(nextValue) === committedText) {
                return;
              }

              void savePatch(nextValue);
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.currentTarget.blur();
              }
            }}
            className="w-full rounded border border-slate-600 bg-slate-900 px-2 py-1 text-sm text-slate-100 outline-none focus:border-cyan-500 disabled:cursor-not-allowed disabled:opacity-60"
          />
        )}
        <span className="justify-self-end text-xs tabular-nums text-slate-400" title={errorMessage ?? undefined}>
          {widgetValueLabel(widget, displayText) || '—'}
        </span>
        {isEditable && (
          <div className="relative justify-self-end">
            <button
              ref={triggerRef}
              type="button"
              onClick={(event) => {
                event.preventDefault();
                setIsMenuOpen((current) => !current);
              }}
              title="Widget actions"
              className={`inline-flex h-7 w-7 items-center justify-center rounded border border-slate-600 bg-slate-800 text-sm text-slate-100 hover:bg-slate-700 ${
                isMenuOpen || isPanelSelected
                  ? 'opacity-100'
                  : 'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100'
              }`}
            >
              ⚙
            </button>
            {widgetActionMenu}
          </div>
        )}
      </label>
    );
  }

  if (widget.inputKind === 'enum') {
    const options = enumOptionsForWidget(widget, committedText);
    return (
      <label className={rowClass} title={rowTooltip}>
        <span className="min-w-0 truncate text-sm font-medium text-slate-100">{labelText}</span>
        <select
          value={draftText}
          disabled={isDisabled}
          onChange={(event) => {
            if (isDisabled) {
              return;
            }
            const next = event.target.value;
            setDraftText(next);
            void savePatch(next);
          }}
          className="w-full rounded border border-slate-600 bg-slate-900 px-2 py-1 text-sm text-slate-100 outline-none focus:border-cyan-500 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {options.map((option) => (
            <option key={option || '__empty__'} value={option}>
              {(widget.enumLabels?.[option] ?? option) || 'Select an option'}
            </option>
          ))}
        </select>
        <span className="justify-self-end text-xs tabular-nums text-slate-400" title={errorMessage ?? undefined}>
          {widgetValueLabel(widget, displayText) || '—'}
        </span>
        {isEditable && (
          <div className="relative justify-self-end">
            <button
              ref={triggerRef}
              type="button"
              onClick={(event) => {
                event.preventDefault();
                setIsMenuOpen((current) => !current);
              }}
              title="Widget actions"
              className={`inline-flex h-7 w-7 items-center justify-center rounded border border-slate-600 bg-slate-800 text-sm text-slate-100 hover:bg-slate-700 ${
                isMenuOpen || isPanelSelected
                  ? 'opacity-100'
                  : 'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100'
              }`}
            >
              ⚙
            </button>
            {widgetActionMenu}
          </div>
        )}
      </label>
    );
  }

  return (
    <label className={rowClass} title={rowTooltip}>
      <span className="min-w-0 truncate text-sm font-medium text-slate-100">{labelText}</span>
      <input
        type="text"
        value={draftText}
        disabled={isDisabled}
        onChange={(event) => {
          if (isDisabled) {
            return;
          }
          setDraftText(event.target.value);
        }}
        onBlur={() => {
          if (isDisabled) {
            return;
          }
          if (draftText === committedText) {
            return;
          }
          void savePatch(draftText);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.currentTarget.blur();
          }
        }}
        className="w-full rounded border border-slate-600 bg-slate-900 px-2 py-1 text-sm text-slate-100 outline-none focus:border-cyan-500 disabled:cursor-not-allowed disabled:opacity-60"
      />
      <span className="justify-self-end text-xs tabular-nums text-slate-400" title={errorMessage ?? undefined}>
        {widgetValueLabel(widget, displayText) || '—'}
      </span>
      {isEditable && (
        <div className="relative justify-self-end">
          <button
            type="button"
            onClick={(event) => {
              event.preventDefault();
              setIsMenuOpen((current) => !current);
            }}
            title="Widget actions"
            className={`inline-flex h-7 w-7 items-center justify-center rounded border border-slate-600 bg-slate-800 text-sm text-slate-100 hover:bg-slate-700 ${
              isMenuOpen || isPanelSelected
                ? 'opacity-100'
                : 'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100'
            }`}
          >
            ⚙
          </button>
          {widgetActionMenu}
        </div>
      )}
    </label>
  );
}

export function ControlPanelView({
  panelId,
  widgets,
  isEditable = false,
  isPanelSelected = false,
  controlPanelOptions = [],
  onUpdateVariableValue,
  onUpdateWidgetLabel,
  onUpdateWidgetInputKind,
  onUpdateWidgetSliderConfig,
  onMoveWidget,
  onRemoveWidget,
  onMoveWidgetToPanel,
}: {
  panelId?: string;
  widgets: readonly ResolvedControlWidget[];
  isEditable?: boolean;
  isPanelSelected?: boolean;
  controlPanelOptions?: readonly ControlPanelTargetOption[];
  onUpdateVariableValue?: (variableName: string, binding: ExpressionBinding) => void;
  onUpdateWidgetLabel?: (panelId: string, widgetId: string, label: string) => void;
  onUpdateWidgetInputKind?: (
    panelId: string,
    widgetId: string,
    inputKind: 'text' | 'number' | 'slider' | 'boolean' | 'enum',
  ) => void;
  onUpdateWidgetSliderConfig?: (
    panelId: string,
    widgetId: string,
    slider: StudioControlWidgetSliderConfig,
  ) => void;
  onMoveWidget?: (panelId: string, widgetId: string, direction: 'up' | 'down') => void;
  onRemoveWidget?: (panelId: string, widgetId: string) => void;
  onMoveWidgetToPanel?: (panelId: string, widgetId: string, targetPanelId: string) => void;
}) {
  const [localVariableValues, setLocalVariableValues] = useState<LocalVariableControlValues>({});
  const effectiveWidgets = useMemo(
    () => applyLocalVariableControlValues(widgets, localVariableValues),
    [localVariableValues, widgets],
  );
  const updateVariableValue = (variableName: string, binding: ExpressionBinding) => {
    if (onUpdateVariableValue) {
      onUpdateVariableValue(variableName, binding);
      return;
    }
    setLocalVariableValues((current) => ({
      ...current,
      [variableName]: expressionBindingToLocalValue(binding),
    }));
  };

  return (
    <div className="h-full min-h-0 overflow-y-auto pr-1">
      <div className="space-y-1.5">
        {effectiveWidgets.length === 0 ? (
          <div className="rounded border border-dashed border-slate-700 bg-slate-950/40 px-3 py-2 text-xs text-slate-400">
            No widgets defined.
          </div>
        ) : (
          effectiveWidgets.map((widget) => (
            <ControlWidgetField
              key={widget.id}
              widget={widget}
              panelId={panelId ?? ''}
              isEditable={isEditable && Boolean(panelId)}
              isPanelSelected={isPanelSelected}
              controlPanelOptions={controlPanelOptions}
              onUpdateVariableValue={updateVariableValue}
              onUpdateWidgetLabel={onUpdateWidgetLabel}
              onUpdateWidgetInputKind={onUpdateWidgetInputKind}
              onUpdateWidgetSliderConfig={onUpdateWidgetSliderConfig}
              onMoveWidget={onMoveWidget}
              onRemoveWidget={onRemoveWidget}
              onMoveWidgetToPanel={onMoveWidgetToPanel}
            />
          ))
        )}
      </div>
    </div>
  );
}
