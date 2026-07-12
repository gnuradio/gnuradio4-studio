import { z } from 'zod';
import {
  GRAPH_DOCUMENT_FORMAT,
  GRAPH_DOCUMENT_VERSION,
  type GraphDocument,
} from './types';
import { normalizeStudioLayoutSpec } from './studio-layout';
import type {
  StudioControlPanelSpec,
  StudioControlWidgetSpec,
  StudioDataPanelSpec,
  StudioLayoutNode,
  StudioLayoutSpec,
  StudioPanelSpec,
} from './studio-workspace';
import type { ExpressionBinding } from '../../variables/model/types';

const studioPlotPaletteSchema = z.union([
  z.object({
    kind: z.literal('builtin'),
    id: z.string().min(1),
  }),
  z.object({
    kind: z.literal('studio'),
    id: z.string().min(1),
  }),
  z.object({
    kind: z.literal('custom'),
    colors: z.array(z.string().min(1)).min(1),
  }),
]);

const studioPlotStyleConfigSchema = z.object({
  assignmentMode: z.literal('byIndex').optional(),
  palette: studioPlotPaletteSchema.optional(),
});

const jsonPrimitiveSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]);

const studioControlWidgetBindingSchema = z.union([
  z.object({
    kind: z.literal('parameter'),
    nodeId: z.string().min(1),
    parameterName: z.string().min(1),
  }),
  z.object({
    kind: z.literal('variable'),
    variableName: z.string().min(1),
  }),
]);

const studioVariableBindingSchema: z.ZodType<ExpressionBinding> = z.union([
  z.object({
    kind: z.literal('literal'),
    value: jsonPrimitiveSchema,
  }),
  z.object({
    kind: z.literal('expression'),
    expr: z.string(),
  }),
]) as z.ZodType<ExpressionBinding>;

const legacyGraphParameterValueSchema = z
  .object({
    kind: z.literal('expression'),
    value: z.string(),
  })
  .transform((input) => ({
    kind: 'literal' as const,
    value: input.value,
  }));

const graphParameterValueSchema: z.ZodType<ExpressionBinding> = z.union([
  z.object({
    kind: z.literal('literal'),
    value: jsonPrimitiveSchema,
  }),
  z.object({
    kind: z.literal('expression'),
    expr: z.string(),
  }),
  legacyGraphParameterValueSchema,
]) as z.ZodType<ExpressionBinding>;

const studioControlWidgetSpecSchema: z.ZodType<StudioControlWidgetSpec> = z.object({
  id: z.string().min(1),
  kind: z.literal('parameter'),
  binding: studioControlWidgetBindingSchema,
  label: z.string().optional(),
  inputKind: z.enum(['text', 'number', 'slider', 'boolean', 'enum']),
  enumOptions: z.array(z.string().min(1)).optional(),
  enumLabels: z.record(z.string(), z.string()).optional(),
  slider: z
    .object({
      min: z.number().finite().optional(),
      max: z.number().finite().optional(),
      step: z.number().finite().positive().optional(),
    })
    .optional(),
  mode: z.enum(['staged', 'immediate']).optional(),
});

const studioDataPanelSpecSchema: z.ZodType<StudioDataPanelSpec> = z.object({
  id: z.string().min(1),
  nodeId: z.string().min(1),
  kind: z.enum(['series', 'series2d', 'histogram', 'waterfall', 'image', 'audio', 'scalar', 'status']),
  title: z.string().optional(),
  visible: z.boolean(),
  previewOnCanvas: z.boolean(),
  plotStyle: studioPlotStyleConfigSchema.optional(),
});

const studioControlPanelSpecSchema: z.ZodType<StudioControlPanelSpec> = z.object({
  id: z.string().min(1),
  kind: z.literal('control'),
  title: z.string().optional(),
  visible: z.boolean(),
  previewOnCanvas: z.literal(false).optional(),
  widgets: z.array(studioControlWidgetSpecSchema),
  nodeId: z.string().optional(),
});

const studioPanelSpecSchema: z.ZodType<StudioPanelSpec> = z.union([
  studioDataPanelSpecSchema,
  studioControlPanelSpecSchema,
]);

const studioLayoutNodeSchema: z.ZodType<StudioLayoutNode> = z.lazy(() =>
  z.union([
    z.object({
      kind: z.literal('pane'),
      panelId: z.string().min(1),
    }),
    z.object({
      kind: z.literal('split'),
      direction: z.enum(['row', 'column']),
      children: z.array(studioLayoutNodeSchema),
      sizes: z.array(z.number().positive()).optional(),
    }),
  ]) as z.ZodType<StudioLayoutNode>,
);

const studioLayoutSpecSchema: z.ZodType<StudioLayoutSpec> = z.object({
  version: z.literal(2),
  root: studioLayoutNodeSchema,
  activePanelId: z.string().min(1).optional(),
});

const studioWorkspaceMetadataSchema = z.object({
  panels: z.array(studioPanelSpecSchema),
  variables: z.array(
    z.object({
      id: z.string().min(1),
      name: z.string().min(1),
      binding: studioVariableBindingSchema,
    }),
  ).optional(),
  layout: studioLayoutSpecSchema.optional(),
  plotPalettes: z
    .array(
      z.object({
        id: z.string().min(1),
        colors: z.array(z.string().min(1)).min(1),
      }),
    )
    .optional(),
});

const applicationSpecSchema = z.object({
  mode: z.enum(['in_app', 'new_tab', 'popout', 'external']),
  renderer: z.enum(['react', 'webgl', 'imgui', 'custom']),
  title: z.string().optional(),
});

const graphNodeSchema = z.object({
  id: z.string().min(1),
  blockType: z.string().min(1),
  title: z.string().optional(),
  executionMode: z.enum(['active', 'disabled', 'bypassed']).optional(),
  rotation: z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]).optional(),
  position: z.object({
    x: z.number(),
    y: z.number(),
  }),
  parameters: z.record(z.string(), graphParameterValueSchema).default({}),
});

const graphEdgeEndpointSchema = z.object({
  nodeId: z.string().min(1),
  portId: z.string().optional(),
});

const graphEdgeSchema = z.object({
  id: z.string().min(1),
  source: graphEdgeEndpointSchema,
  target: graphEdgeEndpointSchema,
});

export const graphDocumentSchema = z.object({
  format: z.literal(GRAPH_DOCUMENT_FORMAT),
  version: z.literal(GRAPH_DOCUMENT_VERSION),
  metadata: z.object({
    name: z.string().min(1),
    description: z.string().optional(),
    schedulerId: z.string().optional(),
    studio: studioWorkspaceMetadataSchema.optional(),
    application: applicationSpecSchema.optional(),
  }),
  graph: z.object({
    nodes: z.array(graphNodeSchema),
    edges: z.array(graphEdgeSchema),
  }),
});

function makeIssueMessage(issues: z.ZodIssue[]): string {
  return issues
    .map((issue) => `${issue.path.join('.') || 'root'}: ${issue.message}`)
    .join('; ');
}

export function parseGraphDocument(input: unknown): GraphDocument {
  if (input && typeof input === 'object') {
    const maybeDoc = input as { format?: unknown; version?: unknown };

    if (typeof maybeDoc.format === 'string' && maybeDoc.format !== GRAPH_DOCUMENT_FORMAT) {
      throw new Error(
        `Unsupported graph document format: ${maybeDoc.format}. Expected ${GRAPH_DOCUMENT_FORMAT}.`,
      );
    }

    if (typeof maybeDoc.version === 'number' && maybeDoc.version !== GRAPH_DOCUMENT_VERSION) {
      throw new Error(
        `Unsupported graph document version: ${maybeDoc.version}. Expected version ${GRAPH_DOCUMENT_VERSION}.`,
      );
    }
  }

  const parsed = graphDocumentSchema.safeParse(input);
  if (!parsed.success) {
    throw new Error(`Invalid GraphDocument: ${makeIssueMessage(parsed.error.issues)}`);
  }

  if (!parsed.data.metadata.studio?.layout) {
    return parsed.data;
  }

  const panelIds = parsed.data.metadata.studio.panels.map((panel) => panel.id);
  return {
    ...parsed.data,
    metadata: {
      ...parsed.data.metadata,
      studio: {
        ...parsed.data.metadata.studio,
        layout: normalizeStudioLayoutSpec(parsed.data.metadata.studio.layout, panelIds),
      },
    },
  };
}
