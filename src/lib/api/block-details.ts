import { ApiClientError, jsonRequest } from './client';
import {
  blockDetailsDtoSchema,
  blockDetailsResponseSchema,
  type BlockDetailsDto,
  type ParameterMetaDto,
  type PortMetaDto,
} from '../dto/block-details';
import { isReadOnlyRuntimeMutability } from '../utils/parameter-groups';

export type BlockParameterMeta = {
  name: string;
  label: string;
  description?: string;
  defaultValue?: string;
  mutable: boolean;
  readOnly: boolean;
  valueType?: string;
  valueKind: 'scalar' | 'enum';
  enumOptions?: string[];
  enumChoices?: string[];
  enumType?: string;
  enumLabels?: Record<string, string>;
  enumSource?: string;
  uiHint?: string;
  allowCustomValue?: boolean;
  isCollectionLike?: boolean;
};

export function isCollectionParameter(parameter: Pick<BlockParameterMeta, 'valueType' | 'isCollectionLike'>): boolean {
  return Boolean(parameter.isCollectionLike || /(?:vector|tensor|collection|array|list)/i.test(parameter.valueType ?? ''));
}

export type BlockPortMeta = {
  name: string;
  direction: 'input' | 'output' | 'unknown';
  cardinalityKind: 'fixed' | 'dynamic';
  isExplicitDynamicCollection?: boolean;
  currentPortCount?: number;
  renderPortCount?: number;
  minPortCount?: number;
  maxPortCount?: number;
  sizeParameter?: string;
  handleNameTemplate?: string;
  domain?: string;
  valueType?: string;
  isOptional?: boolean;
  optional?: boolean;
  description?: string;
};

export type BlockDetails = {
  blockTypeId: string;
  displayName: string;
  description?: string;
  parameters: BlockParameterMeta[];
  inputPorts: BlockPortMeta[];
  outputPorts: BlockPortMeta[];
};

function toText(value: string | number | boolean | null | undefined): string | undefined {
  return value === undefined || value === null ? undefined : String(value);
}

function normalizeParameter(param: ParameterMetaDto): BlockParameterMeta {
  const readOnly = isReadOnlyRuntimeMutability(param.runtime_mutability);
  const valueType = param.type;
  const isCollectionLike = isCollectionParameter({ valueType });

  return {
    name: param.name,
    label: param.name,
    description: param.summary,
    defaultValue: toText(param.default),
    mutable: !readOnly,
    readOnly,
    valueType,
    valueKind: param.value_kind === 'enum' || Boolean(param.enum_choices?.length) ? 'enum' : 'scalar',
    enumOptions: param.enum_choices ?? param.enum_options,
    enumChoices: param.enum_choices,
    enumType: param.enum_type,
    enumLabels: param.enum_labels,
    enumSource: param.enum_source,
    uiHint: param.ui_hint,
    allowCustomValue: param.allow_custom_value,
    isCollectionLike,
  };
}

function normalizePort(port: PortMetaDto, direction: 'input' | 'output'): BlockPortMeta {
  const normalizedDirection =
    port.direction === 'input' || port.direction === 'output' ? port.direction : direction;
  const normalizedCardinality = port.cardinality_kind === 'dynamic' ? 'dynamic' : 'fixed';
  const normalizedMaxPortCount =
    port.max_port_count !== undefined && port.max_port_count >= 0 ? port.max_port_count : undefined;
  const isExplicitDynamicCollection =
    port.cardinality_kind !== undefined ||
    port.current_port_count !== undefined ||
    port.render_port_count !== undefined ||
    port.min_port_count !== undefined ||
    port.max_port_count !== undefined ||
    port.size_parameter !== undefined ||
    port.handle_name_template !== undefined;

  return {
    name: port.name,
    direction: normalizedDirection,
    cardinalityKind: normalizedCardinality,
    isExplicitDynamicCollection,
    currentPortCount: port.current_port_count,
    renderPortCount: port.render_port_count,
    minPortCount: port.min_port_count,
    maxPortCount: normalizedMaxPortCount,
    sizeParameter: port.size_parameter,
    handleNameTemplate: port.handle_name_template,
    valueType: port.type,
    isOptional: port.is_optional,
    optional: port.is_optional,
    description: port.description,
  };
}

function mapBlockDetailsDto(dto: BlockDetailsDto): BlockDetails {
  return {
    blockTypeId: dto.id,
    displayName: dto.name || dto.id,
    description: dto.summary ?? dto.description,
    parameters: (dto.parameters ?? []).map((param) => normalizeParameter(param)),
    inputPorts: (dto.inputs ?? []).map((port) => normalizePort(port, 'input')),
    outputPorts: (dto.outputs ?? []).map((port) => normalizePort(port, 'output')),
  };
}

export async function getBlockDetails(blockTypeId: string): Promise<BlockDetails> {
  const payload = await jsonRequest<unknown>({
    path: `/blocks/${encodeURIComponent(blockTypeId)}`,
    method: 'GET',
  });

  const parsed = blockDetailsResponseSchema.safeParse(payload);
  if (!parsed.success) {
    const schemaIssue = parsed.error.issues
      .map((issue) => `${issue.path.join('.') || 'root'}: ${issue.message}`)
      .join('; ');

    throw new ApiClientError('Block detail response schema mismatch', 'PARSE', undefined, schemaIssue);
  }

  let body: BlockDetailsDto;
  if ('block' in parsed.data) {
    const nestedBlock = blockDetailsDtoSchema.safeParse(parsed.data.block);
    if (!nestedBlock.success) {
      const nestedIssue = nestedBlock.error.issues
        .map((issue) => `${issue.path.join('.') || 'root'}: ${issue.message}`)
        .join('; ');

      throw new ApiClientError('Block detail nested payload schema mismatch', 'PARSE', undefined, nestedIssue);
    }

    body = nestedBlock.data;
  } else {
    body = parsed.data;
  }

  return mapBlockDetailsDto(body);
}
