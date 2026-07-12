import type { GraphDocument, GraphDocumentEdge, GraphDocumentNode, GraphParameterValue } from '../../graph-document/model/types';
import type { BlockDetails, BlockParameterMeta } from '../../../lib/api/block-details';
import type { GrcExport } from './types';
import { resolveGraphVariables } from '../../variables/model/resolveGraphVariables';
import type { JsonPrimitive } from '../../variables/model/types';
import { createEdgeId } from '../../graph-editor/model/nodeFactory';
import { lookupStudioKnownBlockBinding } from '../../graph-editor/runtime/known-block-bindings';
import { isDescriptorBindingHiddenParameter } from '../../graph-editor/runtime/studio-managed-runtime-authoring';
import {
  isVirtualRoutingBlockType,
  isVirtualSinkBlockType,
  isVirtualSourceBlockType,
  isNoteBlockType,
} from '../../graph-editor/model/virtual-routing';

function stableHash(input: string): string {
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function sanitizeScalar(value: JsonPrimitive): string {
  if (value === null || value === undefined) {
    return '""';
  }

  const raw = typeof value === 'string' ? value : String(value);
  const trimmed = raw.trim();
  if (!trimmed) {
    return '""';
  }

  const unsafeYaml = /[:#\n\r]/.test(trimmed);
  if (unsafeYaml) {
    return JSON.stringify(trimmed);
  }

  return trimmed;
}

const NUMERIC_SCALAR_PATTERN = /^-?(?:(?:\d+\.?\d*)|(?:\.\d+))(?:[eE][+-]?\d+)?$/;

function shouldRenderAsFloatScalar(parameterMeta: BlockParameterMeta | undefined): boolean {
  const normalized = parameterMeta?.valueType?.trim().toLowerCase() ?? '';
  if (!normalized || normalized.includes('vector') || normalized.includes('tensor')) {
    return false;
  }

  return normalized === 'float' || normalized === 'double' || normalized === 'float32' || normalized === 'float64';
}

function renderFloatScalar(rawValue: JsonPrimitive | undefined): string | undefined {
  if (typeof rawValue === 'number') {
    if (!Number.isFinite(rawValue)) {
      return undefined;
    }
    return Number.isInteger(rawValue) ? `${rawValue}.0` : String(rawValue);
  }

  if (typeof rawValue !== 'string') {
    return undefined;
  }

  const trimmed = rawValue.trim();
  if (!NUMERIC_SCALAR_PATTERN.test(trimmed)) {
    return undefined;
  }

  return /[.eE]/.test(trimmed) ? trimmed : `${trimmed}.0`;
}

function yamlTagForParameter(parameterMeta: BlockParameterMeta | undefined): string | undefined {
  const normalized = parameterMeta?.valueType?.trim().toLowerCase() ?? '';
  if (!normalized) {
    return undefined;
  }

  if (
    normalized === 'float64_vector' ||
    normalized === 'double_vector' ||
    normalized === 'vector<double>' ||
    normalized === 'std::vector<double>'
  ) {
    return '!!float64';
  }

  if (
    normalized === 'float32_vector' ||
    normalized === 'vector<float>' ||
    normalized === 'std::vector<float>'
  ) {
    return '!!float32';
  }

  if (
    normalized === 'complex_float64_vector' ||
    normalized === 'complex64_vector' ||
    normalized === 'vector<complex<float64>>' ||
    normalized === 'std::vector<std::complex<double>>'
  ) {
    return '!!complex64';
  }

  if (
    normalized === 'complex_float32_vector' ||
    normalized === 'complex32_vector' ||
    normalized === 'vector<complex<float32>>' ||
    normalized === 'std::vector<std::complex<float>>'
  ) {
    return '!!complex32';
  }

  if (normalized === 'int_vector') {
    return '!!int64';
  }

  if (normalized === 'bool_vector') {
    return '!!bool';
  }

  if (normalized === 'string_vector') {
    return '!!str';
  }

  if (normalized === 'float_vector') {
    // Older control-plane versions collapse float32 and float64 vectors to
    // "float_vector". Keep this compatibility path narrow so unrelated
    // std::vector<float> settings, such as FIR taps, are not retagged as
    // float64.
    const knownDoubleVectorParameters = new Set([
      'frequency',
      'rx_bandwidths',
      'rx_gains',
      'tx_bandwidths',
      'tx_gains',
      'dc_offset',
      'iq_balance',
    ]);
    return parameterMeta && knownDoubleVectorParameters.has(parameterMeta.name) ? '!!float64' : undefined;
  }

  return undefined;
}

function shouldApplySequenceTag(trimmed: string): boolean {
  if (!trimmed || trimmed.startsWith('!!')) {
    return false;
  }
  return trimmed.startsWith('[') || trimmed.startsWith('- ');
}

function renderParameterValue(
  name: string,
  rawValue: JsonPrimitive | undefined,
  parameterMeta?: BlockParameterMeta,
): string {
  const trimmed = typeof rawValue === 'string' ? rawValue.trim() : String(rawValue ?? '').trim();
  if (name === 'ui_constraints') {
    if (!trimmed) {
      return '{}';
    }

    const wrappedInQuotes =
      (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
      (trimmed.startsWith("'") && trimmed.endsWith("'"));

    if (wrappedInQuotes) {
      const inner = trimmed.slice(1, -1).trim();
      if (inner.startsWith('{') || inner.startsWith('[')) {
        return inner;
      }
    }
  }

  const yamlTag = yamlTagForParameter(parameterMeta);
  if (yamlTag && shouldApplySequenceTag(trimmed)) {
    return `${yamlTag} ${trimmed}`;
  }

  if (shouldRenderAsFloatScalar(parameterMeta)) {
    return renderFloatScalar(rawValue) ?? sanitizeScalar(trimmed);
  }

  return sanitizeScalar(trimmed);
}

type ToGrctrlContentSubmissionOptions = {
  blockDetailsByType?: ReadonlyMap<string, BlockDetails>;
};

function getLiteralStringParameter(node: GraphDocumentNode, name: string): string {
  const parameter = node.parameters[name];
  const value = parameter?.kind === 'literal' ? parameter.value : undefined;
  return typeof value === 'string' ? value.trim() : '';
}

function expandVirtualRoutes(params: {
  nodes: GraphDocumentNode[];
  edges: GraphDocumentEdge[];
}): {
  nodes: GraphDocumentNode[];
  edges: GraphDocumentEdge[];
} {
  const virtualNodes = params.nodes.filter((node) => isVirtualRoutingBlockType(node.blockType));
  if (virtualNodes.length === 0) {
    return params;
  }

  const virtualNodeIds = new Set(virtualNodes.map((node) => node.id));
  const virtualSinkByStreamId = new Map<string, GraphDocumentNode>();
  const virtualSourcesByStreamId = new Map<string, GraphDocumentNode[]>();

  virtualNodes.forEach((node) => {
    const streamId = getLiteralStringParameter(node, 'stream_id');
    if (!streamId) {
      throw new Error(`Virtual routing block "${node.id}" requires a literal stream_id parameter.`);
    }

    if (isVirtualSinkBlockType(node.blockType)) {
      const existing = virtualSinkByStreamId.get(streamId);
      if (existing) {
        throw new Error(
          `Virtual route "${streamId}" has multiple sinks: "${existing.id}" and "${node.id}".`,
        );
      }
      virtualSinkByStreamId.set(streamId, node);
      return;
    }

    if (isVirtualSourceBlockType(node.blockType)) {
      const sources = virtualSourcesByStreamId.get(streamId) ?? [];
      sources.push(node);
      virtualSourcesByStreamId.set(streamId, sources);
    }
  });

  const nextEdges = params.edges.filter(
    (edge) => !virtualNodeIds.has(edge.source.nodeId) && !virtualNodeIds.has(edge.target.nodeId),
  );
  const existingEdgeIds = new Set(nextEdges.map((edge) => edge.id));

  for (const [streamId, sources] of virtualSourcesByStreamId.entries()) {
    const sink = virtualSinkByStreamId.get(streamId);
    if (!sink) {
      throw new Error(`Virtual source route "${streamId}" has no matching virtual sink.`);
    }

    const incoming = params.edges.filter((edge) => edge.target.nodeId === sink.id);
    const outgoing = sources.flatMap((source) =>
      params.edges.filter((edge) => edge.source.nodeId === source.id),
    );

    incoming.forEach((inputEdge) => {
      outgoing.forEach((outputEdge) => {
        const nextEdgeId = createEdgeId(
          inputEdge.source.nodeId,
          outputEdge.target.nodeId,
          inputEdge.source.portId,
          outputEdge.target.portId,
        );
        if (existingEdgeIds.has(nextEdgeId)) {
          return;
        }

        existingEdgeIds.add(nextEdgeId);
        nextEdges.push({
          id: nextEdgeId,
          source: {
            nodeId: inputEdge.source.nodeId,
            portId: inputEdge.source.portId,
          },
          target: {
            nodeId: outputEdge.target.nodeId,
            portId: outputEdge.target.portId,
          },
        });
      });
    });
  }

  return {
    nodes: params.nodes.filter((node) => !virtualNodeIds.has(node.id)),
    edges: nextEdges,
  };
}

function buildRuntimeGraph(document: GraphDocument): {
  nodes: GraphDocumentNode[];
  edges: GraphDocumentEdge[];
} {
  const omittedEditorNodeIds = new Set(
    document.graph.nodes.filter((node) => isNoteBlockType(node.blockType)).map((node) => node.id),
  );
  const disabledNodeIds = new Set(
    document.graph.nodes
      .filter((node) => (node.executionMode ?? 'active') === 'disabled')
      .map((node) => node.id),
  );
  const bypassedNodeIds = new Set(
    document.graph.nodes
      .filter(
        (node) =>
          (node.executionMode ?? 'active') === 'bypassed' &&
          !disabledNodeIds.has(node.id) &&
          !omittedEditorNodeIds.has(node.id),
      )
      .map((node) => node.id),
  );

  const nodes = document.graph.nodes.filter(
    (node) =>
      !disabledNodeIds.has(node.id) &&
      !omittedEditorNodeIds.has(node.id) &&
      (node.executionMode ?? 'active') !== 'bypassed',
  );
  let edges = document.graph.edges.filter(
    (edge) =>
      !disabledNodeIds.has(edge.source.nodeId) &&
      !disabledNodeIds.has(edge.target.nodeId) &&
      !omittedEditorNodeIds.has(edge.source.nodeId) &&
      !omittedEditorNodeIds.has(edge.target.nodeId),
  );

  const existingEdgeIds = new Set(edges.map((edge) => edge.id));
  while (bypassedNodeIds.size > 0) {
    let progressed = false;
    for (const nodeId of Array.from(bypassedNodeIds)) {
      const incoming = edges.filter((edge) => edge.target.nodeId === nodeId);
      const outgoing = edges.filter((edge) => edge.source.nodeId === nodeId);
      if (incoming.length === 0 && outgoing.length === 0) {
        bypassedNodeIds.delete(nodeId);
        progressed = true;
        continue;
      }

      edges = edges.filter((edge) => edge.source.nodeId !== nodeId && edge.target.nodeId !== nodeId);
      incoming.forEach((inputEdge) => {
        outgoing.forEach((outputEdge) => {
          const nextEdgeId = createEdgeId(
            inputEdge.source.nodeId,
            outputEdge.target.nodeId,
            inputEdge.source.portId,
            outputEdge.target.portId,
          );
          if (existingEdgeIds.has(nextEdgeId)) {
            return;
          }

          existingEdgeIds.add(nextEdgeId);
          edges.push({
            id: nextEdgeId,
            source: {
              nodeId: inputEdge.source.nodeId,
              portId: inputEdge.source.portId,
            },
            target: {
              nodeId: outputEdge.target.nodeId,
              portId: outputEdge.target.portId,
            },
          });
        });
      });

      bypassedNodeIds.delete(nodeId);
      progressed = true;
    }

    if (!progressed) {
      break;
    }
  }

  return expandVirtualRoutes({ nodes, edges });
}

function shouldOmitParameter(name: string, rawValue: JsonPrimitive | undefined): boolean {
  if (name === 'ui_constraints') {
    return false;
  }

  if (rawValue === null || rawValue === undefined) {
    return true;
  }

  if (typeof rawValue === 'string') {
    return rawValue.trim().length === 0;
  }

  return false;
}

function shouldOmitParameterForBlock(blockTypeId: string, name: string, rawValue: JsonPrimitive | undefined): boolean {
  if (isDescriptorBindingHiddenParameter(blockTypeId, name)) {
    return true;
  }

  if (
    (blockTypeId.startsWith('gr::studio::StudioSeriesSink<') ||
      blockTypeId.startsWith('gr::studio::StudioPowerSpectrumSink<')) &&
    (name === 'x_min' || name === 'x_max')
  ) {
    return true;
  }

  return shouldOmitParameter(name, rawValue);
}

function indent(lines: string[], spaces = 2): string[] {
  const prefix = ' '.repeat(spaces);
  return lines.map((line) => `${prefix}${line}`);
}

function serializeGraphDocumentToInlineGrc(
  document: GraphDocument,
  options?: ToGrctrlContentSubmissionOptions,
): string {
  const runtimeGraph = buildRuntimeGraph(document);
  const nodes = [...runtimeGraph.nodes].sort((left, right) => left.id.localeCompare(right.id));
  const edges = [...runtimeGraph.edges].sort((left, right) => left.id.localeCompare(right.id));
  const blockDetailsByType = options?.blockDetailsByType;
  const resolved = resolveGraphVariables(document);

  const lines: string[] = [];
  lines.push(`# gr4-studio inline grc`);
  lines.push(`metadata:`);
  lines.push(...indent([`name: ${sanitizeScalar(document.metadata.name)}`]));
  lines.push(...indent([`description: ${sanitizeScalar(document.metadata.description ?? '')}`]));
  lines.push(`blocks:`);

  if (nodes.length === 0) {
    lines.push(...indent(['[]']));
  } else {
    nodes.forEach((node) => {
      lines.push(...indent([`- id: ${sanitizeScalar(node.blockType)}`]));
      lines.push(...indent([`  parameters:`]));
      lines.push(...indent([`    name: ${sanitizeScalar(node.id)}`]));

      const parameterEntries = new Map<string, GraphParameterValue>();
      Object.entries(node.parameters)
        .sort(([left], [right]) => left.localeCompare(right))
        .forEach(([name, parameter]) => {
          parameterEntries.set(name, parameter);
        });

      const blockDetails = blockDetailsByType?.get(node.blockType);
      if (blockDetails) {
        blockDetails.parameters.forEach((parameter) => {
          if (parameter.name === 'name' || parameterEntries.has(parameter.name)) {
            return;
          }
          if (parameter.defaultValue === undefined) {
            return;
          }
          parameterEntries.set(parameter.name, {
            kind: 'literal',
            value: parameter.defaultValue,
          });
        });
      }

      const studioBinding = lookupStudioKnownBlockBinding(node.blockType);
      if (studioBinding && !parameterEntries.has('payload_format')) {
        // The control plane now requires authored stream metadata on Studio blocks.
        // Export the compatibility payload format explicitly so legacy graphs and
        // graph documents without block-details hydration still prepare cleanly.
        parameterEntries.set('payload_format', {
          kind: 'literal',
          value: studioBinding.payloadFormat,
        });
      }

      const sortedParameterEntries = [...parameterEntries.entries()].sort(([left], [right]) => left.localeCompare(right));
      if (sortedParameterEntries.length > 0) {
        sortedParameterEntries.forEach(([name, parameter]) => {
          if (name === 'name') {
            return;
          }

          const resolvedParameter = resolved.parametersByNodeId[node.id]?.[name];
          const fallbackValue = parameter.kind === 'literal' ? parameter.value : undefined;
          const parameterValue = resolvedParameter?.state === 'resolved' ? resolvedParameter.value : fallbackValue;
          if (shouldOmitParameterForBlock(node.blockType, name, parameterValue)) {
            return;
          }
          const parameterMeta = blockDetails?.parameters.find((candidate) => candidate.name === name);
          lines.push(...indent([`    ${name}: ${renderParameterValue(name, parameterValue, parameterMeta)}`]));
        });
      }
    });
  }

  lines.push(`connections:`);
  if (edges.length === 0) {
    lines.push(...indent(['[]']));
  } else {
    edges.forEach((edge) => {
      const sourcePort = edge.source.portId ?? 'out';
      const targetPort = edge.target.portId ?? 'in';
      lines.push(
        ...indent([
          `- [${sanitizeScalar(edge.source.nodeId)}, ${sanitizeScalar(sourcePort)}, ${sanitizeScalar(edge.target.nodeId)}, ${sanitizeScalar(targetPort)}]`,
        ]),
      );
    });
  }

  return `${lines.join('\n')}\n`;
}

export function toGrctrlContentSubmission(
  document: GraphDocument,
  options?: ToGrctrlContentSubmissionOptions,
): GrcExport {
  const content = serializeGraphDocumentToInlineGrc(document, options);

  return {
    graphName: document.metadata.name,
    content,
    contentHash: stableHash(content),
  };
}

export { stableHash };
