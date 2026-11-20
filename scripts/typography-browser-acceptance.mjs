// Run after build:web against `npm run dev`: STUDIO_URL=http://127.0.0.1:5180 node scripts/typography-browser-acceptance.mjs
// Uses Chrome's built-in DevTools protocol; no browser-test dependency required.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createServer } from 'node:http';
import { loadPickerTypography } from '../desktop/typography.mjs';

const origin = process.env.STUDIO_URL ?? 'http://127.0.0.1:5173';
const chrome = process.env.CHROME_PATH ?? '/usr/bin/google-chrome';
const output = process.env.TYPOGRAPHY_EVIDENCE_DIR ?? '.evidence/typography';
const profile = await mkdtemp(path.join(tmpdir(), 'studio-typography-chrome-'));
const browser = spawn(chrome, ['--headless=new', '--no-first-run', '--no-default-browser-check',
  '--disable-background-networking', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'],
{ stdio: ['ignore', 'ignore', 'pipe'] });
let chromeLog = '';
browser.stderr.on('data', (data) => { chromeLog = (chromeLog + data.toString()).slice(-6000); });
browser.on('error', (error) => { console.error(error); });
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let socket;
let assetServer;
const evidence = { phase:process.env.TYPOGRAPHY_PHASE ?? 'after', browser: '', fixtures: 'Full Studio shell and canvas with an offline HTTP catalog/session fixture; no live GR4 execution.', checks: [] };
const check = (name, value = true) => { assert.ok(value, name); evidence.checks.push(name); };

try {
  let port;
  for (let i = 0; i < 450; i++) {
    if (browser.exitCode !== null || browser.signalCode !== null) break;
    try { port = (await readFile(path.join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]; break; }
    catch { await pause(100); }
  }
  assert.ok(port, `Chrome did not start (exit ${browser.exitCode}, signal ${browser.signalCode}): ${chromeLog}`);
  const target = await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' }).then((r) => r.json());
  socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  let sequence = 0;
  const requests = new Map();
  const browserErrors = [];
  const fontRequests = [];
  socket.onmessage = ({ data }) => {
    const message = JSON.parse(data);
    if (message.method === 'Network.requestWillBeSent' && message.params.type === 'Font') fontRequests.push(message.params.request.url);
    if (message.method === 'Fetch.requestPaused') void call('Fetch.failRequest', {requestId:message.params.requestId,errorReason:'BlockedByClient'});
    if (message.method === 'Runtime.exceptionThrown') browserErrors.push(message.params.exceptionDetails.text);
    if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') browserErrors.push(message.params.args.map(arg => arg.value ?? arg.description).join(' '));
    if (message.method === 'Page.javascriptDialogOpening') {
      void call('Page.handleJavaScriptDialog', { accept: true });
    }
    if (message.id) {
      const pending = requests.get(message.id);
      if (pending) { requests.delete(message.id); message.error ? pending.reject(new Error(JSON.stringify(message.error))) : pending.resolve(message.result); }
    }
  };
  const call = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++sequence;
    const timeout = setTimeout(() => { requests.delete(id); reject(new Error(`Timed out: ${method}`)); }, 20000);
    requests.set(id, { resolve: (result) => { clearTimeout(timeout); resolve(result); }, reject: (error) => { clearTimeout(timeout); reject(error); } });
    socket.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async (expression) => {
    const result = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
    return result.result.value;
  };
  const waitFor = async (expression) => {
    for (let i = 0; i < 100; i++) { if (await evaluate(expression)) return; await pause(100); }
    throw new Error(`Condition not met: ${expression}`);
  };
  const clickText = async (text) => evaluate(`(() => {
    const button = [...document.querySelectorAll('.inspector button,.inspector summary'),...document.querySelectorAll('button,summary')].find(el => el.textContent.trim() === ${JSON.stringify(text)} || el.title === ${JSON.stringify(text)});
    if (!button) throw Error('Missing control: ' + ${JSON.stringify(text)});
    button.click();
  })()`);
  await call('Page.enable');
  await call('Runtime.enable');
  await call('Network.enable');
  evidence.browser = (await call('Browser.getVersion')).product;
  await call('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
  await call('Page.addScriptToEvaluateOnNewDocument',{source:`
    new MutationObserver((_,observer)=>{
      if(document.querySelector('.inspector')){
        window.firstUiFont=document.documentElement.dataset.uiFont;
        observer.disconnect();
      }
    }).observe(document,{childList:true,subtree:true});
    const catalog=[
      {id:'gr::blocks::basic::SignalGenerator<float32>',name:'SignalGenerator',category:'blocks/basic',outputs:[{name:'out',type:'float32'}],parameters:[{name:'sample_rate',type:'float32',default:48000},{name:'frequency',type:'float32',default:1000},{name:'amplitude',type:'float32',default:0.5}]},
      {id:'gr::blocks::math::Multiply<float32>',name:'Multiply',category:'blocks/math',inputs:[{name:'in',type:'float32'}],outputs:[{name:'out',type:'float32'}],parameters:[{name:'gain',type:'float32',default:2}]},
      {id:'gr::studio::StudioSeriesSink<float32>',name:'StudioSeriesSink',category:'studio',inputs:[{name:'in',type:'float32'}],parameters:[{name:'transport',type:'string',default:'http_poll'},{name:'window_size',type:'int32',default:1024}]},
      {id:'example::VeryLongGeneratedBlockName<std::complex<float32>>',name:'VeryLongGeneratedBlockName',category:'cst',inputs:[{name:'in',type:'std::complex<float32>',cardinality_kind:'dynamic',render_port_count:4}],outputs:[{name:'out',type:'float32'}],parameters:[]}
    ];
    const realFetch=window.fetch;
    window.fetch=(input,init)=>{
      const url=new URL(typeof input==='string'?input:input.url,location.href);
      if(url.pathname==='/api/blocks') return Promise.resolve(Response.json(catalog));
      if(url.pathname.startsWith('/api/blocks/')) return Promise.resolve(Response.json(catalog.find(b=>b.id===decodeURIComponent(url.pathname.slice(12)))??catalog[0]));
      if(url.pathname==='/api/schedulers') return Promise.resolve(Response.json([{id:'gr::scheduler::SimpleMulti'},{id:'gr::scheduler::SimpleSingle'}]));
      if(url.pathname==='/api/sessions') return Promise.resolve(Response.json([]));
      if(url.pathname.startsWith('/api/sessions/')) return Promise.resolve(Response.json({id:'typography-session',name:'Receiver typography.gr4s',state:'stopped',created_at:'2026-11-15T15:00:00Z',updated_at:'2026-11-15T15:01:00Z',last_error:null}));
      return realFetch(input,init);
    };
    window.typographyCatalog=catalog;
  `});
  await call('Page.navigate',{url:origin});
  await waitFor(`document.documentElement?.dataset.themeReady==='true' && !!document.querySelector('.inspector')`);
  await mkdir(output,{recursive:true});
  await evaluate(`(async()=>{
    const {useGraphTabsStore}=await import('/src/features/graph-tabs/store/graphTabsStore.ts');
    const makeNode=(id,type,name,x,y,parameters={})=>({instanceId:id,blockTypeId:type,displayName:name,position:{x,y},parameters:Object.fromEntries(Object.entries(parameters).map(([k,v])=>[k,{value:String(v),bindingKind:'literal'}]))});
    useGraphTabsStore.getState().createTab({snapshot:{metadata:{name:'Receiver typography.gr4s',description:'Compact engineering controls, readable metadata, and Unicode µs / Ω / →.'},nodes:[
      makeNode('source','gr::blocks::basic::SignalGenerator<float32>','SignalGenerator',80,80,{sample_rate:48000,frequency:1000,amplitude:0.5}),
      makeNode('gain','gr::blocks::math::Multiply<float32>','Multiply',420,80,{gain:2}),
      makeNode('sink','gr::studio::StudioSeriesSink<float32>','StudioSeriesSink',760,80,{transport:'http_poll',window_size:1024})
    ],edges:[{id:'source-gain',sourceInstanceId:'source',targetInstanceId:'gain',sourcePort:'out',targetPort:'in'},{id:'gain-sink',sourceInstanceId:'gain',targetInstanceId:'sink',sourcePort:'out',targetPort:'in'}]}});
  })()`);
  await waitFor(`document.querySelectorAll('.studio-block').length===3`);
  await pause(300);
  await clickText('Fit view');
  await pause(250);
  const point=await evaluate(`(()=>{const r=document.querySelector('[data-id="gain"] .studio-block-header').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`);
  await call('Input.dispatchMouseEvent',{type:'mousePressed',...point,button:'left',clickCount:1});
  await call('Input.dispatchMouseEvent',{type:'mouseReleased',...point,button:'left',clickCount:1});
  await waitFor(`document.querySelector('[data-id="gain"] .studio-block').dataset.selected==='true'`);
  const capture=async(name)=>{
    await pause(200);
    const shot=await call('Page.captureScreenshot',{format:'png'});
    await writeFile(path.join(output,evidence.phase+'-'+name+'.png'),Buffer.from(shot.data,'base64'));
  };
  // Expand catalog categories while retaining their normal controls and row spacing.
  await evaluate(`document.querySelectorAll('aside details').forEach(d=>{if(!d.closest('.inspector'))d.open=true;})`);
  await capture('shell-selection-dark');
  await clickText('Graph');
  await capture('inspector-graph-dark');
  await clickText('Appearance');
  await capture('appearance-dark');
  await clickText('Appearance');
  await clickText('File');
  await capture('menu-dark');
  if(evidence.phase==='after') check('Menu items use 13px regular text',await evaluate(`(()=>{const el=[...document.querySelectorAll('details')].find(el=>el.querySelector('summary')?.textContent.trim()==='File').querySelector('button');const s=getComputedStyle(el);return s.fontSize==='13px'&&s.fontWeight==='400';})()`));
  await clickText('File');
  await clickText('Selection');
  await clickText('Edit parameters');
  await capture('properties-dark');
  await clickText('Cancel');
  if(evidence.phase==='after') {
    check('Inter loaded before the first UI render',await evaluate(`window.firstUiFont==='Inter' && document.fonts.check('400 14px Inter')`));
    await call('DOM.enable');
    await call('CSS.enable');
    const {root}=await call('DOM.getDocument');
    const {nodeId}=await call('DOM.querySelector',{nodeId:root.nodeId,selector:'.inspector h2'});
    const {fonts}=await call('CSS.getPlatformFontsForNode',{nodeId});
    evidence.renderedFonts=fonts;
    check('Chrome renders actual bundled Inter glyphs',fonts.some(font=>font.isCustomFont && font.familyName.startsWith('Inter')));
    const metrics=await evaluate(`(()=>{
      const style=selector=>{const s=getComputedStyle(document.querySelector(selector));return {size:s.fontSize,weight:s.fontWeight,family:s.fontFamily};};
      return {body:style('body'),root:style('html'),object:style('.inspector-content h2'),section:style('.inspector-heading'),node:style('.studio-block-header')};
    })()`);
    evidence.metrics=metrics;
    check('14px UI body retains the 16px layout rem grid',metrics.body.size==='14px' && metrics.root.size==='16px');
    check('Inspector hierarchy: 16px/600 object, 12px/500 section',metrics.object.size==='16px'&&metrics.object.weight==='600'&&metrics.section.size==='12px'&&metrics.section.weight==='500');
    check('Canvas header keeps a compact 14px/600 scale',metrics.node.size==='14px'&&metrics.node.weight==='600');
    await clickText('Zoom in');
    await pause(300);
    await clickText('Zoom in');
    await pause(300);
    check('Canvas labels remain readable at normal zoom without changing node width',await evaluate(`(()=>{const node=document.querySelector('.studio-block');return node.offsetWidth===224&&node.getBoundingClientRect().width>=224;})()`));
    await capture('canvas-normal-zoom-dark');
    check('No rendered UI text below 12 CSS pixels',await evaluate(`(()=>{
      const walker=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);
      let node;while((node=walker.nextNode())){if(!node.textContent.trim())continue;const el=node.parentElement;
        if(el.getClientRects().length && !['STYLE','SCRIPT','OPTION'].includes(el.tagName) && parseFloat(getComputedStyle(el).fontSize)<12)return false;
      }return true;
    })()`));
    const snapshot=await evaluate(`(async()=>JSON.stringify((await import('/src/features/graph-editor/store/editorStore.ts')).useEditorStore.getState().getGraphSnapshot()))()`);
    for(const theme of ['light','dark','high-contrast','paper']) {
      await evaluate(`(async()=>{const {themeManager}=await import('/src/features/themes/theme-store.ts');await themeManager.select('builtin.${theme}');})()`);
      await pause(250);
      for(const width of [1440,1100]) {
        await call('Emulation.setDeviceMetricsOverride',{width,height:1000,deviceScaleFactor:1,mobile:false});
        await pause(100);
        check(theme+': '+width+'px shell and Inspector contain horizontal content',await evaluate(`document.documentElement.scrollWidth<=innerWidth && document.querySelector('.inspector-content').scrollWidth<=document.querySelector('.inspector-content').clientWidth+1`));
        check(theme+': '+width+'px toolbar labels stay on one line',await evaluate(`[...document.querySelectorAll('button')].filter(el=>['Layout Editor','In-app'].includes(el.textContent.trim())).every(el=>el.offsetHeight<34)`));
      }
      await capture('shell-selection-'+theme+'-narrow');
    }
    check('Theme changes preserve the graph document',snapshot===await evaluate(`(async()=>JSON.stringify((await import('/src/features/graph-editor/store/editorStore.ts')).useEditorStore.getState().getGraphSnapshot()))()`));
    await call('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
    await evaluate(`(async()=>{const {themeManager}=await import('/src/features/themes/theme-store.ts');await themeManager.select('builtin.dark');})()`);
    await clickText('Layout Editor');
    await capture('layout-editor-dark');
    await clickText('In-app');
    await capture('in-app-dark');
    await evaluate(`(()=>{[...document.querySelectorAll('button')].find(el=>el.textContent.trim()==='Graph'&&!el.closest('.inspector')).click();})()`);
    await clickText('Graph');
    check('Graph form values use 14px regular and the UI family',await evaluate(`(()=>{const s=getComputedStyle(document.querySelector('textarea[aria-label="Graph description"]'));return s.fontSize==='14px'&&s.fontWeight==='400'&&s.fontFamily.includes('Inter');})()`));
    await evaluate(`(async()=>{
      const {useGraphTabsStore}=await import('/src/features/graph-tabs/store/graphTabsStore.ts');
      const {useRuntimeSessionStore}=await import('/src/features/runtime-session/store/runtimeSessionStore.ts');
      const tabId=useGraphTabsStore.getState().activeTabId;
      const contexts=useRuntimeSessionStore.getState().contextsByTabId;
      const error='API request failed: upstream='+JSON.stringify({error:{code:'RUNTIME_START_FAILED',message:'Device unavailable',detail:'Diagnostic trace '.repeat(2000)}});
      useRuntimeSessionStore.setState({contextsByTabId:{...contexts,[tabId]:{...contexts[tabId],sessionId:'typography-session',session:{id:'typography-session',name:'Receiver typography.gr4s',state:'stopped',lastError:error},lastError:error,lastAction:'start',lastActionStatus:'error',activity:[{timestamp:new Date().toISOString(),action:'start',level:'error',message:error}]}}});
    })()`);
    await clickText('Session');
    await waitFor(`!!document.querySelector('section[aria-label="Last error"]')`);
    check('Long runtime errors remain compact at the new type scale',await evaluate(`document.querySelector('.inspector-content').scrollHeight<1100`));
    await capture('session-error-dark');
    await clickText('Technical details');
    check('Raw error stays selectable, bounded and monospace at 12px',await evaluate(`(()=>{const el=document.querySelector('pre[aria-label="Complete error diagnostics"]');const s=getComputedStyle(el);return s.fontSize==='12px'&&s.fontFamily.includes('monospace')&&s.userSelect==='text'&&el.clientHeight<=240&&el.scrollHeight>el.clientHeight;})()`));
    await call('Input.dispatchKeyEvent',{type:'keyDown',key:'Tab',code:'Tab',windowsVirtualKeyCode:9});
    await call('Input.dispatchKeyEvent',{type:'keyUp',key:'Tab',code:'Tab',windowsVirtualKeyCode:9});
    await evaluate(`document.querySelector('pre[aria-label="Complete error diagnostics"]').focus()`);
    check('Diagnostics keyboard focus remains visible',await evaluate(`getComputedStyle(document.activeElement).outlineStyle!=='none'`));
    await capture('session-error-expanded-dark');

    await call('Page.navigate',{url:origin+'/scripts/fixtures/typography.html'});
    await waitFor(`!!document.querySelector('.uplot canvas')`);
    check('Plot HTML legend uses Inter at 12px',await evaluate(`(()=>{const s=getComputedStyle(document.querySelector('.u-legend'));return s.fontSize==='12px'&&s.fontFamily.includes('Inter');})()`));
    check('Plot canvas axes use shared UI tokens',await evaluate(`window.plotFonts.some(font=>font.includes('12px')&&font.includes('Inter'))`));
    await clickText('Expand backend console');
    await waitFor(`!!document.querySelector('pre')`);
    check('Console logs retain 12px monospace and wrapping',await evaluate(`(()=>{const s=getComputedStyle(document.querySelector('pre'));return s.fontSize==='12px'&&s.fontFamily.includes('monospace')&&s.whiteSpace==='pre-wrap';})()`));
    await capture('plot-dark');
    await call('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:2,mobile:false});
    await capture('plot-dark-dpr2');
    await call('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});

    // Serve the built app below a prefix to exercise the shipped relative asset paths.
    assetServer=createServer(async(req,res)=>{
      try {
        const relative=new URL(req.url,'http://localhost').pathname.replace(/^\/studio\//,'');
        const file=path.resolve('dist',relative||'index.html');
        if(!file.startsWith(path.resolve('dist')+path.sep)) throw Error('Invalid fixture path');
        const type={'.html':'text/html','.css':'text/css','.js':'text/javascript','.woff2':'font/woff2'}[path.extname(file)]??'application/octet-stream';
        res.writeHead(200,{'Content-Type':type});res.end(await readFile(file));
      } catch {res.writeHead(404);res.end();}
    });
    await new Promise(resolve=>assetServer.listen(0,'127.0.0.1',resolve));
    const prefix='http://127.0.0.1:'+assetServer.address().port+'/studio/';
    await call('Page.navigate',{url:prefix});
    await waitFor(`document.documentElement?.dataset.uiFont==='Inter' && !!document.querySelector('.inspector')`);
    check('Built app loads Inter below /studio/ without absolute-root font paths',fontRequests.includes(prefix+'fonts/InterVariable.woff2'));
    check('All application font requests stay on the application origin',fontRequests.every(url=>url.startsWith(origin+'/')||url.startsWith(prefix)));
    evidence.fontRequests=[...fontRequests];
    await call('Network.clearBrowserCache');
    await call('Network.setCacheDisabled',{cacheDisabled:true});
    await call('Fetch.enable',{patterns:[{urlPattern:'*InterVariable.woff2*'}]});
    await call('Page.navigate',{url:prefix+'?font-failure'});
    await waitFor(`document.documentElement?.dataset.uiFont==='fallback' && !!document.querySelector('.inspector')`);
    check('Failed local font request retains a usable fallback interface');
    await call('Fetch.disable');
    const pickerCss=await loadPickerTypography(process.cwd());
    await call('Network.emulateNetworkConditions',{offline:true,latency:0,downloadThroughput:0,uploadThroughput:0});
    await call('Page.navigate',{url:'data:text/html,'+encodeURIComponent('<style>'+pickerCss+'</style><p style="font-family:var(--font-ui)">Inter µs Ω →</p>')});
    await waitFor(`document.fonts.load('400 14px Inter').then(faces=>faces.length===1)`);
    check('Desktop picker embedded Inter loads with networking completely offline');
    check('No browser runtime errors',browserErrors.length===0);
  }
  evidence.errors=browserErrors;
  console.log('PASS: '+evidence.checks.length+' typography browser checks; screenshots: '+output);
  await writeFile(path.join(output,evidence.phase+'-acceptance.json'),JSON.stringify(evidence,null,2)+'\n');
} finally {
  await new Promise(resolve=>assetServer?assetServer.close(resolve):resolve());
  socket?.close();
  browser.kill('SIGTERM');
  await pause(300);
  await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
