// Run against `npm run dev`: CHROME_PATH=/usr/bin/google-chrome node scripts/inspector-browser-acceptance.mjs
// Uses Chrome's built-in DevTools protocol; no browser-test dependency required.
import assert from 'node:assert/strict';
import { connectBrowser, pause } from './browser-devtools.mjs';
import { runGraphSessionChecks, runInspectorEditingChecks, checkReopenedDisplay } from './inspector-graph-session-acceptance.mjs';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const origin = process.env.STUDIO_URL ?? 'http://127.0.0.1:5173';
const chrome = process.env.CHROME_PATH ?? '/usr/bin/google-chrome';
const output = process.env.INSPECTOR_EVIDENCE_DIR ?? '.evidence/inspector';
const profile = await mkdtemp(path.join(tmpdir(), 'studio-inspector-chrome-'));
const browser = spawn(chrome, ['--headless=new', '--no-first-run', '--no-default-browser-check',
  '--disable-background-networking', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'],
{ stdio: ['ignore', 'ignore', 'pipe'] });
let chromeLog = '';
browser.stderr.on('data', (data) => { chromeLog = (chromeLog + data.toString()).slice(-6000); });
browser.on('error', (error) => { console.error(error); });
let socket;
const evidence = { browser: '', fixtures: 'Isolated Inspector component with HTTP catalog/settings/session fixtures. Runtime checks do not execute GR4. Full-app visual acceptance remains unverified.', checks: [] };
const check = (name, value = true) => { assert.ok(value, name); evidence.checks.push(name); };

try {
  const client = await connectBrowser(browser, profile, () => chromeLog);
  socket = client.socket;
  const { call, evaluate, waitFor, browserErrors } = client;
  const clickText = async (text) => evaluate(`(() => {
    const button = [...document.querySelectorAll('button,summary')].find(el => el.textContent.trim() === ${JSON.stringify(text)} || el.title === ${JSON.stringify(text)});
    if (!button) throw Error('Missing control: ' + ${JSON.stringify(text)});
    button.click();
  })()`);
  await call('Page.enable');
  await call('Runtime.enable');
  evidence.browser = (await call('Browser.getVersion')).product;
  await call('Emulation.setDeviceMetricsOverride', { width: 800, height: 850, deviceScaleFactor: 1, mobile: false });
  // Test-only HTTP fixtures. Production code remains connected to the real backend.
  await call('Page.addScriptToEvaluateOnNewDocument', { source: `
    const catalog = [
      { id:'gr::blocks::basic::Convert<float32, int16>',name:'Convert',
        inputs:[{name:'in',type:'float32'}],outputs:[{name:'out',type:'int16'}],parameters:[] },
      { id:'gr::blocks::math::Multiply<float32>',name:'Multiply',
        inputs:[{name:'in',type:'float32'}],outputs:[{name:'out',type:'float32'}],
        parameters:[{name:'gain',type:'float32',default:2},{name:'enabled',type:'bool',default:true},
          {name:'mode',type:'string',default:'fast',enum_choices:['fast','precise']},
          {name:'unique_name',type:'string',default:'runtime-block',ui_hint:'advanced'}] },
      { id:'example::DynamicRouter<std::complex<float>>',name:'DynamicRouter',
        inputs:[{name:'in',type:'std::complex<float>',cardinality_kind:'dynamic',render_port_count:3}],
        outputs:[{name:'out',cardinality_kind:'dynamic'}],
        parameters:Array.from({length:12},(_,i)=>({name:'setting_'+i,type:'float32',default:i})) },
      { id:'gr::studio::StudioSeriesSink<float32>',name:'StudioSeriesSink',
        inputs:[{name:'in',type:'float32'}],parameters:[{name:'transport',type:'string',default:'http_poll'}] },
      { id:'gr::blocks::basic::MessageSink',name:'MessageSink',inputs:[{name:'in',type:'message'}] }
    ];
    window.acceptanceCatalog = catalog;
    window.settingsPatches = [];
    let settings = {gain:2,enabled:true,mode:'fast',unique_name:'runtime-block'};
    const actualFetch = window.fetch;
    window.fetch = (input, init) => {
      const url = new URL(typeof input === 'string' ? input : input.url, location.href);
      if (url.pathname === '/api/blocks') return Promise.resolve(Response.json(catalog));
      if (url.pathname.startsWith('/api/blocks/')) {
        const block = catalog.find(entry => entry.id === decodeURIComponent(url.pathname.slice('/api/blocks/'.length)));
        return Promise.resolve(block ? Response.json(block) : Response.json({ error: 'Unknown block' }, { status: 404 }));
      }
      if (url.pathname.endsWith('/settings')) {
        if (init?.method === 'POST') {
          const patch = JSON.parse(init.body);
          window.settingsPatches.push(patch);
          settings = {...settings,...patch};
          return Promise.resolve(Response.json({session_id:'fixture-session',block:'gain',applied_via:'staged',accepted:true}));
        }
        return Promise.resolve(Response.json({settings}));
      }
      if (url.pathname === '/api/schedulers') return Promise.resolve(Response.json([{id:'gr::scheduler::SimpleMulti'},{id:'gr::scheduler::SimpleSingle'}]));
      if (url.pathname.startsWith('/api/sessions/') && url.pathname.split('/').length === 4 && window.sessionResponse) {
        window.sessionRefreshes = (window.sessionRefreshes ?? 0) + 1;
        return Promise.resolve(Response.json(window.sessionResponse));
      }
      if (url.pathname === '/api/sessions') {
        return Promise.resolve(Response.json(init?.method === 'POST' ? window.sessionResponse : []));
      }
      return actualFetch(input, init);
    };
  ` });
  await call('Page.navigate', { url: origin + '/scripts/fixtures/inspector.html' });
  await waitFor(`!!window.inspectorTest && !!document.querySelector('.inspector')`);
  await mkdir(output, {recursive:true});
  const choose = async (id, index, parameters = {}) => {
    await evaluate(`(() => {
      const block = window.acceptanceCatalog[${index}];
      const drafts = Object.fromEntries(Object.entries(${JSON.stringify(parameters)}).map(([name,value]) => [name,{value:String(value),bindingKind:'literal'}]));
      window.inspectorTest.useEditorStore.getState().replaceGraph({metadata:{name:'Inspector acceptance'},nodes:[{
        instanceId:${JSON.stringify(id)},blockTypeId:block.id,displayName:block.name,position:{x:0,y:0},parameters:drafts
      }],edges:[]});
      window.inspectorTest.useEditorStore.getState().selectNode(${JSON.stringify(id)});
    })()`);
    await waitFor(`document.querySelectorAll('section[aria-label="Parameters"]').length === 1`);
    await pause(100);
  };
  const text = () => evaluate(`document.querySelector('.inspector').innerText`);
  const noOverflow = async (name) => {
    check(name, await evaluate(`(() => {
      const content = document.querySelector('.inspector-content');
      return content.scrollWidth <= content.clientWidth + 1;
    })()`));
  };
  const screenshot = async (name) => {
    await evaluate(`document.querySelector('.inspector-content').scrollTop = 0`);
    const image = await call('Page.captureScreenshot',{format:'png',clip:{x:500,y:0,width:300,height:850,scale:1}});
    await writeFile(path.join(output,name+'.png'),Buffer.from(image.data,'base64'));
  };

  await choose('convert',0);
  check('No configurable parameters: compact empty state', (await text()).includes('No configurable parameters.'));
  check('Reflected type signature shown', (await text()).includes('float32 → int16'));
  check('Unknown Studio registry entry is not a primary warning', !(await text()).includes('unsupported') && !(await text()).includes('known-block registry'));
  check('Advanced starts collapsed', await evaluate(`!document.querySelector('.inspector-disclosure').open`));
  for (const theme of ['light','dark','high-contrast','paper']) {
    await evaluate(`window.inspectorTest.themeManager.select('builtin.${theme}')`);
    await pause(200); // Allow existing tab color transitions to settle after theme switches.
    await noOverflow(theme + ': 300px Inspector without horizontal overflow');
    check(theme + ': theme tokens applied', await evaluate(`(() => {
      const heading = document.querySelector('.inspector-heading');
      return getComputedStyle(heading).color === getComputedStyle(document.querySelector('.inspector h2 + p + p')).color;
    })()`));
    await screenshot('selection-'+theme);
  }
  await evaluate(`window.inspectorTest.themeManager.select('builtin.dark')`);
  const longId = 'generated-instance-' + '1234567890'.repeat(14);
  await choose(longId,2);
  check('Multiple and variadic ports retained', (await text()).includes('in[2]') && (await text()).includes('out[*]'));
  check('No manufactured scalar signature on dynamic block', !(await text()).includes(' → '));
  await evaluate(`(() => { const input = document.querySelector('input[aria-label="Filter parameters"]');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'setting_11');
    input.dispatchEvent(new Event('input',{bubbles:true})); })()`);
  await waitFor(`document.querySelectorAll('section[aria-label="Parameters"] dt').length === 1`);
  check('Parameter filtering works');
  await clickText('Advanced details');
  check('Expanded metadata retains complete generated ID', await evaluate(`document.querySelector('input[aria-label="Instance ID"]').value`) === longId);
  await noOverflow('Long IDs, nested type names and expanded metadata wrap at 300px');
  await call('Browser.grantPermissions',{origin,permissions:['clipboardReadWrite','clipboardSanitizedWrite']});
  await call('Emulation.setFocusEmulationEnabled',{enabled:true});
  await call('Page.bringToFront');
  await evaluate(`document.querySelector('button[aria-label="Copy instance id"]').click()`);
  await waitFor(`document.querySelector('[role="status"]').innerText === 'Copied'`);
  check('Copy identifier preserves full value', await evaluate(`navigator.clipboard.readText()`) === longId);
  await screenshot('dynamic-advanced');

  for (let index=0;index<6;index++) {
    await choose('gain',1,{gain:2});
    await clickText('Graph');
    await pause(40);
    check('Graph replaces parameter content, pass '+index, await evaluate(`!document.querySelector('section[aria-label="Parameters"]')`));
    await noOverflow('Graph tab fits, pass '+index);
    await clickText('Session');
    await pause(40);
    check('Session replaces graph content, pass '+index, !(await text()).includes('Local Graph'));
    await clickText('Selection');
    await choose('empty',4);
    check('Selection replaces old parameters, pass '+index, (await text()).includes('No configurable parameters.') && !(await text()).includes('gain'));
  }
  await choose('sink',3,{transport:'zmq_sub'});
  check('Actionable binding warning stays visible', (await text()).includes('Studio display binding:'));
  await choose('gain',1,{gain:2});
  await screenshot('after-dark');
  await clickText('Edit parameters');
  await waitFor(`!!document.querySelector('button') && [...document.querySelectorAll('label')].some(el => el.textContent.trim() === 'gain')`);
  await evaluate(`(() => { const input = [...document.querySelectorAll('label')].find(el => el.textContent.trim() === 'gain').parentElement.querySelector('input');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'3.5');
    input.dispatchEvent(new Event('input',{bubbles:true})); })()`);
  await clickText('OK');
  await waitFor(`window.inspectorTest.useEditorStore.getState().nodes[0].parameters.gain.value === '3.5'`);
  check('Existing properties editor applies document values');
  await evaluate(`(async () => {
    const {useRuntimeSessionStore,useEditorStore,tabId} = window.inspectorTest;
    const {graphDocumentFromEditor} = await import('/src/features/graph-document/model/fromEditor.ts');
    const {getBlockDetails} = await import('/src/lib/api/block-details.ts');
    window.sessionResponse = {id:'fixture-session',name:'Fixture runtime',state:'running',last_error:null,
      created_at:'2026-11-15T15:00:00Z',updated_at:'2026-11-15T15:00:00Z'};
    const snapshot = useEditorStore.getState().getGraphSnapshot();
    const type = snapshot.nodes[0].blockTypeId;
    const result = await useRuntimeSessionStore.getState().runTab(tabId, graphDocumentFromEditor(snapshot),
      {editorNodes:snapshot.nodes, blockDetailsByType:new Map([[type, await getBlockDetails(type)]])});
    if (!result.ok) throw Error(result.error);
  })()`);
  await waitFor(`document.querySelector('.inspector input[type="number"]')?.value === '2'`);
  await screenshot('runtime-dark');
  await noOverflow('Runtime controls fit at 300px');
  await evaluate(`(() => { const input = document.querySelector('.inspector input[type="number"]');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'4.5');
    input.dispatchEvent(new Event('input',{bubbles:true})); })()`);
  await evaluate(`document.querySelector('.inspector input[type="number"]').dispatchEvent(new FocusEvent('focusout',{bubbles:true}))`);
  await waitFor(`window.settingsPatches.some(patch => patch.gain === 4.5)`);
  check('Runtime edit uses existing settings patch API');
  check('Runtime-only edit preserves document value', await evaluate(`window.inspectorTest.useEditorStore.getState().nodes[0].parameters.gain.value === '3.5'`));
  await clickText('Apply to graph');
  await waitFor(`window.inspectorTest.useEditorStore.getState().nodes[0].parameters.gain.value === '4.5'`);
  check('Explicit Apply to graph updates document');
  await evaluate(`document.querySelector('details.inspector-section').open = false; document.querySelector('details.inspector-section > summary').focus()`);
  await call('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',windowsVirtualKeyCode:13,text:'\r',unmodifiedText:'\r'});
  await call('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});
  await waitFor(`document.querySelector('details.inspector-section').open`);
  check('Advanced disclosure supports keyboard activation');
  await evaluate(`document.querySelector('#root').style.width = '240px'`);
  await noOverflow('Expanded runtime and advanced metadata fit at 240px');
  await runGraphSessionChecks({evaluate,waitFor,clickText,call,check,screenshot,noOverflow,pause});
  await runInspectorEditingChecks({evaluate,waitFor,clickText,call,check,screenshot,noOverflow,pause,origin});
  await checkReopenedDisplay({evaluate, waitFor, call, check, origin});
  if (browserErrors.length > 0) console.error(browserErrors);
  check('No React duplicate keys or browser errors', browserErrors.length === 0);
  evidence.browserErrors = browserErrors;
  await writeFile(path.join(output,'acceptance.json'),JSON.stringify(evidence,null,2)+'\n');
  console.log('PASS: '+evidence.checks.length+' Inspector browser checks; screenshots: '+output);
} finally {
  socket?.close();
  browser.kill('SIGTERM');
  await pause(300);
  await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
