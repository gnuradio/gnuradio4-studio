import { isCollectionParameter, type BlockDetails, type BlockParameterMeta } from '../../lib/api/block-details';
import type { EditorGraphNode } from '../graph-editor/model/types';
import type {
  StudioControlPanelSpec,
  StudioControlWidgetInputKind,
  StudioControlWidgetSliderConfig,
  StudioControlWidgetSpec,
  StudioControlWidgetBinding,
} from '../graph-document/model/studio-workspace';
import type { ExecutionState, GraphDriftState } from '../runtime-session/store/runtimeSessionStore';
import type { ResolvedGraphVariables } from '../variables/model/resolveGraphVariables';

export type ControlWidgetBindingState =
  | 'missing_node'
  | 'missing_parameter'
  | 'missing_variable'
  | 'incompatible_widget'
  | 'offline'
  | 'stopped'
  | 'stale'
  | 'ready';

type ControlWidgetRuntimeState = {
  sessionId: string | null;
  executionState: ExecutionState;
  graphDriftState: GraphDriftState;
};

export type ResolvedControlWidget = {
  id: string;
  label: string;
  binding: StudioControlWidgetBinding;
  inputKind: StudioControlWidgetInputKind;
  runtimeSessionId?: string | null;
  currentValue: string;
  enumOptions?: readonly string[];
  enumLabels?: Record<string, string>;
  slider?: StudioControlWidgetSliderConfig;
  state: ControlWidgetBindingState;
  reason?: string;
  nodeDisplayName?: string;
  nodeBlockTypeId?: string;
  parameterMeta?: BlockParameterMeta;
  variableName?: string;
};

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

function isCompatibleWidget(widget: StudioControlWidgetSpec, parameterMeta?: BlockParameterMeta): boolean {
  if (!parameterMeta) {
    return true;
  }

  if (widget.inputKind === 'text') {
    return true;
  }

  if (isCollectionParameter(parameterMeta)) {
    return false;
  }

  if (widget.inputKind === 'enum') {
    return parameterMeta.valueKind === 'enum' || Boolean(parameterMeta.enumChoices?.length);
  }

  if (widget.inputKind === 'boolean') {
    return isBooleanTypeName(parameterMeta.valueType);
  }

  if (widget.inputKind === 'number') {
    return isNumericTypeName(parameterMeta.valueType);
  }

  if (widget.inputKind === 'slider') {
    return isNumericTypeName(parameterMeta.valueType);
  }

  return false;
}

function stringifyResolvedValue(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }
  if (typeof value === 'string') {
    return value;
  }
  return String(value);
}

function deriveRuntimeState(runtime?: ControlWidgetRuntimeState | null): { state: ControlWidgetBindingState; reason: string } {
  if (!runtime?.sessionId) {
    return {
      state: 'offline',
      reason: 'No linked session is available for live control.',
    };
  }

  if (runtime.executionState !== 'running') {
    return {
      state: 'stopped',
      reason: `Linked session ${runtime.sessionId} is not running.`,
    };
  }

  if (runtime.graphDriftState === 'out-of-sync') {
    return {
      state: 'stale',
      reason: `Linked session ${runtime.sessionId} is stale relative to the current graph.`,
    };
  }

  return {
    state: 'ready',
    reason: `Linked session ${runtime.sessionId} is running and in sync.`,
  };
}

export function resolveControlPanelWidgetBindings(input: {
  panel: StudioControlPanelSpec;
  nodeById: ReadonlyMap<string, EditorGraphNode>;
  blockDetailsByType: ReadonlyMap<string, BlockDetails>;
  resolvedGraph?: ResolvedGraphVariables;
  runtime?: ControlWidgetRuntimeState | null;
}): ResolvedControlWidget[] {
  return input.panel.widgets.map((widget) => {
    const label =
      widget.label?.trim() ||
      (widget.binding.kind === 'parameter' ? widget.binding.parameterName : widget.binding.variableName);
    if (widget.binding.kind === 'variable') {
      const variableResolution = input.resolvedGraph?.variablesByName[widget.binding.variableName];
      const displayValue =
        variableResolution?.value ??
        (variableResolution?.binding.kind === 'expression'
          ? variableResolution.binding.expr
          : variableResolution?.binding.value);
      if (!variableResolution) {
        return {
          id: widget.id,
          label: widget.label?.trim() || widget.binding.variableName,
          binding: widget.binding,
          inputKind: widget.inputKind,
          slider: widget.slider,
          runtimeSessionId: null,
          currentValue: '',
          state: 'missing_variable' as const,
          variableName: widget.binding.variableName,
          reason: `Variable ${widget.binding.variableName} was not found in the current graph.`,
        };
      }

      return {
        id: widget.id,
        label: widget.label?.trim() || widget.binding.variableName,
        binding: widget.binding,
        inputKind: widget.inputKind,
        slider: widget.slider,
        runtimeSessionId: null,
        currentValue: stringifyResolvedValue(displayValue),
        state: 'ready' as const,
        variableName: widget.binding.variableName,
        reason: variableResolution.reason ?? 'Variable is available for editing.',
      };
    }

    const binding = widget.binding;
    const node = input.nodeById.get(binding.nodeId);
    if (!node) {
      return {
        id: widget.id,
        label,
        binding,
        inputKind: widget.inputKind,
        slider: widget.slider,
        runtimeSessionId: input.runtime?.sessionId ?? null,
        currentValue: '',
        state: 'missing_node' as const,
        reason: `Node ${binding.nodeId} was not found in the current graph.`,
      };
    }

    const parameterEntry = node.parameters[binding.parameterName];
    if (!parameterEntry) {
      return {
        id: widget.id,
        label,
        binding,
        inputKind: widget.inputKind,
        slider: widget.slider,
        runtimeSessionId: input.runtime?.sessionId ?? null,
        currentValue: '',
        state: 'missing_parameter' as const,
        nodeDisplayName: node.displayName,
        nodeBlockTypeId: node.blockTypeId,
        reason: `Parameter ${binding.parameterName} was not found on node ${node.instanceId}.`,
      };
    }

    const blockDetails = input.blockDetailsByType.get(node.blockTypeId);
    const parameterMeta = blockDetails?.parameters.find((parameter) => parameter.name === binding.parameterName);
    const enumOptions = widget.enumOptions ?? parameterMeta?.enumChoices ?? parameterMeta?.enumOptions;
    const enumLabels = widget.enumLabels ?? parameterMeta?.enumLabels;
    if (parameterMeta && !isCompatibleWidget(widget, parameterMeta)) {
      return {
        id: widget.id,
        label,
        binding: widget.binding,
        inputKind: widget.inputKind,
        slider: widget.slider,
        runtimeSessionId: input.runtime?.sessionId ?? null,
        currentValue: parameterEntry.value,
        enumOptions,
        enumLabels,
        state: 'incompatible_widget' as const,
        nodeDisplayName: node.displayName,
        nodeBlockTypeId: node.blockTypeId,
        parameterMeta,
        reason: `Widget input ${widget.inputKind} is not compatible with ${parameterMeta.name} on ${node.blockTypeId}.`,
      };
    }

    const runtimeState = deriveRuntimeState(input.runtime);
    return {
      id: widget.id,
      label,
      binding: widget.binding,
      inputKind: widget.inputKind,
      slider: widget.slider,
      runtimeSessionId: input.runtime?.sessionId ?? null,
      currentValue: parameterEntry.value,
      enumOptions,
      enumLabels,
      state: runtimeState.state,
      nodeDisplayName: node.displayName,
      nodeBlockTypeId: node.blockTypeId,
      parameterMeta,
      reason: runtimeState.reason,
    };
  });
}
