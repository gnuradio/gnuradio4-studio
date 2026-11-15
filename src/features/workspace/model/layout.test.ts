import { describe, expect, it } from 'vitest';
import {
  applySplitDropToLayout,
  applySplitSizesToLayout,
  applySplitResizeToLayout,
  collectLayoutPaneIds,
  normalizeStudioLayoutSpec,
} from '../../graph-document/model/studio-layout';
import {
  buildDefaultStudioLayout,
  buildEffectiveRenderedStudioLayout,
  buildEffectiveStudioLayout,
  orderPanelEntriesForLayout,
} from './layout';

describe('workspace layout model (split tree)', () => {
  it('builds a deterministic default split-tree layout from panel IDs', () => {
    const layout = buildDefaultStudioLayout([
      {
        id: 'panel-a',
        nodeId: 'node-a',
        kind: 'series',
        visible: true,
        previewOnCanvas: false,
      },
      {
        id: 'panel-b',
        nodeId: 'node-b',
        kind: 'image',
        visible: true,
        previewOnCanvas: false,
      },
    ]);

    expect(layout).toEqual({
      version: 2,
      root: {
        kind: 'split',
        direction: 'column',
        children: [
          { kind: 'pane', panelId: 'panel-a' },
          { kind: 'pane', panelId: 'panel-b' },
        ],
      },
      activePanelId: 'panel-a',
    });
  });

  it('orders entries by split-tree pane traversal and appends unreferenced entries', () => {
    const entries = [
      { panel: { id: 'panel-b' } },
      { panel: { id: 'panel-c' } },
      { panel: { id: 'panel-a' } },
    ];
    const ordered = orderPanelEntriesForLayout(entries, {
      version: 2,
      root: {
        kind: 'split',
        direction: 'column',
        children: [
          { kind: 'pane', panelId: 'panel-a' },
          { kind: 'pane', panelId: 'panel-b' },
        ],
      },
      activePanelId: 'panel-a',
    });

    expect(ordered.map((entry) => entry.panel.id)).toEqual(['panel-a', 'panel-b', 'panel-c']);
  });

  it('normalizes split nodes by collapsing single-child and dropping mismatched sizes', () => {
    const normalized = normalizeStudioLayoutSpec({
      version: 2,
      root: {
        kind: 'split',
        direction: 'row',
        children: [
          {
            kind: 'split',
            direction: 'column',
            children: [{ kind: 'pane', panelId: 'panel-a' }],
            sizes: [5],
          },
          {
            kind: 'split',
            direction: 'column',
            children: [
              { kind: 'pane', panelId: 'panel-b' },
              { kind: 'pane', panelId: 'panel-c' },
            ],
            sizes: [1],
          },
        ],
        sizes: [1, 2],
      },
      activePanelId: 'panel-c',
    });

    expect(normalized).toEqual({
      version: 2,
      root: {
        kind: 'split',
        direction: 'row',
        children: [
          { kind: 'pane', panelId: 'panel-a' },
          {
            kind: 'split',
            direction: 'column',
            children: [
              { kind: 'pane', panelId: 'panel-b' },
              { kind: 'pane', panelId: 'panel-c' },
            ],
          },
        ],
        sizes: [1, 2],
      },
      activePanelId: 'panel-c',
    });
  });

  it('prunes stale panes from saved split tree and appends missing panels deterministically', () => {
    const layout = buildEffectiveStudioLayout(
      {
        version: 2,
        root: {
          kind: 'split',
          direction: 'column',
          children: [{ kind: 'pane', panelId: 'panel-z' }],
        },
        activePanelId: 'panel-z',
      },
      [
        {
          id: 'panel-a',
          nodeId: 'node-a',
          kind: 'series',
          visible: true,
          previewOnCanvas: false,
        },
        {
          id: 'panel-b',
          nodeId: 'node-b',
          kind: 'audio',
          visible: true,
          previewOnCanvas: false,
        },
      ],
    );

    expect(layout).toEqual({
      version: 2,
      root: {
        kind: 'split',
        direction: 'column',
        children: [
          { kind: 'pane', panelId: 'panel-a' },
          { kind: 'pane', panelId: 'panel-b' },
        ],
      },
      activePanelId: 'panel-a',
    });
  });

  it('keeps saved layout panes when no valid panel list is provided', () => {
    const layout = normalizeStudioLayoutSpec({
      version: 2,
      root: {
        kind: 'split',
        direction: 'column',
        children: [{ kind: 'pane', panelId: 'panel-z' }],
      },
      activePanelId: 'panel-z',
    });

    expect(layout).toEqual({
      version: 2,
      root: { kind: 'pane', panelId: 'panel-z' },
      activePanelId: 'panel-z',
    });
  });

  it('excludes empty control panels from rendered layouts', () => {
    const layout = buildEffectiveRenderedStudioLayout(
      {
        version: 2,
        root: {
          kind: 'split',
          direction: 'column',
          children: [
            { kind: 'pane', panelId: 'panel-a' },
            { kind: 'pane', panelId: 'controls-empty' },
            { kind: 'pane', panelId: 'controls-assigned' },
          ],
        },
        activePanelId: 'controls-empty',
      },
      [
        {
          id: 'panel-a',
          nodeId: 'node-a',
          kind: 'series',
          visible: true,
          previewOnCanvas: false,
        },
        {
          id: 'controls-empty',
          kind: 'control',
          title: 'Controls',
          visible: true,
          widgets: [],
        },
        {
          id: 'controls-assigned',
          kind: 'control',
          title: 'Assigned Controls',
          visible: true,
          widgets: [
            {
              id: 'widget-a',
              kind: 'parameter',
              label: 'Gain',
              binding: { kind: 'variable', variableName: 'gain' },
              inputKind: 'number',
            },
          ],
        },
      ],
    );

    expect(collectLayoutPaneIds(layout.root)).toEqual(['panel-a', 'controls-assigned']);
    expect(layout.activePanelId).toBe('panel-a');
  });

  it('applies left/right split drop around a target pane deterministically', () => {
    const initial = {
      version: 2 as const,
      root: {
        kind: 'split' as const,
        direction: 'column' as const,
        children: [
          { kind: 'pane' as const, panelId: 'panel-a' },
          { kind: 'pane' as const, panelId: 'panel-b' },
        ],
      },
      activePanelId: 'panel-a',
    };

    const next = applySplitDropToLayout(initial, 'panel-a', 'panel-b', 'right', ['panel-a', 'panel-b']);
    expect(next).toEqual({
      version: 2,
      root: {
        kind: 'split',
        direction: 'row',
        children: [
          { kind: 'pane', panelId: 'panel-b' },
          { kind: 'pane', panelId: 'panel-a' },
        ],
      },
      activePanelId: 'panel-a',
    });
  });

  it('ignores self-drop and preserves tree', () => {
    const initial = {
      version: 2 as const,
      root: { kind: 'pane' as const, panelId: 'panel-a' },
      activePanelId: 'panel-a',
    };

    expect(applySplitDropToLayout(initial, 'panel-a', 'panel-a', 'bottom')).toEqual(initial);
  });

  it('moves siblings within the same split deterministically', () => {
    const initial = {
      version: 2 as const,
      root: {
        kind: 'split' as const,
        direction: 'row' as const,
        children: [
          { kind: 'pane' as const, panelId: 'panel-a' },
          { kind: 'pane' as const, panelId: 'panel-b' },
          { kind: 'pane' as const, panelId: 'panel-c' },
        ],
      },
      activePanelId: 'panel-a',
    };

    const next = applySplitDropToLayout(initial, 'panel-a', 'panel-b', 'right', ['panel-a', 'panel-b', 'panel-c']);
    expect(next.root).toEqual({
      kind: 'split',
      direction: 'row',
      children: [
        {
          kind: 'split',
          direction: 'row',
          children: [
            { kind: 'pane', panelId: 'panel-b' },
            { kind: 'pane', panelId: 'panel-a' },
          ],
          sizes: undefined,
        },
        { kind: 'pane', panelId: 'panel-c' },
      ],
      sizes: undefined,
    });
  });

  it('keeps unrelated siblings when removal collapses old parent split', () => {
    const initial = {
      version: 2 as const,
      root: {
        kind: 'split' as const,
        direction: 'row' as const,
        children: [
          {
            kind: 'split' as const,
            direction: 'column' as const,
            children: [
              { kind: 'pane' as const, panelId: 'panel-a' },
              { kind: 'pane' as const, panelId: 'panel-x' },
            ],
          },
          { kind: 'pane' as const, panelId: 'panel-b' },
        ],
      },
      activePanelId: 'panel-a',
    };

    const next = applySplitDropToLayout(initial, 'panel-a', 'panel-b', 'left', ['panel-a', 'panel-b', 'panel-x']);
    expect(new Set(collectLayoutPaneIds(next.root))).toEqual(new Set(['panel-a', 'panel-b', 'panel-x']));
    expect(next.root).toEqual({
      kind: 'split',
      direction: 'row',
      children: [
        { kind: 'pane', panelId: 'panel-x' },
        {
          kind: 'split',
          direction: 'row',
          children: [
            { kind: 'pane', panelId: 'panel-a' },
            { kind: 'pane', panelId: 'panel-b' },
          ],
          sizes: undefined,
        },
      ],
      sizes: undefined,
    });
  });

  it('inserts around nested target pane without losing its subtree', () => {
    const initial = {
      version: 2 as const,
      root: {
        kind: 'split' as const,
        direction: 'column' as const,
        children: [
          { kind: 'pane' as const, panelId: 'panel-a' },
          {
            kind: 'split' as const,
            direction: 'row' as const,
            children: [
              { kind: 'pane' as const, panelId: 'panel-b' },
              { kind: 'pane' as const, panelId: 'panel-c' },
            ],
          },
        ],
      },
      activePanelId: 'panel-a',
    };

    const next = applySplitDropToLayout(initial, 'panel-a', 'panel-c', 'bottom', ['panel-a', 'panel-b', 'panel-c']);
    expect(new Set(collectLayoutPaneIds(next.root))).toEqual(new Set(['panel-a', 'panel-b', 'panel-c']));
    expect(next.root).toEqual({
      kind: 'split',
      direction: 'row',
      children: [
        { kind: 'pane', panelId: 'panel-b' },
        {
          kind: 'split',
          direction: 'column',
          children: [
            { kind: 'pane', panelId: 'panel-c' },
            { kind: 'pane', panelId: 'panel-a' },
          ],
        },
      ],
    });
  });

  it('does not duplicate the dragged pane after drop', () => {
    const initial = {
      version: 2 as const,
      root: {
        kind: 'split' as const,
        direction: 'column' as const,
        children: [
          { kind: 'pane' as const, panelId: 'panel-a' },
          { kind: 'pane' as const, panelId: 'panel-b' },
          { kind: 'pane' as const, panelId: 'panel-b' },
        ],
      },
      activePanelId: 'panel-a',
    };

    const next = applySplitDropToLayout(initial, 'panel-a', 'panel-b', 'right', ['panel-a', 'panel-b']);
    const orderedIds = orderPanelEntriesForLayout([{ panel: { id: 'panel-a' } }, { panel: { id: 'panel-b' } }], next).map(
      (entry) => entry.panel.id,
    );
    expect(orderedIds).toEqual(['panel-b', 'panel-a', 'panel-b']);
    expect(orderedIds.filter((id) => id === 'panel-a')).toHaveLength(1);
    expect(next.root).toEqual({
      kind: 'split',
      direction: 'column',
      children: [
        {
          kind: 'split',
          direction: 'row',
          children: [
            { kind: 'pane', panelId: 'panel-b' },
            { kind: 'pane', panelId: 'panel-a' },
          ],
        },
        { kind: 'pane', panelId: 'panel-b' },
      ],
    });
  });

  it('normalizes mutated trees to a minimal structure', () => {
    const initial = {
      version: 2 as const,
      root: {
        kind: 'split' as const,
        direction: 'row' as const,
        children: [
          {
            kind: 'split' as const,
            direction: 'column' as const,
            children: [{ kind: 'pane' as const, panelId: 'panel-a' }],
          },
          { kind: 'pane' as const, panelId: 'panel-b' },
        ],
      },
      activePanelId: 'panel-a',
    };

    const next = applySplitDropToLayout(initial, 'panel-a', 'panel-b', 'top', ['panel-a', 'panel-b']);
    expect(next.root).toEqual({
      kind: 'split',
      direction: 'column',
      children: [
        { kind: 'pane', panelId: 'panel-a' },
        { kind: 'pane', panelId: 'panel-b' },
      ],
    });
  });

  it('resizes adjacent children in a row split and persists sizes', () => {
    const initial = {
      version: 2 as const,
      root: {
        kind: 'split' as const,
        direction: 'row' as const,
        children: [
          { kind: 'pane' as const, panelId: 'panel-a' },
          { kind: 'pane' as const, panelId: 'panel-b' },
          { kind: 'pane' as const, panelId: 'panel-c' },
        ],
      },
      activePanelId: 'panel-a',
    };

    const next = applySplitResizeToLayout(initial, [], 0, 0.5, ['panel-a', 'panel-b', 'panel-c']);
    expect(next.root).toEqual({
      kind: 'split',
      direction: 'row',
      children: [
        { kind: 'pane', panelId: 'panel-a' },
        { kind: 'pane', panelId: 'panel-b' },
        { kind: 'pane', panelId: 'panel-c' },
      ],
      sizes: [1.5, 0.5, 1],
    });
  });

  it('resizes nested column split by path', () => {
    const initial = {
      version: 2 as const,
      root: {
        kind: 'split' as const,
        direction: 'row' as const,
        children: [
          { kind: 'pane' as const, panelId: 'panel-a' },
          {
            kind: 'split' as const,
            direction: 'column' as const,
            children: [
              { kind: 'pane' as const, panelId: 'panel-b' },
              { kind: 'pane' as const, panelId: 'panel-c' },
            ],
          },
        ],
      },
      activePanelId: 'panel-b',
    };

    const next = applySplitResizeToLayout(initial, [1], 0, -0.25, ['panel-a', 'panel-b', 'panel-c']);
    expect(next.root).toEqual({
      kind: 'split',
      direction: 'row',
      children: [
        { kind: 'pane', panelId: 'panel-a' },
        {
          kind: 'split',
          direction: 'column',
          children: [
            { kind: 'pane', panelId: 'panel-b' },
            { kind: 'pane', panelId: 'panel-c' },
          ],
          sizes: [0.75, 1.25],
        },
      ],
    });
  });

  it('clamps resize to avoid collapsing panes and ignores invalid paths', () => {
    const initial = {
      version: 2 as const,
      root: {
        kind: 'split' as const,
        direction: 'column' as const,
        children: [
          { kind: 'pane' as const, panelId: 'panel-a' },
          { kind: 'pane' as const, panelId: 'panel-b' },
        ],
        sizes: [0.2, 1.8],
      },
      activePanelId: 'panel-a',
    };

    const clamped = applySplitResizeToLayout(initial, [], 0, -5, ['panel-a', 'panel-b']);
    expect(clamped.root).toEqual({
      kind: 'split',
      direction: 'column',
      children: [
        { kind: 'pane', panelId: 'panel-a' },
        { kind: 'pane', panelId: 'panel-b' },
      ],
      sizes: [0.1, 1.9],
    });

    const unchanged = applySplitResizeToLayout(initial, [3], 0, 0.4, ['panel-a', 'panel-b']);
    expect(unchanged).toEqual(initial);
  });

  it('applies explicit split sizes by path for persisted panel-group layouts', () => {
    const initial = {
      version: 2 as const,
      root: {
        kind: 'split' as const,
        direction: 'row' as const,
        children: [
          { kind: 'pane' as const, panelId: 'panel-a' },
          {
            kind: 'split' as const,
            direction: 'column' as const,
            children: [
              { kind: 'pane' as const, panelId: 'panel-b' },
              { kind: 'pane' as const, panelId: 'panel-c' },
            ],
          },
        ],
      },
      activePanelId: 'panel-c',
    };

    const next = applySplitSizesToLayout(initial, [1], [60, 40], ['panel-a', 'panel-b', 'panel-c']);
    expect(next.root).toEqual({
      kind: 'split',
      direction: 'row',
      children: [
        { kind: 'pane', panelId: 'panel-a' },
        {
          kind: 'split',
          direction: 'column',
          children: [
            { kind: 'pane', panelId: 'panel-b' },
            { kind: 'pane', panelId: 'panel-c' },
          ],
          sizes: [60, 40],
        },
      ],
    });
  });

  it('ignores invalid split-size updates', () => {
    const initial = {
      version: 2 as const,
      root: {
        kind: 'split' as const,
        direction: 'column' as const,
        children: [
          { kind: 'pane' as const, panelId: 'panel-a' },
          { kind: 'pane' as const, panelId: 'panel-b' },
        ],
        sizes: [1, 1],
      },
      activePanelId: 'panel-a',
    };

    expect(applySplitSizesToLayout(initial, [], [100], ['panel-a', 'panel-b'])).toEqual(initial);
    expect(applySplitSizesToLayout(initial, [], [70, -30], ['panel-a', 'panel-b'])).toEqual(initial);
    expect(applySplitSizesToLayout(initial, [2], [50, 50], ['panel-a', 'panel-b'])).toEqual(initial);
  });

  it('keeps layout unchanged when split sizes are identical', () => {
    const initial = {
      version: 2 as const,
      root: {
        kind: 'split' as const,
        direction: 'row' as const,
        children: [
          { kind: 'pane' as const, panelId: 'panel-a' },
          { kind: 'pane' as const, panelId: 'panel-b' },
        ],
        sizes: [55, 45],
      },
      activePanelId: 'panel-a',
    };

    const next = applySplitSizesToLayout(initial, [], [55, 45], ['panel-a', 'panel-b']);
    expect(next).toBe(initial);
  });

  it('preserves an untouched branch and ancestor proportions when another panel is moved', () => {
    const left = { kind: 'split' as const, direction: 'row' as const, sizes: [3, 1], children: [
      { kind: 'pane' as const, panelId: 'a' }, { kind: 'pane' as const, panelId: 'b' },
    ] };
    const initial = { version: 2 as const, root: {
      kind: 'split' as const, direction: 'column' as const, sizes: [2, 1], children: [left,
        { kind: 'split' as const, direction: 'row' as const, sizes: [1, 2], children: [
          { kind: 'pane' as const, panelId: 'c' }, { kind: 'pane' as const, panelId: 'd' },
        ] },
      ],
    } };
    const next = applySplitDropToLayout(initial, 'd', 'c', 'bottom', ['a', 'b', 'c', 'd']);
    expect(next.root.kind).toBe('split');
    if (next.root.kind !== 'split') return;
    expect(next.root.children[0]).toEqual(left);
    expect(next.root.sizes).toEqual([2, 1]);
  });

  it('does not rewrite equivalent split proportions as percentages', () => {
    const initial = { version: 2 as const, root: {
      kind: 'split' as const, direction: 'row' as const, sizes: [1, 2], children: [
        { kind: 'pane' as const, panelId: 'a' }, { kind: 'pane' as const, panelId: 'b' },
      ],
    } };
    expect(applySplitSizesToLayout(initial, [], [100 / 3, 200 / 3], ['a', 'b'])).toBe(initial);
  });
});
