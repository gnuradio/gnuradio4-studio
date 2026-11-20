import { useId, useState } from 'react';
import type { BlockDetails } from '../../lib/api/block-details';
import { isAdvancedParameterName, isAdvancedUiHint } from '../../lib/utils/parameter-groups';
import { BlockPropertiesModal } from '../block-properties/block-properties-modal';
import type { EditorGraphNode } from '../graph-editor/model/types';
import { toCanonicalBlockDisplayName } from '../graph-editor/model/presentation';
import { getAuthoringParameterLabel, isDescriptorBindingHiddenParameter } from '../graph-editor/runtime/studio-managed-runtime-authoring';
import type { StudioBindingView } from '../graph-editor/runtime/known-block-bindings';
import type { RenderedPort, ResolveRenderedPortsResult } from '../ports/model/types';
import { getPortTypeColor } from '../ports/model/typeColors';
import { InspectorCopyButton } from './inspector-components';
import { useEditorStore } from '../graph-editor/store/editorStore';
import { extractDoxygenBrief } from '../documentation/model/doxygen';

export function SelectionHeader({ block, details }: { block: EditorGraphNode; details?: BlockDetails }) {
  // Namespace is structural identity; template arguments may contain other namespaces.
  const baseType = block.blockTypeId.split('<')[0];
  const namespaceEnd = baseType.lastIndexOf('::');
  const namespace = namespaceEnd > 0 ? baseType.slice(0, namespaceEnd) : block.category;
  const input = details?.inputPorts[0];
  const output = details?.outputPorts[0];
  const signature = details?.inputPorts.length === 1 && details.outputPorts.length === 1 &&
    input?.cardinalityKind === 'fixed' && output?.cardinalityKind === 'fixed' && input.valueType && output.valueType
    ? `${input.valueType} → ${output.valueType}` : undefined;
  const description = extractDoxygenBrief(details?.description);

  return (
    <header className="space-y-1 pb-3">
      <h2 className="text-lg font-semibold leading-5 text-slate-100 [overflow-wrap:anywhere]">
        {toCanonicalBlockDisplayName(block.displayName, block.blockTypeId)}
      </h2>
      {signature && <p className="text-xs text-slate-300 [overflow-wrap:anywhere]">{signature}</p>}
      {!signature && description && <p title={description} className="line-clamp-2 text-xs text-slate-300 [overflow-wrap:anywhere]">{description}</p>}
      {namespace && <p className="text-xs text-slate-400 [overflow-wrap:anywhere]">{namespace}</p>}
    </header>
  );
}

export function SelectionParameters({ block, details }: { block: EditorGraphNode; details: BlockDetails }) {
  const [editing, setEditing] = useState(false);
  const [filter, setFilter] = useState('');
  const parameters = details.parameters.filter((parameter) =>
    parameter.mutable && !parameter.readOnly &&
    !isAdvancedParameterName(parameter.name) && !isAdvancedUiHint(parameter.uiHint) &&
    !isDescriptorBindingHiddenParameter(block.blockTypeId, parameter.name));
  const visibleParameters = parameters.filter((parameter) =>
    getAuthoringParameterLabel(block.blockTypeId, parameter.name, parameter.label).toLowerCase().includes(filter.toLowerCase()) ||
    parameter.name.toLowerCase().includes(filter.toLowerCase()));

  return (
    <>
      <section className="inspector-section" aria-label="Parameters">
        <div className="flex items-center justify-between gap-2">
          <h3 className="inspector-heading" title="Properties saved in the graph document">Parameters</h3>
          {details.parameters.length > 0 && (
            <button type="button" className="inspector-button" onClick={() => setEditing(true)}>
              Edit parameters
            </button>
          )}
        </div>
        {parameters.length > 8 && (
          <input type="search" aria-label="Filter parameters" placeholder="Filter parameters…" value={filter}
            onChange={(event) => setFilter(event.target.value)} className="inspector-input" />
        )}
        {parameters.length === 0 ? <p className="text-xs text-slate-400">
          {details.parameters.some((parameter) => parameter.mutable && !parameter.readOnly &&
            !isDescriptorBindingHiddenParameter(block.blockTypeId, parameter.name))
            ? 'Additional settings are in Advanced.' : 'No configurable parameters.'}
        </p> : (
          <dl className="space-y-2">
            {visibleParameters.map((parameter) => {
              const draft = block.parameters[parameter.name];
              const value = draft?.value ?? parameter.defaultValue ?? '';
              return (
                <div key={parameter.name} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] items-baseline gap-3 text-sm leading-5">
                  <dt title={parameter.description || parameter.name} className="text-slate-300 [overflow-wrap:anywhere]">
                    {getAuthoringParameterLabel(block.blockTypeId, parameter.name, parameter.label)}
                  </dt>
                  <dd className="text-right text-slate-100 [overflow-wrap:anywhere]">
                    {draft?.bindingKind === 'expression' && <span className="mr-1 text-xs text-slate-400" title="Expression">ƒ</span>}
                    {value || <span className="text-slate-400">—</span>}
                  </dd>
                </div>
              );
            })}
          </dl>
        )}
        {parameters.length > 0 && visibleParameters.length === 0 && <p className="text-xs text-slate-400">No matching parameters.</p>}
      </section>
      {editing && <BlockPropertiesModal instanceId={block.instanceId} onClose={() => setEditing(false)} />}
    </>
  );
}

export function SelectionPorts({ ports }: { ports: ResolveRenderedPortsResult }) {
  return (
    <>
      {ports.inputs.length === 0 && ports.outputs.length === 0 && <p className="text-xs text-slate-400">No ports.</p>}
      {([['Input', ports.inputs], ['Output', ports.outputs]] as const).map(([direction, entries]) => entries.length > 0 && (
        <div key={direction}>
          <h4 className="mb-1 text-xs font-medium text-slate-400">{direction}</h4>
          <ul className="space-y-1">
            {entries.map((port) => <PortRow key={port.key} port={port} />)}
          </ul>
        </div>
      ))}
    </>
  );
}

function PortRow({ port }: { port: RenderedPort }) {
  const color = port.typeName ? getPortTypeColor(port.typeName) : undefined;
  return (
    <li className="flex min-w-0 items-baseline gap-2 text-xs leading-5" title={port.description}>
      <span aria-hidden="true" className="mt-1.5 h-2 w-2 shrink-0 self-start rounded-full border border-slate-600"
        style={color ? { backgroundColor: color.background, borderColor: color.border } : undefined} />
      <span className="min-w-0 flex-1 text-slate-100 [overflow-wrap:anywhere]">{port.displayLabel}</span>
      <span className="min-w-0 max-w-[55%] text-right text-slate-400 [overflow-wrap:anywhere]">
        {port.typeName || 'Type unspecified'}{port.cardinalityKind === 'dynamic' && ' · dynamic'}{port.isOptional && ' · optional'}
      </span>
    </li>
  );
}

function TechnicalIdentifier({ label, value }: { label: string; value: string }) {
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-slate-400">{label}</p>
        <InspectorCopyButton value={value} label={`Copy ${label.toLowerCase()}`} />
      </div>
      <p className="select-text font-mono text-xs text-slate-300 [overflow-wrap:anywhere]">{value}</p>
    </div>
  );
}

function InstanceIdEditor({ instanceId }: { instanceId: string }) {
  const renameNodeInstanceId = useEditorStore((state) => state.renameNodeInstanceId);
  const [draft, setDraft] = useState(instanceId);
  const [error, setError] = useState<string | null>(null);
  const errorId = useId();
  return <form className="space-y-2" onSubmit={(event) => {
    event.preventDefault();
    const result = renameNodeInstanceId(instanceId, draft);
    if (!result.ok) setError(result.error);
  }}>
    <label className="block space-y-1 text-sm text-slate-400">
      <span>Instance ID</span>
      <input aria-label="Instance ID" value={draft} className="inspector-input font-mono" aria-invalid={Boolean(error)}
        aria-describedby={error ? errorId : undefined} title="Graph instance ID. Rerun to update a linked session."
        onChange={(event) => { setDraft(event.target.value); setError(null); }}
        onKeyDown={(event) => {
          if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setDraft(instanceId); setError(null); }
        }} />
    </label>
    <div className="flex flex-wrap items-center gap-2">
      <button type="submit" disabled={draft.trim() === instanceId} className="inspector-button">Rename</button>
      <InspectorCopyButton value={instanceId} label="Copy instance id" />
    </div>
    {error && <p role="alert" id={errorId} className="text-xs text-rose-300">{error}</p>}
  </form>;
}

export function SelectionAdvanced({ block, binding, ports, details }: {
  block: EditorGraphNode;
  binding: StudioBindingView | null;
  ports: ResolveRenderedPortsResult;
  details?: BlockDetails;
}) {
  const otherParameters = details?.parameters.filter((parameter) =>
    !isDescriptorBindingHiddenParameter(block.blockTypeId, parameter.name) &&
    (parameter.readOnly || !parameter.mutable || isAdvancedParameterName(parameter.name) || isAdvancedUiHint(parameter.uiHint))) ?? [];
  return (
    <details className="inspector-section inspector-disclosure">
      <summary className="inspector-heading">Advanced details</summary>
      <div className="mt-3 space-y-3">
        <InstanceIdEditor key={block.instanceId} instanceId={block.instanceId} />
        <TechnicalIdentifier label="Block type ID" value={block.blockTypeId} />
        {binding && (
          <div className="space-y-2">
            <h4 className="text-xs font-medium text-slate-100">Studio binding</h4>
            <dl className="space-y-1 text-xs text-slate-300 [overflow-wrap:anywhere]">
              {Object.entries({
                Registry: binding.status === 'unsupported' ? 'No Studio metadata' : binding.status,
                'Binding kind': binding.family, Transport: binding.transport, Endpoint: binding.endpoint,
                'Update interval (ms)': binding.updateMs, 'Sample rate': binding.sampleRate,
                Channels: binding.channels, Topic: binding.topic, 'Payload format': binding.payloadFormat,
              }).filter(([, value]) => value !== undefined && value !== '').map(([label, value]) => (
                <div key={label}><dt className="text-slate-400">{label}</dt><dd>{value}</dd></div>
              ))}
            </dl>
            {binding.reason && <p className="text-xs text-slate-400 [overflow-wrap:anywhere]">{binding.reason}</p>}
            <p className="text-xs text-slate-400">Local display binding validation; runtime compatibility is determined by the backend.</p>
          </div>
        )}
        {otherParameters.length > 0 && <div className="space-y-2">
          <h4 className="text-xs font-medium text-slate-100">Additional properties</h4>
          {otherParameters.map((parameter) => <div key={parameter.name} className="text-xs [overflow-wrap:anywhere]">
            <p className="text-slate-400">{parameter.label}{parameter.readOnly || !parameter.mutable ? ' · read-only' : ''}</p>
            <p className="text-slate-300">{block.parameters[parameter.name]?.value ?? parameter.defaultValue ?? '—'}</p>
          </div>)}
        </div>}
        {(ports.inputs.length > 0 || ports.outputs.length > 0) && <div>
          <h4 className="mb-1 text-xs font-medium text-slate-100">Port resolution</h4>
          {[...ports.inputs, ...ports.outputs].map((port) => <p key={port.key} className="text-xs text-slate-400 [overflow-wrap:anywhere]">
            {port.direction} · {port.displayLabel} · {port.inference}
          </p>)}
        </div>}
      </div>
    </details>
  );
}
