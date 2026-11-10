import { describe, expect, it } from 'vitest';
import type { BlockDetails } from '../../lib/api/block-details';
import type { EditorGraphNode } from '../graph-editor/model/types';
import {
  resolveControlPanelWidgetBindings,
  type ResolvedControlWidget,
} from './control-panel-binding-resolution';
import type { StudioControlPanelSpec } from '../graph-document/model/studio-workspace';

function makeNode(overrides: Partial<EditorGraphNode> = {}): EditorGraphNode {
  return {
    instanceId: 'node-a',
    blockTypeId: 'gr4.example.Sink',
    displayName: 'Example Sink',
    parameters: {
      gain: { value: '0.5', bindingKind: 'literal' },
    },
    position: { x: 0, y: 0 },
    ...overrides,
  };
}

function makePanel(widgetOverrides: Partial<StudioControlPanelSpec['widgets'][number]> = {}): StudioControlPanelSpec {
  return {
    id: 'panel-control',
    kind: 'control',
    title: 'Controls',
    visible: true,
    widgets: [
      {
        id: 'gain',
        kind: 'parameter',
        binding: {
          kind: 'parameter',
          nodeId: 'node-a',
          parameterName: 'gain',
        },
        label: 'Gain',
        inputKind: 'number',
        ...widgetOverrides,
      },
    ],
  };
}

function makeVariablePanel(widgetOverrides: Partial<StudioControlPanelSpec['widgets'][number]> = {}): StudioControlPanelSpec {
  return {
    id: 'panel-control',
    kind: 'control',
    title: 'Controls',
    visible: true,
    widgets: [
      {
        id: 'variable-center_freq',
        kind: 'parameter',
        binding: {
          kind: 'variable',
          variableName: 'center_freq',
        },
        label: 'Center Frequency',
        inputKind: 'number',
        ...widgetOverrides,
      },
    ],
  };
}

type RuntimeInput = NonNullable<Parameters<typeof resolveControlPanelWidgetBindings>[0]['runtime']>;

function makeRuntime(overrides: Partial<RuntimeInput> = {}): RuntimeInput {
  return {
    sessionId: 'session-a',
    executionState: 'running' as const,
    graphDriftState: 'in-sync' as const,
    ...overrides,
  };
}

function makeBlockDetails(parameterOverrides: Partial<BlockDetails['parameters'][number]> = {}): BlockDetails {
  return {
    blockTypeId: 'gr4.example.Sink',
    displayName: 'Example Sink',
    parameters: [
      {
        name: 'gain',
        label: 'Gain',
        mutable: true,
        readOnly: false,
        valueKind: 'scalar',
        valueType: 'float',
        ...parameterOverrides,
      },
    ],
    inputPorts: [],
    outputPorts: [],
  };
}

function expectState(result: ResolvedControlWidget[], state: ResolvedControlWidget['state']) {
  expect(result[0]?.state).toBe(state);
}

describe('resolveControlPanelWidgetBindings', () => {
  it('marks a valid binding as ready when a linked session is running and in sync', () => {
    const result = resolveControlPanelWidgetBindings({
      panel: makePanel(),
      nodeById: new Map([['node-a', makeNode()]]),
      blockDetailsByType: new Map([['gr4.example.Sink', makeBlockDetails()]]),
      runtime: makeRuntime(),
    });

    expectState(result, 'ready');
    expect(result[0]?.reason).toContain('running and in sync');
  });

  it('marks a missing node as missing_node', () => {
    const result = resolveControlPanelWidgetBindings({
      panel: makePanel(),
      nodeById: new Map(),
      blockDetailsByType: new Map(),
      runtime: makeRuntime(),
    });

    expectState(result, 'missing_node');
    expect(result[0]?.reason).toContain('Node node-a was not found');
  });

  it('marks a missing parameter as missing_parameter', () => {
    const result = resolveControlPanelWidgetBindings({
      panel: makePanel(),
      nodeById: new Map([
        [
          'node-a',
          makeNode({
            parameters: {},
          }),
        ],
      ]),
      blockDetailsByType: new Map(),
      runtime: makeRuntime(),
    });

    expectState(result, 'missing_parameter');
    expect(result[0]?.reason).toContain('Parameter gain was not found');
  });

  it('marks an incompatible widget as incompatible_widget when metadata disagrees', () => {
    const result = resolveControlPanelWidgetBindings({
      panel: makePanel({
        inputKind: 'boolean',
      }),
      nodeById: new Map([['node-a', makeNode()]]),
      blockDetailsByType: new Map([['gr4.example.Sink', makeBlockDetails({ valueType: 'float' })]]),
      runtime: makeRuntime(),
    });

    expectState(result, 'incompatible_widget');
    expect(result[0]?.reason).toContain('not compatible');
  });

  it('allows slider widgets for numeric parameters', () => {
    const result = resolveControlPanelWidgetBindings({
      panel: makePanel({
        inputKind: 'slider',
      }),
      nodeById: new Map([['node-a', makeNode()]]),
      blockDetailsByType: new Map([['gr4.example.Sink', makeBlockDetails({ valueType: 'float' })]]),
      runtime: makeRuntime(),
    });

    expectState(result, 'ready');
  });

  it('uses enum choice metadata when present', () => {
    const result = resolveControlPanelWidgetBindings({
      panel: makePanel({
        inputKind: 'enum',
      }),
      nodeById: new Map([['node-a', makeNode()]]),
      blockDetailsByType: new Map([
        [
          'gr4.example.Sink',
          makeBlockDetails({
            valueKind: 'scalar',
            valueType: 'string',
            enumChoices: ['a', 'b'],
          }),
        ],
      ]),
      runtime: makeRuntime(),
    });

    expectState(result, 'ready');
    expect(result[0]?.enumOptions).toEqual(['a', 'b']);
  });

  it('marks widgets offline when no linked session exists', () => {
    const result = resolveControlPanelWidgetBindings({
      panel: makePanel(),
      nodeById: new Map([['node-a', makeNode()]]),
      blockDetailsByType: new Map([['gr4.example.Sink', makeBlockDetails()]]),
      runtime: makeRuntime({ sessionId: null }),
    });

    expectState(result, 'offline');
    expect(result[0]?.reason).toContain('No linked session');
  });

  it('marks widgets stopped when the linked session exists but is not running', () => {
    const result = resolveControlPanelWidgetBindings({
      panel: makePanel(),
      nodeById: new Map([['node-a', makeNode()]]),
      blockDetailsByType: new Map([['gr4.example.Sink', makeBlockDetails()]]),
      runtime: makeRuntime({ executionState: 'stopped' }),
    });

    expectState(result, 'stopped');
    expect(result[0]?.reason).toContain('is not running');
  });

  it('marks widgets stale when the linked running session is out of sync', () => {
    const result = resolveControlPanelWidgetBindings({
      panel: makePanel(),
      nodeById: new Map([['node-a', makeNode()]]),
      blockDetailsByType: new Map([['gr4.example.Sink', makeBlockDetails()]]),
      runtime: makeRuntime({ graphDriftState: 'out-of-sync' }),
    });

    expectState(result, 'stale');
    expect(result[0]?.reason).toContain('stale relative to the current graph');
  });

  it('resolves variable-target widgets directly', () => {
    const result = resolveControlPanelWidgetBindings({
      panel: makeVariablePanel(),
      nodeById: new Map([['node-a', makeNode()]]),
      blockDetailsByType: new Map(),
      resolvedGraph: {
        variablesByName: {
          center_freq: {
            binding: { kind: 'literal', value: 123 },
            dependencies: [],
            state: 'literal',
            value: 123,
          },
        },
        parametersByNodeId: {},
        diagnostics: [],
      },
      runtime: null,
    });

    expectState(result, 'ready');
    expect(result[0]?.currentValue).toBe('123');
    expect(result[0]?.variableName).toBe('center_freq');
  });

  it('marks missing variable targets as missing_variable', () => {
    const result = resolveControlPanelWidgetBindings({
      panel: makeVariablePanel(),
      nodeById: new Map([['node-a', makeNode()]]),
      blockDetailsByType: new Map(),
      resolvedGraph: {
        variablesByName: {},
        parametersByNodeId: {},
        diagnostics: [],
      },
      runtime: null,
    });

    expectState(result, 'missing_variable');
    expect(result[0]?.reason).toContain('Variable center_freq was not found');
  });
});

describe('collection widget compatibility', () => {
  it.each(['number', 'slider', 'boolean', 'text'] as const)
    ('checks saved %s widgets against collection metadata', (inputKind) => {
      const result = resolveControlPanelWidgetBindings({
        panel: makePanel({ inputKind }),
        nodeById: new Map([['node-a', makeNode()]]),
        blockDetailsByType: new Map([['gr4.example.Sink', makeBlockDetails({ valueType: 'float64_vector' })]]),
        runtime: makeRuntime(),
      });
      expectState(result, inputKind === 'text' ? 'ready' : 'incompatible_widget');
    });
});
