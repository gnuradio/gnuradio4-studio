import { describe, expect, it } from 'vitest';
import { parseGraphDocument } from './schema';
import { editorGraphFromDocument } from './toEditor';
import { graphDocumentFromEditor } from './fromEditor';
import { deriveDefaultStudioPanelsFromNodes } from '../../workspace/model/panel-derivation';
import { mergeSavedAndDerivedStudioPanels } from '../../workspace/model/panel-merge';
import { buildEffectiveRenderedStudioLayout } from '../../workspace/model/layout';
import type { StudioLayoutSpec } from './studio-workspace';
import type { EditorSnapshot } from '../../graph-tabs/store/graphTabsStore';

const examples = import.meta.glob<string>('../../../../examples/studio-blocks-*.gr4s', { query: '?raw', import: 'default', eager: true });

const pane = (panelId: string) => ({ kind: 'pane' as const, panelId });
const layout: StudioLayoutSpec = {
  version: 2,
  root: { kind: 'split', direction: 'column', sizes: [2, 1], children: [
    { kind: 'split', direction: 'row', sizes: [3, 1], children: [pane('studio-panel:a'), pane('studio-panel:b')] },
    { kind: 'split', direction: 'row', sizes: [1, 2], children: [pane('studio-panel:c'), pane('studio-panel:d')] },
  ] },
  activePanelId: 'studio-panel:c',
};
const snapshot = (): EditorSnapshot => ({
  metadata: { name: 'arranged', studioLayout: layout },
  nodes: ['a', 'b', 'c', 'd'].map((instanceId) => ({
    instanceId, blockTypeId: 'gr::studio::StudioSeriesSink<float32>', displayName: instanceId,
    position: { x: 0, y: 0 }, parameters: {},
  })),
  edges: [],
});
function reopen(input: unknown) {
  const editor = editorGraphFromDocument(parseGraphDocument(input));
  const panels = mergeSavedAndDerivedStudioPanels({
    savedPanels: editor.metadata.studioPanels,
    derivedPanels: deriveDefaultStudioPanelsFromNodes(editor.nodes.filter((node) => node.executionMode !== 'disabled')),
  });
  return { editor, panels, layout: buildEffectiveRenderedStudioLayout(editor.metadata.studioLayout, panels) };
}

describe('layout save and reopen', () => {
  it('saves derived panels with their layout and reopens the complete arrangement', () => {
    const document = graphDocumentFromEditor(snapshot());
    expect(document.metadata.studio?.panels.map((panel) => panel.id)).toEqual([
      'studio-panel:a', 'studio-panel:b', 'studio-panel:c', 'studio-panel:d',
    ]);
    expect(reopen(document).layout).toEqual(layout);
  });

  it('recovers generated panels before validating older files with an empty panel list', () => {
    const document = graphDocumentFromEditor(snapshot());
    document.metadata.studio!.panels = [];
    expect(reopen(document).layout).toEqual(layout);
  });

  it('preserves authored identities and styles, and repairs generated layout references', () => {
    const document = graphDocumentFromEditor(snapshot());
    const first = document.metadata.studio!.panels[0];
    first.id = 'authored-panel';
    first.title = 'Saved title';
    first.plotStyle = { palette: { kind: 'custom', colors: ['#22d3ee'] } };
    const opened = reopen(document);
    expect(opened.panels[0]).toEqual(first);
    const expected = structuredClone(layout);
    if (expected.root.kind === 'split' && expected.root.children[0].kind === 'split') {
      expected.root.children[0].children[0] = pane('authored-panel');
    }
    expect(opened.layout).toEqual(expected);
    expect(reopen(graphDocumentFromEditor(opened.editor)).layout).toEqual(expected);
  });

  it('preserves disabled panel definitions in the file so reenabling restores their positions', () => {
    const before = snapshot();
    before.nodes[0].executionMode = 'disabled';
    const document = graphDocumentFromEditor(before);
    expect(document.metadata.studio?.panels).toHaveLength(4);
    const opened = reopen(document);
    opened.editor.nodes[0].executionMode = 'active';
    expect(reopen(graphDocumentFromEditor(opened.editor)).layout).toEqual(layout);
  });

  it('adds a sink without replacing the existing split tree or its proportions', () => {
    const opened = reopen(graphDocumentFromEditor(snapshot()));
    opened.editor.nodes.push({ ...opened.editor.nodes[0], instanceId: 'e', displayName: 'e' });
    const document = graphDocumentFromEditor(opened.editor);
    const after = reopen(document);
    expect(document.metadata.studio?.panels).toHaveLength(5);
    expect(after.layout.root).toEqual({
      kind: 'split', direction: 'column', sizes: [4, 1],
      children: [layout.root, pane('studio-panel:e')],
    });
    expect(reopen(graphDocumentFromEditor(after.editor)).layout).toEqual(after.layout);
  });

  it('does not change the layout when an ordinary DSP block is added', () => {
    const opened = reopen(graphDocumentFromEditor(snapshot()));
    opened.editor.nodes.push({ ...opened.editor.nodes[0], instanceId: 'add', blockTypeId: 'gr::blocks::math::Add<float32>' });
    expect(reopen(graphDocumentFromEditor(opened.editor)).layout).toEqual(layout);
  });

  it.each(['audio', 'filter', 'qpsk', 'sidebands', 'waterfall', 'xy'])('reopens the %s Studio blocks example with its arrangement and styles', (name) => {
    const raw = JSON.parse(examples[`../../../../examples/studio-blocks-${name}.gr4s`]);
    const opened = reopen(raw);
    expect(opened.layout.root).toEqual(raw.metadata.studio.layout.root);
    expect(opened.panels).toEqual(raw.metadata.studio.panels);
    expect(reopen(graphDocumentFromEditor(opened.editor)).layout).toEqual(opened.layout);
  });
});
