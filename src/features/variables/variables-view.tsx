import type { ResolvedGraphVariables } from './model/resolveGraphVariables';
import type { StudioVariable } from '../graph-document/model/studio-workspace';
import { bindingTextToExpressionBinding, expressionBindingToText } from './model/variable-binding';

type VariablesViewProps = {
  variables?: readonly StudioVariable[];
  resolvedGraph?: ResolvedGraphVariables;
  variableControlNames?: ReadonlySet<string>;
  onCreateVariable?: () => void;
  onUpdateVariable?: (variableId: string, patch: Partial<Pick<StudioVariable, 'name' | 'binding'>>) => void;
  onRemoveVariable?: (variableId: string) => void;
  onCreateVariableControl?: (variableName: string, inputValue?: string) => void;
  onRemoveVariableControl?: (variableName: string) => void;
};

function previewResolvedValue(resolution: ResolvedGraphVariables['variablesByName'][string] | undefined): string {
  if (!resolution) {
    return 'No preview';
  }

  if (resolution.state === 'resolved' || resolution.state === 'literal') {
    return `→ ${String(resolution.value ?? '')}`;
  }

  return resolution.reason ?? 'Invalid expression';
}

function rowStateClass(resolution: ResolvedGraphVariables['variablesByName'][string] | undefined): string {
  if (!resolution) {
    return 'border-slate-700 bg-slate-900/55';
  }

  if (resolution.state === 'resolved' || resolution.state === 'literal') {
    return 'border-slate-700 bg-slate-900/55';
  }

  return 'border-rose-800/70 bg-rose-950/20';
}

export function VariablesView({
  variables,
  resolvedGraph,
  variableControlNames,
  onCreateVariable,
  onUpdateVariable,
  onRemoveVariable,
  onCreateVariableControl,
  onRemoveVariableControl,
}: VariablesViewProps) {
  const variableList = variables ?? [];

  return (
    <div className="h-full w-full overflow-auto p-4">
      <div className="flex h-full min-h-[24rem] flex-col rounded border border-border bg-panel p-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-slate-100">Variables</h2>
            <p className="mt-1 text-xs text-slate-400">Graph-owned values and expressions.</p>
          </div>
          {onCreateVariable && (
            <button
              type="button"
              onClick={onCreateVariable}
              className="rounded border border-slate-600 bg-slate-900 px-2 py-1 text-sm text-slate-200 hover:bg-slate-800"
            >
              Add variable
            </button>
          )}
        </div>

        <div className="mt-4 grid grid-cols-[minmax(10rem,1.1fr)_minmax(0,1.7fr)_minmax(10rem,1fr)_auto] gap-x-3 border-b border-slate-700 px-2 pb-2 text-xs font-medium uppercase tracking-wide text-slate-500">
          <div>Name</div>
          <div>Value / Expression</div>
          <div>Resolved value</div>
          <div className="text-right">Actions</div>
        </div>

        {variableList.length === 0 ? (
          <div className="mt-3 rounded border border-dashed border-slate-700 px-3 py-2 text-xs text-slate-400">
            No variables defined yet.
          </div>
        ) : (
          <div className="mt-2 space-y-2">
            {variableList.map((variable) => {
              const resolution = resolvedGraph?.variablesByName[variable.name];
              const bindingText = expressionBindingToText(variable.binding);
              const hasControl = Boolean(variableControlNames?.has(variable.name));
              const hasError = Boolean(
                resolution &&
                  resolution.state !== 'resolved' &&
                  resolution.state !== 'literal',
              );

              return (
                <div
                  key={variable.id}
                  className={`grid grid-cols-[minmax(10rem,1.1fr)_minmax(0,1.7fr)_minmax(10rem,1fr)_auto] items-start gap-x-3 gap-y-1 rounded border px-2 py-2 ${rowStateClass(
                    resolution,
                  )}`}
                >
                  <input
                    type="text"
                    value={variable.name}
                    onChange={(event) =>
                      onUpdateVariable?.(variable.id, {
                        name: event.currentTarget.value,
                        binding: variable.binding,
                      })
                    }
                    className="min-w-0 rounded border border-slate-600 bg-slate-950 px-2 py-1 text-base text-slate-100 outline-none focus:border-cyan-500"
                  />

                  <div className="min-w-0">
                    <input
                      type="text"
                      value={bindingText}
                      onChange={(event) =>
                        onUpdateVariable?.(variable.id, {
                          name: variable.name,
                          binding: bindingTextToExpressionBinding(event.currentTarget.value),
                        })
                      }
                      className={`min-w-0 w-full rounded border px-2 py-1 text-sm text-slate-100 outline-none focus:border-cyan-500 ${
                        hasError ? 'border-rose-700 bg-rose-950/25' : 'border-slate-600 bg-slate-950'
                      }`}
                    />
                    {hasError && resolution?.reason && (
                      <div className="mt-1 text-xs text-rose-300">{resolution.reason}</div>
                    )}
                  </div>

                  <div className={`min-w-0 pt-1 text-sm ${hasError ? 'text-rose-200' : 'text-slate-200'}`}>
                    {previewResolvedValue(resolution)}
                  </div>

                  <div className="flex items-start justify-end gap-2">
                    <button
                      type="button"
                      onClick={() =>
                        hasControl
                          ? onRemoveVariableControl?.(variable.name)
                          : onCreateVariableControl?.(variable.name, bindingText)
                      }
                      className={`rounded border px-2 py-1 text-xs ${
                        hasControl
                          ? 'border-rose-700/70 bg-rose-900/25 text-rose-100 hover:bg-rose-800/35'
                          : 'border-slate-600 bg-slate-900 text-slate-200 hover:bg-slate-800'
                      }`}
                    >
                      {hasControl ? 'Remove control' : 'Add control'}
                    </button>
                    <button
                      type="button"
                      onClick={() => onRemoveVariable?.(variable.id)}
                      className="rounded border border-rose-700/70 bg-rose-900/25 px-2 py-1 text-sm text-rose-100 hover:bg-rose-800/35"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
