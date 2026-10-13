import type { BlockDetails, BlockParameterMeta } from '../../../lib/api/block-details';
import { isAdvancedParameterName, isAdvancedUiHint } from '../../../lib/utils/parameter-groups';
import { isDescriptorBindingHiddenParameter } from '../runtime/studio-managed-runtime-authoring';
import type { EditorNodeParameterDrafts } from './types';

const MAX_PARAMETER_LINES = 6;
const MAX_LINE_VALUE_LENGTH = 36;

export type ParameterRow = {
  name: string;
  value: string;
};

type BlockCardSummary = {
  shortDisplayName: string;
  parameterRows: ParameterRow[];
  parameterOverflowCount: number;
};

function stripNamespace(name: string): string {
  const segments = name.split('::');
  return segments[segments.length - 1] || name;
}

function splitTemplateTypeName(name: string): { base: string; templateSuffix?: string } {
  const trimmed = name.trim();
  const lt = trimmed.indexOf('<');
  if (lt < 0) {
    return { base: trimmed };
  }

  return {
    base: trimmed.slice(0, lt).trim(),
    templateSuffix: trimmed.slice(lt).trim(),
  };
}

function canonicalNameFromType(blockTypeId: string): string {
  const { base } = splitTemplateTypeName(blockTypeId);
  return stripNamespace(base).trim() || base || blockTypeId;
}

export function toCanonicalBlockDisplayName(_displayName: string, blockTypeId: string): string {
  return canonicalNameFromType(blockTypeId);
}

export function toShortBlockName(displayName: string, blockTypeId: string): string {
  return toCanonicalBlockDisplayName(displayName, blockTypeId);
}

export function toDisambiguatedShortBlockName(displayName: string, blockTypeId: string): string {
  return toCanonicalBlockDisplayName(displayName, blockTypeId);
}

function truncateValue(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length <= MAX_LINE_VALUE_LENGTH) {
    return trimmed;
  }

  return `${trimmed.slice(0, MAX_LINE_VALUE_LENGTH - 1)}…`;
}

function getCurrentValue(
  parameterValues: EditorNodeParameterDrafts,
  parameterName: string,
): string | undefined {
  const value = parameterValues[parameterName]?.value;
  return typeof value === 'string' ? value : undefined;
}

function buildParameterLines(
  blockTypeId: string,
  parameters: EditorNodeParameterDrafts,
  details?: BlockDetails,
): { rows: ParameterRow[]; overflowCount: number } {
  if (!details) {
    const fallback = Object.entries(parameters)
      .filter(
        ([name]) =>
          !isAdvancedParameterName(name) &&
          !isDescriptorBindingHiddenParameter(blockTypeId, name),
      )
      .map(([name, entry]): ParameterRow => ({ name, value: truncateValue(entry.value) }));
    const visible = fallback.slice(0, MAX_PARAMETER_LINES);
    return {
      rows: visible,
      overflowCount: Math.max(0, fallback.length - visible.length),
    };
  }

  const ordered = details.parameters
    .filter(
      (parameter: BlockParameterMeta) =>
        !isAdvancedParameterName(parameter.name) &&
        !isAdvancedUiHint(parameter.uiHint) &&
        !isDescriptorBindingHiddenParameter(blockTypeId, parameter.name) &&
        !parameter.readOnly &&
        parameter.mutable,
    )
    .map((parameter: BlockParameterMeta): ParameterRow => {
      const currentValue = getCurrentValue(parameters, parameter.name) ?? parameter.defaultValue ?? '';
      return { name: parameter.name, value: truncateValue(currentValue) };
    });

  const visible = ordered.slice(0, MAX_PARAMETER_LINES);
  return {
    rows: visible,
    overflowCount: Math.max(0, ordered.length - visible.length),
  };
}

export function buildBlockCardSummary(
  node: { displayName: string; blockTypeId: string; parameters: EditorNodeParameterDrafts },
  details?: BlockDetails,
): BlockCardSummary {
  const parameterSummary = buildParameterLines(node.blockTypeId, node.parameters, details);

  return {
    shortDisplayName: toShortBlockName(node.displayName, node.blockTypeId),
    parameterRows: parameterSummary.rows,
    parameterOverflowCount: parameterSummary.overflowCount,
  };
}
