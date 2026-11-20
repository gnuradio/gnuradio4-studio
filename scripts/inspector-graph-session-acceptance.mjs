// Called by inspector-browser-acceptance.mjs, using the same real components and CDP harness.
export async function runGraphSessionChecks({evaluate,waitFor,clickText,call,check,screenshot,noOverflow,pause}) {
  const patchContext = async (patch) => evaluate(`(() => {
    const {useRuntimeSessionStore,tabId}=window.inspectorTest;
    const contexts=useRuntimeSessionStore.getState().contextsByTabId;
    useRuntimeSessionStore.setState({contextsByTabId:{...contexts,[tabId]:{...contexts[tabId],...${JSON.stringify(patch)}}}});
  })()`);
  const text = () => evaluate(`document.querySelector('.inspector').innerText`);
  const inputValue = async (selector,value) => evaluate(`(() => {
    const input=document.querySelector(${JSON.stringify(selector)});
    Object.getOwnPropertyDescriptor(input.tagName === 'SELECT' ? HTMLSelectElement.prototype : input.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype,'value').set.call(input,${JSON.stringify(value)});
    input.dispatchEvent(new Event(input.tagName === 'SELECT' ? 'change' : 'input',{bubbles:true}));
  })()`);
  await evaluate(`document.querySelector('#root').style.width='300px'`);
  await patchContext({sessionId:null,session:null,lastError:null,activity:[],lastSubmittedHash:null,graphSubmissionUpdatedAt:null});
  await clickText('Graph');
  await evaluate(`window.inspectorTest.useEditorStore.getState().replaceGraph({metadata:{name:'Untitled.gr4s'},nodes:[],edges:[]})`);
  await waitFor(`document.querySelector('.inspector-content h2').textContent === 'Untitled.gr4s'`);
  check('Graph: empty graph statistics', (await text()).includes('0 blocks · 0 connections'));
  check('Graph: empty description is editable', await evaluate(`document.querySelector('textarea[aria-label="Graph description"]').placeholder === 'Add description…'`));
  const description='Receiver notes\n\nPreserve multiline prose.';
  await inputValue('textarea[aria-label="Graph description"]',description);
  await waitFor(`window.inspectorTest.useEditorStore.getState().documentDescription === ${JSON.stringify(description)}`);
  check('Graph: description edits persist through existing serialization',await evaluate(`(async () => {
    const {serializeEditorSnapshot,deserializeDocumentText}=await import('/src/features/document-file/document-serialization.ts');
    return deserializeDocumentText(serializeEditorSnapshot(window.inspectorTest.useEditorStore.getState().getGraphSnapshot()).content).document.metadata.description === ${JSON.stringify(description)};
  })()`));
  await clickText('Session');
  await clickText('Graph');
  check('Graph: description survives tab switches', await evaluate(`document.querySelector('textarea[aria-label="Graph description"]').value`) === description);
  await inputValue('textarea[aria-label="Graph description"]','');
  check('Graph: description can be cleared', await evaluate(`window.inspectorTest.useEditorStore.getState().documentDescription === ''`));
  check('Graph: no permanent run explanation', !(await text()).includes('Run creates'));
  check('Graph: no empty submission metadata in default view', !(await text()).includes('no snapshot baseline') && !(await text()).includes('n/a'));
  await screenshot('graph-empty-dark');
  await waitFor(`document.querySelector('select[aria-label="Scheduler"]').options.length === 3`);
  check('Graph: readable scheduler option with canonical value', await evaluate(`document.querySelector('option[value="gr::scheduler::SimpleMulti"]').textContent === 'Simple Multi'`));
  await inputValue('select[aria-label="Scheduler"]','gr::scheduler::SimpleMulti');
  await waitFor(`window.inspectorTest.useEditorStore.getState().schedulerId === 'gr::scheduler::SimpleMulti'`);
  check('Graph: scheduler updates canonical editor value');
  check('Graph: canonical scheduler persists through document serialization',await evaluate(`(async () => {
    const {serializeEditorSnapshot}=await import('/src/features/document-file/document-serialization.ts');
    const serialized=serializeEditorSnapshot(window.inspectorTest.useEditorStore.getState().getGraphSnapshot());
    return serialized.document.metadata.schedulerId === 'gr::scheduler::SimpleMulti';
  })()`));
  await inputValue('select[aria-label="Display mode"]','popout');
  await inputValue('input[aria-label="Display title"]','Receiver display');
  await waitFor(`window.inspectorTest.useEditorStore.getState().application?.title === 'Receiver display'`);
  check('Graph: display editing preserves filename', await evaluate(`(() => {
    const state=window.inspectorTest.useEditorStore.getState();
    return state.application.mode === 'popout' && state.documentName === 'Untitled.gr4s';
  })()`));
  await evaluate(`(() => {
    const create=URL.createObjectURL.bind(URL);
    URL.createObjectURL=(blob)=>{window.exportedBlob=blob;return create(blob);};
    const click=HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click=function(){if(this.download){window.exportedFilename=this.download;return;}click.call(this);};
  })()`);
  await clickText('Download .gr4c');
  check('Graph: existing export produces .gr4c download', await evaluate(`window.exportedFilename?.endsWith('.gr4c') && window.exportedBlob?.size > 0`));
  await evaluate(`(() => {
    const state=window.inspectorTest.useEditorStore.getState();
    const makeNode=(id)=>({instanceId:id,blockTypeId:'gr::blocks::math::Multiply<float32>',displayName:'Multiply',parameters:{gain:{value:'2',bindingKind:'literal'}},position:{x:0,y:0}});
    state.replaceGraph({metadata:{...state.getGraphSnapshot().metadata,name:'receiver-with-a-very-long-generated-document-name-01234567890123456789.gr4s',schedulerId:'gr::scheduler::SimpleMulti',description:'Receive and inspect a signal.'},nodes:[makeNode('one'),makeNode('two')],edges:[{id:'one-two',sourceInstanceId:'one',targetInstanceId:'two',sourcePort:'out',targetPort:'in'}]});
  })()`);
  await waitFor(`document.querySelector('.inspector').innerText.includes('2 blocks · 1 connection')`);
  check('Graph: multiple blocks and connection counts stay compact');
  await patchContext({graphSubmissionUpdatedAt:'2026-11-15T15:16:49Z',sessionId:'metadata-session',lastSubmittedHash:'different-baseline'});
  await clickText('Advanced details');
  check('Graph: full scheduler and stale submission metadata remain accessible', (await text()).includes('gr::scheduler::SimpleMulti') && (await text()).includes('Stale') && (await text()).includes('Last submitted'));
  await noOverflow('Graph: expanded metadata and long filename fit at 300px');
  await clickText('Advanced details');
  for (const theme of ['dark','light','high-contrast','paper']) {
    await evaluate(`window.inspectorTest.themeManager.select('builtin.${theme}')`);
    await pause(200);
    await noOverflow('Graph: '+theme+' at 300px');
    await screenshot('graph-'+theme);
  }
  await evaluate(`document.querySelector('#root').style.width='240px'`);
  await noOverflow('Graph: controls and long filename fit at 240px');
  await evaluate(`document.querySelector('#root').style.width='300px'`);
  await patchContext({sessionId:null,session:null,lastError:null,activity:[]});
  await clickText('Session');
  check('Session: compact unlinked state', (await text()).includes('No session linked') && !(await text()).includes('Session ID'));
  const longId='session_'+'0123456789'.repeat(14);
  const session={id:longId,name:'studio-blocks-waterfall.gr4s',state:'stopped',schedulerId:'gr::scheduler::SimpleMulti',createdAt:'2026-11-15T15:15:49Z',updatedAt:'2026-11-15T15:16:49Z',lastError:null};
  await patchContext({sessionId:longId,session,lastAction:null,lastActionStatus:'idle',sessionRefreshedAt:'2026-11-15T15:16:49Z',lastSubmittedHash:null});
  await waitFor(`document.querySelector('.inspector-content h2').innerText === 'studio-blocks-waterfall.gr4s'`);
  check('Session: created but stopped state stays stopped', await evaluate(`document.querySelector('.inspector [data-runtime-status]').textContent === 'stopped'`));
  check('Session: no activity state', (await text()).includes('No activity yet.'));
  check('Session: technical IDs and timestamps hidden initially', !(await text()).includes(longId) && !(await text()).includes('Created'));
  await patchContext({session:{...session,state:'running'}});
  await waitFor(`document.querySelector('.inspector [data-runtime-status]').textContent === 'running'`);
  await evaluate(`window.inspectorTest.themeManager.select('builtin.dark')`);
  await pause(200);
  await screenshot('session-running-dark');
  check('Session: running state stays running');
  await patchContext({lastSubmittedHash:'different-baseline'});
  check('Session: sync uses existing runtime drift state', (await text()).includes('Out of sync'));
  await patchContext({lastSubmittedHash:null});
  check('Session: existing in-sync state shown', (await text()).includes('In sync'));
  const detail="session "+longId+" start failed: block 'waterfall' of type 'gr::studio::StudioWaterfallSink<float32>' declares no setting named 'center_freq'; the nearest are ['sample_rate']";
  const raw='app-api request failed: '+detail+': route=app-api url=/api/sessions/'+longId+'/start upstream='+JSON.stringify({error:{code:'runtime_failure',message:detail,details:{block_instance_name:'waterfall',setting:'center_freq',reason:'Unknown setting',trace:'complete diagnostic '.repeat(1500)}}});
  const activity=Array.from({length:9},(_,i)=>({timestamp:'2026-11-15T15:16:49Z',action:i===0?'start':'create',level:i===0?'error':'info',message:i===0?raw:i===1?'Created session '+longId+'.':'Informational event '+i}));
  await patchContext({session:{...session,lastError:raw},lastAction:'start',lastActionStatus:'error',lastError:raw,activity});
  check('Session: start error does not relabel stopped backend state', await evaluate(`document.querySelector('.inspector [data-runtime-status]').textContent === 'stopped'`));
  check('Session: concise actionable summary', (await text()).includes('Runtime start failed') && (await text()).includes('waterfall') && (await text()).includes('center_freq'));
  check('Session: no raw JSON or repeated diagnostics in default view', !(await text()).includes('upstream=') && !(await text()).includes('complete diagnostic'));
  check('Session: large error default view stays bounded', await evaluate(`document.querySelector('.inspector-content').scrollHeight < 1100`));
  check('Session: five newest activities initially', await evaluate(`document.querySelectorAll('ul[aria-label="Session activity"] > li').length === 5`));
  for (const theme of ['dark','light','high-contrast','paper']) {
    await evaluate(`window.inspectorTest.themeManager.select('builtin.${theme}')`);
    await pause(200);
    await noOverflow('Session: large error in '+theme+' at 300px');
    await screenshot('session-error-'+theme);
  }
  await evaluate(`document.querySelector('section[aria-label="Last error"] summary').focus()`);
  await call('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',windowsVirtualKeyCode:13,text:'\r',unmodifiedText:'\r'});
  await call('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});
  await waitFor(`document.querySelector('section[aria-label="Last error"] details').open`);
  check('Session: technical disclosure supports keyboard activation');
  check('Session: complete formatted JSON available', (await text()).includes('complete diagnostic') && (await text()).includes('"error": {'));
  check('Session: technical output scrolls within its own container', await evaluate(`(() => {
    const pre=document.querySelector('pre[aria-label="Complete error diagnostics"]');
    return pre.clientHeight <= 240 && pre.scrollHeight > pre.clientHeight && pre.tabIndex === 0;
  })()`));
  await evaluate(`document.querySelector('button[aria-label="Copy complete error"]').click()`);
  await waitFor(`document.querySelector('section[aria-label="Last error"] [role="status"]').textContent === 'Copied'`);
  check('Session: copy retains exact original error', await evaluate(`navigator.clipboard.readText()`) === raw);
  await screenshot('session-error-expanded');
  await clickText('Technical details');
  await clickText('Show all activity (9)');
  check('Session: all retained activity accessible', await evaluate(`document.querySelectorAll('ul[aria-label="Session activity"] > li').length === 9`));
  await evaluate(`document.querySelector('ul[aria-label="Session activity"] summary').click()`);
  check('Session: individual activity retains raw message', (await text()).includes('complete diagnostic'));
  await noOverflow('Session: expanded activity fits sidebar');
  await clickText('Show recent activity');
  await clickText('Advanced details');
  check('Session: full ID and all timestamps available', (await text()).includes(longId) && (await text()).includes('Created') && (await text()).includes('Last refreshed'));
  await evaluate(`document.querySelector('button[aria-label="Copy session ID"]').click()`);
  await waitFor(`document.querySelector('button[aria-label="Copy session ID"]').parentElement.querySelector('[role="status"]').textContent === 'Copied'`);
  check('Session: copy full ID', await evaluate(`navigator.clipboard.readText()`) === longId);
  await evaluate(`document.querySelector('#root').style.width='240px'`);
  await noOverflow('Session: expanded IDs, errors and activity fit 240px');
  await patchContext({lastError:'Unknown device fault: '+'unstructured trace '.repeat(2000),activity:[],session:{...session,lastError:null}});
  check('Session: unknown error fallback stays readable', (await text()).includes('Unknown device fault:') && !(await text()).includes('upstream='));
  check('Session: unstructured error remains bounded', await evaluate(`document.querySelector('section[aria-label="Last error"]').clientHeight < 300`));
  await patchContext({busy:true,lastAction:'refresh',lastActionStatus:'running'});
  check('Session: refresh disabled while busy', await evaluate(`document.querySelector('button[aria-label="Refresh session"]').disabled`));
  await patchContext({busy:false,lastActionStatus:'idle'});
  await evaluate(`window.sessionResponse=${JSON.stringify({id:longId,name:session.name,state:'stopped',scheduler_id:session.schedulerId,created_at:session.createdAt,updated_at:session.updatedAt,last_error:null})}`);
  await evaluate(`document.querySelector('button[aria-label="Refresh session"]').click()`);
  await waitFor(`window.sessionRefreshes > 0 && window.inspectorTest.useRuntimeSessionStore.getState().contextsByTabId[window.inspectorTest.tabId].lastActionStatus === 'success'`);
  check('Session: refresh uses existing API and lifecycle handling');
  check('Session: refresh clears operation error normally', !(await text()).includes('Last error'));
  check('Session: refreshed activity shown', (await text()).includes('Session refreshed.'));
  await evaluate(`document.querySelector('#root').style.width='300px'`);
}

export async function runInspectorEditingChecks({evaluate,waitFor,clickText,call,check,screenshot,noOverflow,pause,origin}) {
  // Include the real graph canvas to catch selection loss when the React Flow identity changes.
  await call('Page.navigate',{url:origin+'/scripts/fixtures/inspector.html?canvas'});
  await waitFor(`!!window.inspectorTest && !!document.querySelector('.react-flow')`);
  await evaluate(`window.inspectorTest.themeManager.select('builtin.dark')`);
  await pause(200);
  await evaluate(`(() => {
    const {useEditorStore}=window.inspectorTest;
    const makeNode=(id,x)=>({instanceId:id,blockTypeId:'gr::blocks::math::Multiply<float32>',displayName:'Multiply',position:{x,y:30},parameters:{gain:{value:'2',bindingKind:'literal'}}});
    useEditorStore.getState().replaceGraph({metadata:{name:'Rename test.gr4s'},nodes:[makeNode('one',30),makeNode('two',330)],edges:[{id:'one-two',sourceInstanceId:'one',targetInstanceId:'two',sourcePort:'out',targetPort:'in'}]});
    useEditorStore.getState().selectNode('one');
  })()`);
  await waitFor(`document.querySelectorAll('.studio-block').length === 2`);
  await waitFor(`document.querySelector('[data-id="one"] .studio-block')?.dataset.selected === 'true'`);
  const setId = (value) => evaluate(`(() => {
    const input=document.querySelector('input[aria-label="Instance ID"]');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,${JSON.stringify(value)});
    input.dispatchEvent(new Event('input',{bubbles:true}));
  })()`);
  await clickText('Advanced details');
  await setId('two');
  check('Block ID: typing does not rename before submission', await evaluate(`window.inspectorTest.useEditorStore.getState().selectedNodeId === 'one'`));
  await clickText('Rename');
  check('Block ID: duplicate ID rejected', await evaluate(`document.querySelector('.inspector [role="alert"]').textContent.includes('already uses')`));
  await setId('');
  await clickText('Rename');
  check('Block ID: empty ID rejected', await evaluate(`document.querySelector('.inspector [role="alert"]').textContent.includes('Enter an instance ID')`));
  await evaluate(`document.querySelector('input[aria-label="Instance ID"]').focus()`);
  await call('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
  await call('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
  check('Block ID: Escape restores saved ID', await evaluate(`document.querySelector('input[aria-label="Instance ID"]').value === 'one' && !document.querySelector('.inspector [role="alert"]')`));
  await setId('oscillator');
  await clickText('Rename');
  await waitFor(`window.inspectorTest.useEditorStore.getState().selectedNodeId === 'oscillator'`);
  await waitFor(`document.querySelector('[data-id="oscillator"] .studio-block')?.dataset.selected === 'true'`);
  await waitFor(`document.querySelectorAll('.react-flow__edge').length === 1`);
  check('Block ID: renamed node remains selected in real canvas and Inspector', await evaluate(`document.querySelector('input[aria-label="Instance ID"]').value === 'oscillator' && document.querySelector('details.inspector-section').open`));
  check('Block ID: connections remain attached', await evaluate(`window.inspectorTest.useEditorStore.getState().edges[0].sourceInstanceId === 'oscillator' && document.querySelectorAll('.react-flow__edge').length === 1`));
  check('Block ID: exact block type and parameters unchanged', await evaluate(`(() => { const node=window.inspectorTest.useEditorStore.getState().nodes[0];return node.blockTypeId === 'gr::blocks::math::Multiply<float32>' && node.parameters.gain.value === '2'; })()`));
  await noOverflow('Block ID editor fits the existing 300px Inspector beside the canvas');
  await screenshot('instance-id-editor-dark');
  await setId('unsaved-draft');
  await clickText('Fit view');
  await pause(200);
  const point = await evaluate(`(() => {const rect=document.querySelector('[data-id="two"] .studio-block-header').getBoundingClientRect();return {x:rect.x+rect.width/2,y:rect.y+rect.height/2};})()`);
  await call('Input.dispatchMouseEvent',{type:'mousePressed',...point,button:'left',clickCount:1});
  await call('Input.dispatchMouseEvent',{type:'mouseReleased',...point,button:'left',clickCount:1});
  await waitFor(`window.inspectorTest.useEditorStore.getState().selectedNodeId === 'two'`);
  check('Block ID: choosing another block resets the unsaved ID draft',await evaluate(`document.querySelector('input[aria-label="Instance ID"]').value === 'two'`));
  await clickText('Graph');
  await evaluate(`(() => {
    const input=document.querySelector('textarea[aria-label="Graph description"]');
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(input,'Receive and inspect a signal.\\nNotes remain with the graph document.');
    input.dispatchEvent(new Event('input',{bubbles:true}));
  })()`);
  await screenshot('description-editor-dark');
  check('Description: typing saves to the graph document state', await evaluate(`window.inspectorTest.useEditorStore.getState().documentDescription.includes('Notes remain')`));
  check('Editing: both changes survive a save/open round trip', await evaluate(`(async () => {
    const {serializeEditorSnapshot,deserializeDocumentText}=await import('/src/features/document-file/document-serialization.ts');
    const {editorGraphFromDocument}=await import('/src/features/graph-document/model/toEditor.ts');
    const snapshot=editorGraphFromDocument(deserializeDocumentText(serializeEditorSnapshot(window.inspectorTest.useEditorStore.getState().getGraphSnapshot()).content).document);
    window.inspectorTest.useEditorStore.getState().replaceGraph(snapshot);
    return snapshot.nodes[0].instanceId === 'oscillator' && snapshot.metadata.description.includes('Notes remain') && snapshot.edges[0].sourceInstanceId === 'oscillator';
  })()`));
}
