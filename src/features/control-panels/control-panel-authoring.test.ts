import { describe, expect, it } from 'vitest';
import type { BlockParameterMeta } from '../../lib/api/block-details';
import {
  addControlWidgetToPanels,
  addEmptyControlPanelToPanels,
  buildControlWidgetSpec,
  getControlWidgetTargetLabel,
  getCompatibleControlWidgetInputKinds,
  inferControlWidgetInputKind,
  moveControlWidgetInPanel,
  moveControlWidgetToPanel,
  removeControlWidgetFromPanel,
  removeControlWidgetsBoundToVariable,
  renameControlPanelTitle,
  updateControlWidgetInputKind,
  updateControlWidgetLabel,
  updateControlWidgetSliderConfig,
  updateControlPanelWidgetLayout,
} from './control-panel-authoring';
import type { StudioControlPanelSpec, StudioPanelSpec } from '../graph-document/model/studio-workspace';
import { collectLayoutPaneIds } from '../graph-document/model/studio-layout';

function makeParameter(overrides: Partial<BlockParameterMeta> = {}): BlockParameterMeta {
  return {
    name: 'gain',
    label: 'gain',
    mutable: true,
    readOnly: false,
    valueKind: 'scalar',
    valueType: 'float',
    ...overrides,
  };
}

describe('control panel authoring', () => {
  it('preserves a dragged arrangement when adding, moving, and removing controls', () => {
    const makeWidget = (name: string) => buildControlWidgetSpec({ variableName: name, initialValue: 1 });
    const widgets = ['a', 'b', 'c'].map(makeWidget);
    const panel: StudioControlPanelSpec = { id: 'controls', kind: 'control', visible: true, widgets };
    const empty: StudioControlPanelSpec = { id: 'other', kind: 'control', visible: true, widgets: [] };
    const root = {
      kind: 'split' as const, direction: 'row' as const, sizes: [2, 1],
      children: [
        { kind: 'pane' as const, panelId: widgets[1].id },
        { kind: 'split' as const, direction: 'column' as const, children: [
          { kind: 'pane' as const, panelId: widgets[0].id },
          { kind: 'pane' as const, panelId: widgets[2].id },
        ] },
      ],
    };
    const arranged = updateControlPanelWidgetLayout([panel, empty], panel.id, { version: 2, root });
    const added = addControlWidgetToPanels(arranged, { widget: makeWidget('d'), targetPanelId: panel.id });
    expect((added[0] as StudioControlPanelSpec).widgetLayout?.root).toMatchObject({ children: [root, { panelId: makeWidget('d').id }] });
    const moved = moveControlWidgetToPanel(added, { sourcePanelId: panel.id, targetPanelId: empty.id, widgetId: widgets[0].id });
    expect(collectLayoutPaneIds((moved[0] as StudioControlPanelSpec).widgetLayout!.root)).toEqual([widgets[1].id, widgets[2].id, makeWidget('d').id]);
    expect((moved[1] as StudioControlPanelSpec).widgets).toEqual([widgets[0]]);
    const removed = removeControlWidgetsBoundToVariable(moved, 'c');
    expect(collectLayoutPaneIds((removed[0] as StudioControlPanelSpec).widgetLayout!.root)).toEqual([widgets[1].id, makeWidget('d').id]);
    const last = removeControlWidgetFromPanel(removed, panel.id, widgets[1].id);
    expect(collectLayoutPaneIds((last[0] as StudioControlPanelSpec).widgetLayout!.root)).toEqual([makeWidget('d').id]);
  });

  it('moves controls in visual order after they have been tiled', () => {
    const widgets = ['a', 'b', 'c'].map((variableName) => buildControlWidgetSpec({ variableName }));
    const panel: StudioControlPanelSpec = {
      id: 'controls', kind: 'control', visible: true, widgets,
      widgetLayout: { version: 2, root: { kind: 'split', direction: 'row', children: [
        { kind: 'pane', panelId: widgets[2].id },
        { kind: 'pane', panelId: widgets[0].id },
        { kind: 'pane', panelId: widgets[1].id },
      ] } },
    };
    const moved = moveControlWidgetInPanel([panel], panel.id, widgets[0].id, 'up');
    expect(collectLayoutPaneIds((moved[0] as StudioControlPanelSpec).widgetLayout!.root)).toEqual([widgets[0].id, widgets[2].id, widgets[1].id]);
  });

  it('infers control widget kinds from parameter metadata', () => {
    expect(inferControlWidgetInputKind(makeParameter({ valueType: 'bool' }))).toBe('boolean');
    expect(inferControlWidgetInputKind(makeParameter({ valueType: 'float', uiHint: 'slider' }))).toBe('slider');
    expect(
      inferControlWidgetInputKind(
        makeParameter({
          valueKind: 'enum',
          enumChoices: ['a', 'b'],
        }),
      ),
    ).toBe('enum');
    expect(inferControlWidgetInputKind(makeParameter({ valueType: 'float' }))).toBe('number');
    expect(inferControlWidgetInputKind(makeParameter({ valueType: 'string' }))).toBe('text');
  });

  it('creates an empty control panel', () => {
    const created = addEmptyControlPanelToPanels([], 'Live Controls');

    expect(created.panelId).toBe('control-panel');
    expect(created.panels).toEqual([
      {
        id: 'control-panel',
        kind: 'control',
        title: 'Live Controls',
        visible: true,
        previewOnCanvas: false,
        widgets: [],
      },
    ]);
  });

  it('builds a control widget bound directly to node and parameter', () => {
    expect(buildControlWidgetSpec({ nodeId: 'node-a', parameter: makeParameter() })).toEqual({
      id: 'control-widget:node-a:gain',
      kind: 'parameter',
      binding: {
        kind: 'parameter',
        nodeId: 'node-a',
        parameterName: 'gain',
      },
      label: 'gain',
      inputKind: 'number',
    });
  });

  it('builds a control widget bound directly to a variable', () => {
    expect(
      buildControlWidgetSpec({
        variableName: 'center_freq',
        label: 'Center Frequency',
        inputKind: 'number',
        initialValue: 100,
      }),
    ).toEqual({
      id: 'control-widget:variable:center_freq',
      kind: 'parameter',
      binding: {
        kind: 'variable',
        variableName: 'center_freq',
      },
      label: 'Center Frequency',
      inputKind: 'number',
    });
    expect(getControlWidgetTargetLabel(buildControlWidgetSpec({
      variableName: 'center_freq',
      inputKind: 'number',
      initialValue: 100,
    }))).toBe('Variable');
  });

  it('appends a widget to an existing control panel or creates one', () => {
    const widget = buildControlWidgetSpec({ nodeId: 'node-a', parameter: makeParameter() });
    const panels: StudioPanelSpec[] = [
      {
        id: 'panel-a',
        nodeId: 'node-a',
        kind: 'series',
        visible: true,
        previewOnCanvas: false,
      },
      {
        id: 'control-panel-1',
        kind: 'control',
        title: 'Controls',
        visible: true,
        widgets: [],
      },
    ];

    const nextPanels = addControlWidgetToPanels(panels, {
      widget,
      targetPanelId: 'control-panel-1',
    });

    expect(nextPanels).toHaveLength(2);
    expect(nextPanels[1]).toMatchObject({
      id: 'control-panel-1',
      kind: 'control',
      widgets: [widget],
    });

    const createdPanels = addControlWidgetToPanels([panels[0]], {
      widget,
    });

    expect(createdPanels).toHaveLength(2);
    expect(createdPanels[1]).toMatchObject({
      kind: 'control',
      title: 'Controls',
      widgets: [widget],
    });
  });

  it('supports editing and cleanup of control panels and widgets', () => {
    const widgetA = buildControlWidgetSpec({ nodeId: 'node-a', parameter: makeParameter({ name: 'gain' }) });
    const widgetB = buildControlWidgetSpec({ nodeId: 'node-b', parameter: makeParameter({ name: 'mix' }) });
    const panels: StudioPanelSpec[] = [
      {
        id: 'control-panel-1',
        kind: 'control',
        title: 'Controls',
        visible: true,
        widgets: [widgetA, widgetB],
      },
    ];

    const renamedPanels = renameControlPanelTitle(panels, 'control-panel-1', 'Live Controls');
    expect(renamedPanels[0]).toMatchObject({ title: 'Live Controls' });

    const relabeledPanels = updateControlWidgetLabel(panels, 'control-panel-1', widgetA.id, 'Gain Amount');
    expect(relabeledPanels[0]).toMatchObject({
      widgets: [{ ...widgetA, label: 'Gain Amount' }, widgetB],
    });

    const retypedPanels = updateControlWidgetInputKind(panels, 'control-panel-1', widgetA.id, 'text');
    expect(retypedPanels[0]).toMatchObject({
      widgets: [{ ...widgetA, inputKind: 'text' }, widgetB],
    });

    const sliderPanels = updateControlWidgetSliderConfig(panels, 'control-panel-1', widgetA.id, {
      min: 0,
      max: 1,
      step: 0.05,
    });
    expect(sliderPanels[0]).toMatchObject({
      widgets: [{ ...widgetA, slider: { min: 0, max: 1, step: 0.05 } }, widgetB],
    });

    const reorderedPanels = moveControlWidgetInPanel(panels, 'control-panel-1', widgetB.id, 'up');
    expect(reorderedPanels[0]?.kind).toBe('control');
    expect((reorderedPanels[0] as Extract<StudioPanelSpec, { kind: 'control' }>).widgets[0]).toEqual(widgetB);

    const removedPanels = removeControlWidgetFromPanel(panels, 'control-panel-1', widgetA.id);
    expect((removedPanels[0] as Extract<StudioPanelSpec, { kind: 'control' }>).widgets).toEqual([widgetB]);

    const movedPanels = moveControlWidgetToPanel(
      [
        {
          id: 'control-panel-1',
          kind: 'control',
          title: 'Controls',
          visible: true,
          widgets: [widgetA],
        },
        {
          id: 'control-panel-2',
          kind: 'control',
          title: 'Secondary',
          visible: true,
          widgets: [widgetB],
        },
      ],
      {
        sourcePanelId: 'control-panel-1',
        targetPanelId: 'control-panel-2',
        widgetId: widgetA.id,
      },
    );
    expect((movedPanels[0] as Extract<StudioPanelSpec, { kind: 'control' }>).widgets).toEqual([]);
    expect((movedPanels[1] as Extract<StudioPanelSpec, { kind: 'control' }>).widgets).toEqual([widgetB, widgetA]);

    const variableWidget = buildControlWidgetSpec({
      variableName: 'center_freq',
      label: 'Center',
      inputKind: 'number',
      initialValue: 100,
    });
    const scrubbedPanels = removeControlWidgetsBoundToVariable(
      [
        {
          id: 'control-panel-1',
          kind: 'control',
          title: 'Controls',
          visible: true,
          widgets: [widgetA, variableWidget],
        },
      ],
      'center_freq',
    );
    expect((scrubbedPanels[0] as Extract<StudioPanelSpec, { kind: 'control' }>).widgets).toEqual([widgetA]);

    expect(getCompatibleControlWidgetInputKinds(makeParameter({ valueType: 'bool' }))).toEqual(['text', 'boolean']);
    expect(getCompatibleControlWidgetInputKinds(makeParameter({ valueType: 'float' }))).toEqual(['text', 'number', 'slider']);
  });
});

describe('collection control widgets', () => {
  it.each(['float64_vector', 'bool_vector', 'std::vector<double>', 'gr::Tensor<float>'])
    ('uses list text rather than scalar controls for %s', (valueType) => {
      const parameter = makeParameter({ valueType, uiHint: 'slider' });
      expect(inferControlWidgetInputKind(parameter)).toBe('text');
      expect(getCompatibleControlWidgetInputKinds(parameter)).toEqual(['text']);
    });

  it('honors an explicit collection flag', () => {
    expect(inferControlWidgetInputKind(makeParameter({ isCollectionLike: true }))).toBe('text');
  });
});
