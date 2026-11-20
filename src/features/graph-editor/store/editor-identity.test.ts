import { beforeEach, describe, expect, it } from 'vitest';
import { useEditorStore } from './editorStore';
import { createEdgeId } from '../model/nodeFactory';
import { serializeEditorSnapshot, deserializeDocumentText } from '../../document-file/document-serialization';
import { editorGraphFromDocument } from '../../graph-document/model/toEditor';
import { buildCurrentGraphSubmissionFromEditorSnapshot } from '../../runtime-submission/model/current-graph-submission';

const store = useEditorStore.getState;
const sinkType = 'gr::studio::StudioSeriesSink<float32>';

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

  it('exports the renamed runtime identity and preserves independent clipboard snapshots', () => {
    store().copyNodesToClipboard(['source','sink']);
    const clipboard = store().clipboard;
    store().renameNodeInstanceId('sink','monitor');
    // Replace the expression with a literal so this fixture can be submitted without variables.
    store().updateNodeParameter('source','sample_rate','48000');
    const exported = buildCurrentGraphSubmissionFromEditorSnapshot(store().getGraphSnapshot()).content;
    expect(exported).toContain('name: monitor');
    expect(exported).toContain('- [source, out, monitor, in]');
    expect(store().clipboard).toBe(clipboard);
    expect(clipboard?.nodes[1].instanceId).toBe('sink');
  });
});
