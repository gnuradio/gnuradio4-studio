import { beforeEach, describe, expect, it } from 'vitest';
import { useEditorStore } from './editorStore';
import { createEdgeId } from '../model/nodeFactory';
import { serializeEditorSnapshot, deserializeDocumentText } from '../../document-file/document-serialization';
import { editorGraphFromDocument } from '../../graph-document/model/toEditor';
import { buildCurrentGraphSubmissionFromEditorSnapshot } from '../../runtime-submission/model/current-graph-submission';
import type { StudioDataPanelSpec, StudioLayoutSpec } from '../../graph-document/model/studio-workspace';
import { buildEffectiveRenderedStudioLayout } from '../../workspace/model/layout';
import { deriveDefaultStudioPanelsFromNodes } from '../../workspace/model/panel-derivation';
import { mergeSavedAndDerivedStudioPanels } from '../../workspace/model/panel-merge';

const store = useEditorStore.getState;
const sinkType = 'gr::studio::StudioSeriesSink<float32>';

function reopenGraph() {
  const { content } = serializeEditorSnapshot(store().getGraphSnapshot());
  store().replaceGraph(editorGraphFromDocument(deserializeDocumentText(content).document));
}

function expectRejectedRename(instanceId: string, error: string) {
  store().setStudioPanels([
    {id:'plot',nodeId:'sink',kind:'series',visible:true,previewOnCanvas:false},
    {id:'controls',nodeId:'source',kind:'control',visible:true,widgets:[
      {id:'source-rate',kind:'parameter',inputKind:'number',binding:{kind:'parameter',nodeId:'source',parameterName:'sample_rate'}},
      {id:'variable-rate',kind:'parameter',inputKind:'number',binding:{kind:'variable',variableName:'rate'}},
    ]},
  ]);
  store().setStudioLayout({version:2,root:{kind:'pane',panelId:'controls'},activePanelId:'controls'});
  store().selectNode('source');
  const previous = store();
  const snapshot = serializeEditorSnapshot(previous.getGraphSnapshot()).content;

  expect(store().renameNodeInstanceId('source',instanceId)).toEqual({ok:false,error});
  expect(store()).toBe(previous);
  expect(serializeEditorSnapshot(store().getGraphSnapshot()).content).toBe(snapshot);
  expect(store().selectedNodeId).toBe('source');
}

beforeEach(() => {
  store().replaceGraph({metadata:{name:'Receiver.gr4s',schedulerId:'gr::scheduler::SimpleMulti',application:{mode:'popout',renderer:'react',title:'Receiver display'}},nodes:[
    {instanceId:'source',blockTypeId:'gr::testing::NullSource<float32>',displayName:'Source',position:{x:10,y:20},parameters:{sample_rate:{value:'rate * 2',bindingKind:'expression'}}},
    {instanceId:'sink',blockTypeId:sinkType,displayName:'Series',position:{x:100,y:20},parameters:{transport:{value:'http_poll',bindingKind:'literal'}}},
  ],edges:[{id:createEdgeId('source','sink','out','in'),sourceInstanceId:'source',targetInstanceId:'sink',sourcePort:'out',targetPort:'in'}]});
});

describe('Document description editing', () => {
  it('persists multiline prose without changing the graph name or display settings', () => {
    const description = 'Receiver notes\n\n  Keep this indentation. <text> & "quotes"';
    store().setDocumentDescription(description);
    const restored = deserializeDocumentText(serializeEditorSnapshot(store().getGraphSnapshot()).content).document;
    expect(restored.metadata).toMatchObject({name:'Receiver.gr4s',description,schedulerId:'gr::scheduler::SimpleMulti',application:{mode:'popout',renderer:'react',title:'Receiver display'}});
    store().setDocumentDescription('');
    expect(serializeEditorSnapshot(store().getGraphSnapshot()).document.metadata.description).toBe('');
  });
});

describe('Block instance ID editing', () => {
  it('atomically renames the selected node and its connections without changing parameter expressions', () => {
    store().selectNode('source');
    const parameters = store().nodes[0].parameters;
    expect(store().renameNodeInstanceId('source','  oscillator  ')).toEqual({ok:true,instanceId:'oscillator'});
    expect(store().selectedNodeId).toBe('oscillator');
    expect(store().nodes[0]).toMatchObject({instanceId:'oscillator',position:{x:10,y:20},parameters});
    expect(store().nodes[0].parameters).toBe(parameters);
    expect(store().edges[0]).toEqual({id:createEdgeId('oscillator','sink','out','in'),sourceInstanceId:'oscillator',targetInstanceId:'sink',sourcePort:'out',targetPort:'in'});
    store().addEdge({sourceInstanceId:'oscillator',targetInstanceId:'sink',sourcePort:'out',targetPort:'in'});
    expect(store().edges).toHaveLength(1);
  });

  it.each(['', '   ', 'sink', 'bad\nname'])('rejects invalid or duplicate IDs without partial changes: %j', (id) => {
    const previous = store();
    expect(store().renameNodeInstanceId('source',id).ok).toBe(false);
    expect(store()).toBe(previous);
  });

  it.each([
    'source, left', 'source left', 'source-left', 'source.left', 'source:left',
    'source/left', 'source\\left', '[source]', '{source}', 'source"left', "source'left",
    'source\nleft', 'source\tleft', 'source\u0000left', 'source\u007fleft', 'café', '左',
  ])('rejects unsupported characters without changing graph state: %j', (instanceId) => {
    expectRejectedRename(instanceId,'Use only ASCII letters (A–Z, a–z), digits (0–9), and underscores (_).');
  });

  it.each(['source_left', 'Source_42', '_source', '  source_left  ', '8psk', '1_000', '  true  ', '0xFF', '123', 'null', 'NaN'])(
    'preserves connection fields through document serialization and YAML export after a valid rename: %j', (value) => {
      store().updateNodeParameter('source','sample_rate','48000');
      const instanceId = value.trim();
      expect(store().renameNodeInstanceId('source',value)).toEqual({ok:true,instanceId});
      expect(store().renameNodeInstanceId('sink','Sink_2')).toEqual({ok:true,instanceId:'Sink_2'});

      const document = deserializeDocumentText(serializeEditorSnapshot(store().getGraphSnapshot()).content).document;
      const restored = editorGraphFromDocument(document);
      expect(restored.edges[0]).toMatchObject({sourceInstanceId:instanceId,sourcePort:'out',targetInstanceId:'Sink_2',targetPort:'in'});
      const exported = buildCurrentGraphSubmissionFromEditorSnapshot(restored).content;
      expect(exported).toContain(`name: "${instanceId}"\n`);
      expect(exported).toContain('name: "Sink_2"\n');
      expect(exported.split('connections:\n')[1].trim()).toBe(`- ["${instanceId}", out, "Sink_2", in]`);
    },
  );

  it.each(['source, left', 'legacy-source', 'legacy source', 'café', '123', 'true', 'null', 'NaN', '0xFF'])('loads existing IDs unchanged: %j', (instanceId) => {
    const snapshot = store().getGraphSnapshot();
    const legacySnapshot = {
      ...snapshot,
      nodes:snapshot.nodes.map((node) => node.instanceId === 'source' ? {...node,instanceId} : node),
      edges:snapshot.edges.map((edge) => ({...edge,sourceInstanceId:instanceId})),
    };
    const restored = editorGraphFromDocument(deserializeDocumentText(serializeEditorSnapshot(legacySnapshot).content).document);
    store().replaceGraph(restored);
    expect(store().nodes[0].instanceId).toBe(instanceId);
    expect(store().edges[0].sourceInstanceId).toBe(instanceId);
    expect(store().renameNodeInstanceId(instanceId,'safe_source')).toEqual({ok:true,instanceId:'safe_source'});
    expect(store().edges[0].sourceInstanceId).toBe('safe_source');
  });

  it('treats unchanged IDs as a no-op and reports removed blocks', () => {
    const previous = store();
    expect(store().renameNodeInstanceId('source','source')).toEqual({ok:true,instanceId:'source'});
    expect(store()).toBe(previous);
    expect(store().renameNodeInstanceId('missing','receiver').ok).toBe(false);
    expect(store()).toBe(previous);
  });

  it('keeps custom panel IDs, layout, plot styling, widget IDs and variable bindings intact', () => {
    store().setStudioPanels([
      {id:'custom-plot',nodeId:'sink',kind:'series',visible:false,previewOnCanvas:true,title:'Authored plot',plotStyle:{palette:{kind:'custom',colors:['#abcdef']}}},
      {id:'controls',nodeId:'sink',kind:'control',visible:true,widgets:[
        {id:'gain-control',kind:'parameter',inputKind:'number',binding:{kind:'parameter',nodeId:'sink',parameterName:'window_size'}},
        {id:'rate-control',kind:'parameter',inputKind:'number',binding:{kind:'variable',variableName:'rate'}},
        {id:'source-control',kind:'parameter',inputKind:'number',binding:{kind:'parameter',nodeId:'source',parameterName:'sample_rate'}},
      ],widgetLayout:{version:2,root:{kind:'pane',panelId:'gain-control'}}},
    ]);
    store().setStudioLayout({version:2,root:{kind:'split',direction:'row',children:[{kind:'pane',panelId:'custom-plot'},{kind:'pane',panelId:'controls'}],sizes:[65,35]},activePanelId:'custom-plot'});
    const before = store().getGraphSnapshot();
    store().renameNodeInstanceId('sink','monitor');
    const after = store().getGraphSnapshot();
    expect(after.metadata.studioLayout).toEqual(before.metadata.studioLayout);
    expect(after.metadata.studioPanels?.[0]).toEqual({...before.metadata.studioPanels![0],nodeId:'monitor'});
    const controls = after.metadata.studioPanels?.find((panel) => panel.kind === 'control');
    expect(controls?.nodeId).toBe('monitor');
    if (!controls || controls.kind !== 'control') throw new Error('Missing controls');
    expect(controls.widgets[0]).toMatchObject({id:'gain-control',binding:{nodeId:'monitor',parameterName:'window_size'}});
    expect(controls.widgets[1].binding).toEqual({kind:'variable',variableName:'rate'});
    expect(controls.widgets[2].binding).toEqual({kind:'parameter',nodeId:'source',parameterName:'sample_rate'});
    expect(controls.widgetLayout).toEqual({version:2,root:{kind:'pane',panelId:'gain-control'}});
    const restored = deserializeDocumentText(serializeEditorSnapshot(after).content).document;
    expect(restored.metadata.studio?.panels).toHaveLength(2);
    expect(restored.graph.edges[0].target.nodeId).toBe('monitor');
  });

  it('preserves generated panel layout identities when panels have not been explicitly saved yet', () => {
    store().setStudioLayout({version:2,root:{kind:'pane',panelId:'studio-panel:sink'},activePanelId:'studio-panel:sink'});
    const layout = store().studioLayout;
    store().renameNodeInstanceId('sink','monitor');
    expect(store().studioPanels?.[0]).toMatchObject({id:'studio-panel:sink',nodeId:'monitor'});
    expect(store().studioLayout).toEqual(layout);
    const restored = editorGraphFromDocument(deserializeDocumentText(serializeEditorSnapshot(store().getGraphSnapshot()).content).document);
    expect(restored.metadata.studioPanels).toHaveLength(1);
    expect(restored.metadata.studioPanels?.[0]).toMatchObject({id:'studio-panel:sink',nodeId:'monitor'});
    expect(restored.metadata.studioLayout).toEqual(layout);
  });

  it('keeps both Workspace panels when a catalog sink reuses a renamed sink ID after reopening', () => {
    const catalogSink = { blockTypeId: sinkType, displayName: 'Series Sink' };
    store().replaceGraph({
      nodes: [store().nodes[0]], edges: [], metadata: { name: 'Receiver.gr4s' },
    });
    store().addNodeFromCatalogItem(catalogSink);
    const sinkId = store().nodes[1].instanceId;
    expect(sinkId).toMatch(/__2$/);
    store().removeNode('source');
    const originalPanel: StudioDataPanelSpec = {
      id: `studio-panel:${sinkId}`,
      nodeId: sinkId,
      kind: 'series',
      title: 'Receiver monitor',
      visible: true,
      previewOnCanvas: true,
      plotStyle: { palette: { kind: 'custom', colors: ['#abcdef'] } },
    };
    const layout: StudioLayoutSpec = {
      version: 2,
      root: { kind: 'pane', panelId: originalPanel.id },
      activePanelId: originalPanel.id,
    };
    store().setStudioPanels([originalPanel]);
    store().setStudioLayout(layout);
    expect(store().renameNodeInstanceId(sinkId, 'monitor')).toEqual({ ok: true, instanceId: 'monitor' });
    reopenGraph();
    expect(store().studioLayout).toEqual(layout);

    store().addNodeFromCatalogItem(catalogSink);
    expect(store().nodes.map((node) => node.instanceId)).toEqual(['monitor', sinkId]);
    const panels = mergeSavedAndDerivedStudioPanels({
      savedPanels: store().studioPanels,
      derivedPanels: deriveDefaultStudioPanelsFromNodes(store().nodes),
    });
    expect(panels).toHaveLength(2);
    expect(panels[0]).toEqual({ ...originalPanel, nodeId: 'monitor' });
    expect(panels[1]).toMatchObject({ nodeId: sinkId, kind: 'series', visible: true });
    expect(panels[1].id).not.toBe(originalPanel.id);
    const workspaceLayout = buildEffectiveRenderedStudioLayout(store().studioLayout, panels);
    expect(workspaceLayout).toEqual({
      ...layout,
      root: {
        kind: 'split', direction: 'column', sizes: [1, 1],
        children: [layout.root, { kind: 'pane', panelId: panels[1].id }],
      },
    });

    const saved = serializeEditorSnapshot(store().getGraphSnapshot()).document.metadata.studio;
    expect(saved?.panels).toEqual(panels);
    expect(saved?.layout).toEqual(workspaceLayout);
    reopenGraph();
    expect(store().studioPanels).toEqual(panels);
    expect(store().studioLayout).toEqual(workspaceLayout);
  });

  it('retains authored edge identities and avoids collisions with generated edge identities', () => {
    useEditorStore.setState({edges:[
      ...store().edges,
      {id:createEdgeId('source','monitor','out','in'),sourceInstanceId:'sink',targetInstanceId:'source',sourcePort:'other',targetPort:'other'},
    ]});
    const originalIds = store().edges.map((edge) => edge.id);
    store().renameNodeInstanceId('sink','monitor');
    expect(store().edges.map((edge) => edge.id)).toEqual(originalIds);
    expect(new Set(store().edges.map((edge) => edge.id)).size).toBe(2);
    expect(store().edges[0].targetInstanceId).toBe('monitor');
    expect(store().edges[1].sourceInstanceId).toBe('monitor');
  });

  it('advances the existing generated-ID sequence to avoid collisions with renamed blocks', () => {
    const type='gr::testing::NullSource<float32>';
    useEditorStore.setState({nextNodeSequence:3});
    store().renameNodeInstanceId('source','gr__testing__NullSource_float32__3');
    store().addNodeFromCatalogItem({blockTypeId:type,displayName:'Source'},{x:0,y:0});
    expect(store().nodes[2].instanceId).toBe('gr__testing__NullSource_float32__4');
  });

  it.each([
    { suffix: '9007199254740990', reopen: false, additions: 3 },
    { suffix: '9007199254740992', reopen: true, additions: 2 },
  ])('allocates unique catalog IDs after renaming to source_$suffix (reopen: $reopen)', ({ suffix, reopen, additions }) => {
    const catalogSource = { blockTypeId: 'source', displayName: 'Source' };
    store().clearGraph();
    store().addNodeFromCatalogItem(catalogSource);
    const instanceId = `source_${suffix}`;
    expect(store().renameNodeInstanceId('source_1', instanceId)).toEqual({ ok: true, instanceId });
    if (reopen) reopenGraph();

    for (let index = 0; index < additions; index += 1) {
      store().addNodeFromCatalogItem(catalogSource);
    }
    const ids = store().nodes.map((node) => node.instanceId);
    expect(ids[0]).toBe(instanceId);
    expect(ids).toHaveLength(1 + additions);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids.slice(1)) expect(id).toMatch(/^source_[0-9]+$/);
  });

  it('skips an occupied generated ID when inserting a catalog block', () => {
    expect(store().renameNodeInstanceId('source', 'source_3').ok).toBe(true);
    useEditorStore.setState({ nextNodeSequence: 3 });
    store().addNodeFromCatalogItem({ blockTypeId: 'source', displayName: 'Source' });
    expect(store().nodes.map((node) => node.instanceId)).toEqual(['source_3', 'sink', 'source_4']);
    expect(store().selectedNodeId).toBe('source_4');
  });

  it('exports the renamed runtime identity and preserves independent clipboard snapshots', () => {
    store().copyNodesToClipboard(['source','sink']);
    const clipboard = store().clipboard;
    store().renameNodeInstanceId('sink','monitor');
    // Replace the expression with a literal so this fixture can be submitted without variables.
    store().updateNodeParameter('source','sample_rate','48000');
    const exported = buildCurrentGraphSubmissionFromEditorSnapshot(store().getGraphSnapshot()).content;
    expect(exported).toContain('name: "monitor"');
    expect(exported).toContain('- ["source", out, "monitor", in]');
    expect(store().clipboard).toBe(clipboard);
    expect(clipboard?.nodes[1].instanceId).toBe('sink');
  });
});
