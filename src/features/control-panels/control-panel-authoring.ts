import { isCollectionParameter, type BlockParameterMeta } from '../../lib/api/block-details';
import type { JsonPrimitive } from '../variables/model/types';
import type {
  StudioControlPanelSpec,
  StudioControlWidgetInputKind,
  StudioControlWidgetSliderConfig,
  StudioControlWidgetSpec,
  StudioControlWidgetBinding,
  StudioPanelSpec,
} from '../graph-document/model/studio-workspace';

function isNumericTypeName(valueType?: string): boolean {
  const normalized = (valueType ?? '').trim().toLowerCase();
  return (
    normalized.includes('int') ||
    normalized.includes('float') ||
    normalized.includes('double') ||
    normalized.includes('number') ||
    normalized.includes('real') ||
    normalized.includes('complex') ||
    normalized.includes('sample')
  );
}

function isBooleanTypeName(valueType?: string): boolean {
  return (valueType ?? '').trim().toLowerCase().includes('bool');
}

function isSliderUiHint(uiHint?: string): boolean {
  const normalized = (uiHint ?? '').trim().toLowerCase();
  return normalized.includes('slider') || normalized.includes('range');
}

export function isControlWidgetParameterTarget(parameter: BlockParameterMeta): boolean {
  return parameter.mutable && !parameter.readOnly;
}

export function getControlWidgetTargetLabel(widget: { binding: StudioControlWidgetBinding }): string {
  return widget.binding.kind === 'parameter' ? 'Block parameter' : 'Variable';
}

function inferVariableInputKind(value: JsonPrimitive | undefined): StudioControlWidgetInputKind {
  if (typeof value === 'boolean') {
    return 'boolean';
  }
  if (typeof value === 'number') {
    return 'number';
  }
  return 'text';
}

export function inferControlWidgetInputKind(parameter: BlockParameterMeta): StudioControlWidgetInputKind {
  if (isCollectionParameter(parameter)) {
    return 'text';
  }

  if (parameter.valueKind === 'enum' || Boolean(parameter.enumChoices?.length)) {
    return 'enum';
  }

  if (isBooleanTypeName(parameter.valueType)) {
    return 'boolean';
  }

  if (isSliderUiHint(parameter.uiHint) && isNumericTypeName(parameter.valueType)) {
    return 'slider';
  }

  if (isNumericTypeName(parameter.valueType)) {
    return 'number';
  }

  return 'text';
}

export function getCompatibleControlWidgetInputKinds(
  parameter: BlockParameterMeta,
): StudioControlWidgetInputKind[] {
  const kinds: StudioControlWidgetInputKind[] = ['text'];
  if (isCollectionParameter(parameter)) {
    return kinds;
  }

  if (parameter.valueKind === 'enum' || Boolean(parameter.enumChoices?.length)) {
    kinds.push('enum');
  }

  if (isBooleanTypeName(parameter.valueType)) {
    kinds.push('boolean');
  }

  if (isNumericTypeName(parameter.valueType)) {
    kinds.push('number');
    kinds.push('slider');
  }

  return kinds;
}

function makeUniqueId(existingIds: Set<string>, baseId: string): string {
  if (!existingIds.has(baseId)) {
    return baseId;
  }

  for (let index = 2; index < 10_000; index += 1) {
    const nextId = `${baseId}-${index}`;
    if (!existingIds.has(nextId)) {
      return nextId;
    }
  }

  return `${baseId}-${Math.random().toString(36).slice(2, 8)}`;
}

export function buildControlWidgetSpec(
  input:
    | {
        nodeId: string;
        parameter: BlockParameterMeta;
      }
    | {
        variableName: string;
        label?: string;
        inputKind?: StudioControlWidgetInputKind;
        initialValue?: JsonPrimitive;
      },
): StudioControlWidgetSpec {
  if ('nodeId' in input) {
    return {
      id: `control-widget:${input.nodeId}:${input.parameter.name}`,
      kind: 'parameter',
      binding: {
        kind: 'parameter',
        nodeId: input.nodeId,
        parameterName: input.parameter.name,
      },
      label: input.parameter.name,
      inputKind: inferControlWidgetInputKind(input.parameter),
    };
  }

  return {
    id: `control-widget:variable:${input.variableName}`,
    kind: 'parameter',
    binding: {
      kind: 'variable',
      variableName: input.variableName,
    },
    label: input.label?.trim() || input.variableName,
    inputKind: input.inputKind ?? inferVariableInputKind(input.initialValue),
  };
}

function createControlPanelSpec(input: {
  panelId: string;
  title?: string;
  widget: StudioControlWidgetSpec;
}): StudioControlPanelSpec {
  return {
    id: input.panelId,
    kind: 'control',
    title: input.title?.trim() || 'Controls',
    visible: true,
    previewOnCanvas: false,
    widgets: [input.widget],
  };
}

export function createEmptyControlPanelSpec(input: { panelId: string; title?: string }): StudioControlPanelSpec {
  return {
    id: input.panelId,
    kind: 'control',
    title: input.title?.trim() || 'Controls',
    visible: true,
    previewOnCanvas: false,
    widgets: [],
  };
}

export function addEmptyControlPanelToPanels(
  panels: readonly StudioPanelSpec[] | undefined,
  title?: string,
): { panels: StudioPanelSpec[]; panelId: string } {
  const currentPanels = [...(panels ?? [])];
  const existingIds = new Set(currentPanels.map((panel) => panel.id));
  const panelId = makeUniqueId(existingIds, 'control-panel');
  return {
    panelId,
    panels: [...currentPanels, createEmptyControlPanelSpec({ panelId, title })],
  };
}

export function addControlWidgetToPanels(
  panels: readonly StudioPanelSpec[] | undefined,
  input: {
    widget: StudioControlWidgetSpec;
    targetPanelId?: string;
  },
): StudioPanelSpec[] {
  const currentPanels = [...(panels ?? [])];
  const existingBindings = new Set(
    currentPanels.flatMap((panel) =>
      panel.kind === 'control'
        ? panel.widgets.map((widget) =>
            widget.binding.kind === 'parameter'
              ? `parameter:${widget.binding.nodeId}:${widget.binding.parameterName}`
              : `variable:${widget.binding.variableName}`,
          )
        : [],
    ),
  );
  const widgetBindingKey =
    input.widget.binding.kind === 'parameter'
      ? `parameter:${input.widget.binding.nodeId}:${input.widget.binding.parameterName}`
      : `variable:${input.widget.binding.variableName}`;
  if (existingBindings.has(widgetBindingKey)) {
    return currentPanels;
  }

  const controlPanels = currentPanels.filter((panel): panel is StudioControlPanelSpec => panel.kind === 'control');
  const resolvedTargetPanelId = input.targetPanelId ?? controlPanels[controlPanels.length - 1]?.id;

  if (resolvedTargetPanelId) {
    const existingPanelIndex = currentPanels.findIndex(
      (panel) => panel.kind === 'control' && panel.id === resolvedTargetPanelId,
    );
    if (existingPanelIndex >= 0) {
      const existingPanel = currentPanels[existingPanelIndex];
      if (existingPanel.kind === 'control') {
        const nextWidgets = [...existingPanel.widgets, input.widget];
        const nextPanels = [...currentPanels];
        nextPanels[existingPanelIndex] = {
          ...existingPanel,
          widgets: nextWidgets,
        };
        return nextPanels;
      }
    }
  }

  const existingIds = new Set(currentPanels.map((panel) => panel.id));
  const panelId = makeUniqueId(existingIds, 'control-panel');
  return [...currentPanels, createControlPanelSpec({ panelId, widget: input.widget })];
}

export function moveControlWidgetToPanel(
  panels: readonly StudioPanelSpec[] | undefined,
  input: {
    sourcePanelId: string;
    targetPanelId: string;
    widgetId: string;
  },
): StudioPanelSpec[] {
  if (input.sourcePanelId === input.targetPanelId) {
    return [...(panels ?? [])];
  }

  const currentPanels = [...(panels ?? [])];
  const sourceIndex = currentPanels.findIndex(
    (panel) => panel.kind === 'control' && panel.id === input.sourcePanelId,
  );
  const targetIndex = currentPanels.findIndex(
    (panel) => panel.kind === 'control' && panel.id === input.targetPanelId,
  );
  if (sourceIndex < 0 || targetIndex < 0) {
    return currentPanels;
  }

  const sourcePanel = currentPanels[sourceIndex];
  const targetPanel = currentPanels[targetIndex];
  if (sourcePanel.kind !== 'control' || targetPanel.kind !== 'control') {
    return currentPanels;
  }

  const widget = sourcePanel.widgets.find((entry) => entry.id === input.widgetId);
  if (!widget) {
    return currentPanels;
  }

  const nextSourceWidgets = sourcePanel.widgets.filter((entry) => entry.id !== input.widgetId);
  const nextTargetWidgets = [...targetPanel.widgets, widget];
  const nextPanels = [...currentPanels];
  nextPanels[sourceIndex] = {
    ...sourcePanel,
    widgets: nextSourceWidgets,
  };
  nextPanels[targetIndex] = {
    ...targetPanel,
    widgets: nextTargetWidgets,
  };
  return nextPanels;
}

export function renameControlPanelTitle(
  panels: readonly StudioPanelSpec[] | undefined,
  panelId: string,
  title: string,
): StudioPanelSpec[] {
  const nextTitle = title.trim();
  return (panels ?? []).map((panel) => {
    if (panel.kind !== 'control' || panel.id !== panelId) {
      return panel;
    }

    return {
      ...panel,
      title: nextTitle || undefined,
    };
  });
}

export function updateControlWidgetLabel(
  panels: readonly StudioPanelSpec[] | undefined,
  panelId: string,
  widgetId: string,
  label: string,
): StudioPanelSpec[] {
  const nextLabel = label.trim();
  return (panels ?? []).map((panel) => {
    if (panel.kind !== 'control' || panel.id !== panelId) {
      return panel;
    }

    return {
      ...panel,
      widgets: panel.widgets.map((widget) =>
        widget.id === widgetId
          ? {
              ...widget,
              label: nextLabel || undefined,
            }
          : widget,
      ),
    };
  });
}

export function updateControlWidgetInputKind(
  panels: readonly StudioPanelSpec[] | undefined,
  panelId: string,
  widgetId: string,
  inputKind: StudioControlWidgetInputKind,
): StudioPanelSpec[] {
  return (panels ?? []).map((panel) => {
    if (panel.kind !== 'control' || panel.id !== panelId) {
      return panel;
    }

    return {
      ...panel,
      widgets: panel.widgets.map((widget) =>
        widget.id === widgetId
          ? {
              ...widget,
              inputKind,
            }
          : widget,
      ),
    };
  });
}

export function updateControlWidgetSliderConfig(
  panels: readonly StudioPanelSpec[] | undefined,
  panelId: string,
  widgetId: string,
  slider: StudioControlWidgetSliderConfig,
): StudioPanelSpec[] {
  return (panels ?? []).map((panel) => {
    if (panel.kind !== 'control' || panel.id !== panelId) {
      return panel;
    }

    return {
      ...panel,
      widgets: panel.widgets.map((widget) =>
        widget.id === widgetId
          ? {
              ...widget,
              slider,
            }
          : widget,
      ),
    };
  });
}

export function removeControlWidgetFromPanel(
  panels: readonly StudioPanelSpec[] | undefined,
  panelId: string,
  widgetId: string,
): StudioPanelSpec[] {
  return (panels ?? []).map((panel) => {
    if (panel.kind !== 'control' || panel.id !== panelId) {
      return panel;
    }

    return {
      ...panel,
      widgets: panel.widgets.filter((widget) => widget.id !== widgetId),
    };
  });
}

export function removeControlWidgetsBoundToVariable(
  panels: readonly StudioPanelSpec[] | undefined,
  variableName: string,
): StudioPanelSpec[] {
  return (panels ?? []).map((panel) => {
    if (panel.kind !== 'control') {
      return panel;
    }

    return {
      ...panel,
      widgets: panel.widgets.filter(
        (widget) => widget.binding.kind !== 'variable' || widget.binding.variableName !== variableName,
      ),
    };
  });
}

export function moveControlWidgetInPanel(
  panels: readonly StudioPanelSpec[] | undefined,
  panelId: string,
  widgetId: string,
  direction: 'up' | 'down',
): StudioPanelSpec[] {
  return (panels ?? []).map((panel) => {
    if (panel.kind !== 'control' || panel.id !== panelId) {
      return panel;
    }

    const index = panel.widgets.findIndex((widget) => widget.id === widgetId);
    if (index < 0) {
      return panel;
    }

    const nextIndex = direction === 'up' ? index - 1 : index + 1;
    if (nextIndex < 0 || nextIndex >= panel.widgets.length) {
      return panel;
    }

    const nextWidgets = [...panel.widgets];
    [nextWidgets[index], nextWidgets[nextIndex]] = [nextWidgets[nextIndex], nextWidgets[index]];
    return {
      ...panel,
      widgets: nextWidgets,
    };
  });
}
