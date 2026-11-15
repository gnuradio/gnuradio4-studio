// Run against `npm run dev`: node scripts/workspace-recovery-acceptance.mjs
// Uses isolated browser/Electron profiles, a test backend, and Chrome DevTools.
// No real user files or runtime sessions are changed.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const repo = process.cwd();
const origin = process.env.STUDIO_URL ?? 'http://127.0.0.1:5173';
const chrome = process.env.CHROME_PATH ?? '/usr/bin/google-chrome';
const root = await mkdtemp('/tmp/studio-workspace-test-');
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const children = new Set();
const outputs = new Map();
const checks = [];
const fixture = createServer((req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(req.url === '/blocks' ? { blocks: [] } : { sessions: [] }));
});
await new Promise((resolve) => fixture.listen(0, '127.0.0.1', resolve));
const backend = `http://127.0.0.1:${fixture.address().port}`;
let menuRequestId = 0;

// Test-only main-process bridge: inspect and click real native menu items.
async function nativeMenu(action = 'snapshot', value) {
  const id = ++menuRequestId;
  await writeFile(path.join(root, 'menu-request.json'), JSON.stringify({ id, action, value }));
  for (let i = 0; i < 100; i++) {
    try {
      const response = JSON.parse(await readFile(path.join(root, 'menu-response.json'), 'utf8'));
      if (response.id === id) {
        if (response.error) throw Error(response.error);
        return response.result;
      }
    } catch (error) { if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error; }
    await pause(50);
  }
  throw Error('Native menu bridge timed out.');
}

async function launch(binary, args, env) {
  const child = spawn(binary, args, { cwd: repo, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  children.add(child);
  outputs.set(child, '');
  for (const stream of [child.stdout, child.stderr]) stream.on('data', (data) => outputs.set(child, outputs.get(child) + data));
  child.on('exit', () => children.delete(child));
  return child;
}
async function connect(profile, child) {
  let port;
  for (let i = 0; i < 200; i++) {
    if (child.exitCode !== null) throw new Error(`Exited ${child.exitCode}: ${outputs.get(child)}`);
    try { port = (await readFile(path.join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]; break; }
    catch { await pause(100); }
  }
  assert.ok(port, outputs.get(child));
  let target;
  for (let i = 0; i < 100; i++) {
    const targets = await fetch(`http://127.0.0.1:${port}/json/list`).then((r) => r.json());
    target = targets.find((item) => item.type === 'page' && item.url !== 'devtools://devtools/bundled/inspector.html');
    if (target) break;
    await pause(100);
  }
  assert.ok(target, 'Renderer debug target exists');
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  const pending = new Map();
  let seq = 0;
  socket.onmessage = ({ data }) => {
    const message = JSON.parse(data);
    if (message.method === 'Page.javascriptDialogOpening') void call('Page.handleJavaScriptDialog', { accept: true });
    if (!message.id) return;
    const item = pending.get(message.id);
    if (!item) return;
    pending.delete(message.id);
    message.error ? item.reject(Error(JSON.stringify(message.error))) : item.resolve(message.result);
  };
  const call = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++seq;
    const timer = setTimeout(() => { pending.delete(id); reject(Error(`CDP timeout: ${method}`)); }, 15000);
    pending.set(id, { resolve: (value) => { clearTimeout(timer); resolve(value); }, reject: (error) => { clearTimeout(timer); reject(error); } });
    socket.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async (expression) => {
    let result;
    try { result = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); }
    catch (error) { throw Error(`${error.message}\nWhile evaluating: ${expression.slice(-350)}`); }
    if (result.exceptionDetails) throw Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
    return result.result.value;
  };
  const waitFor = async (expression) => {
    for (let i = 0; i < 150; i++) {
      try { if (await evaluate(expression)) return; } catch { /* navigation */ }
      await pause(100);
    }
    throw Error(`Condition failed: ${expression}\n${await evaluate('document.body.outerHTML.slice(0,12000)')}\n${outputs.get(child)}`);
  };
  await call('Page.enable');
  await call('Runtime.enable');
  return { call, evaluate, waitFor, socket };
}
const imports = `
  const { useGraphTabsStore: tabs } = await import('/src/features/graph-tabs/store/graphTabsStore.ts');
  const { useEditorStore: editor } = await import('/src/features/graph-editor/store/editorStore.ts');
  const { serializeEditorSnapshot: serialize } = await import('/src/features/document-file/document-serialization.ts');
  const { createDocumentPersistenceService: persistence } = await import('/src/features/document-file/document-persistence-service.ts');
  const { detectDocumentPersistenceCapabilities: capabilities } = await import('/src/features/document-file/document-persistence-capabilities.ts');
`;
const state = `(async()=>JSON.stringify((await import('/src/features/graph-tabs/store/graphTabsStore.ts')).useGraphTabsStore.getState().tabs.map(t => ({name:t.title, dirty:t.document.isDirty, text:t.snapshot.nodes[0]?.parameters.text.value}))))()`;
async function ready(cdp) {
  await cdp.waitFor(`document.body.innerText.includes('+ New Tab')`);
  await cdp.waitFor(`(async()=>{ const m=await import('/src/features/graph-tabs/store/graphTabsStore.ts'); return m.useGraphTabsStore.getState().initialized; })()`);
  // Let Vite finish dependency discovery before issuing file-picker actions.
  await pause(500);
}
async function prepare(cdp, native) {
  await cdp.evaluate(`(async () => { ${imports}
    const s = tabs.getState();
    const first = s.tabs[0];
    const base = { metadata:{name:'restored.gr4s'}, nodes:[{instanceId:'note', blockTypeId:'studio::Note', displayName:'Note', position:{x:20,y:30}, parameters:{text:{value:'saved',bindingKind:'literal'}}}], edges:[] };
    let identity;
    if (${native}) {
      const opened = await persistence().openDocument(capabilities());
      if (opened.kind !== 'success') throw Error(JSON.stringify(opened));
      identity = opened.value.documentIdentity;
    } else {
      const directory = await navigator.storage.getDirectory();
      const handle = await directory.getFileHandle('restored.gr4s', {create:true});
      const writable = await handle.createWritable(); await writable.write(serialize(base).content); await writable.close();
      identity = {...first.document, displayName:'restored.gr4s',isUntitled:false,sourceKind:'file_handle',fileHandle:handle,hasWritableBacking:true,lastPersistedContentHash:serialize(base).contentHash};
    }
    s.setTabDocument(first.id,identity);
    s.updateTabSnapshot(first.id,base,{dirty:false});
    editor.getState().replaceGraph(base);
    const second = s.createTab();
    const third = s.createTab();
    s.closeTab(third.id);
    s.setActiveTab(first.id);
  })()`);
  await cdp.waitFor(`(async()=>{ ${imports} return tabs.getState().tabs.length===2 && editor.getState().nodes[0]?.parameters.text.value==='saved'; })()`);
  await cdp.evaluate(`(async()=>{ ${imports} const s=editor.getState(); s.updateNodeParameter('note','text','unsaved recovered text'); })()`);
}
async function checkRecentMenus(cdp, native) {
  for (let index = 0; index < 12; index++) {
    const name = `recent-${index}.gr4s`;
    const content = await cdp.evaluate(`(async()=>{ ${imports} return serialize(editor.getState().getGraphSnapshot()).content; })()`);
    if (native) {
      const file = path.join(root, name);
      await writeFile(file, content);
      await writeFile(path.join(root, 'selected-document.txt'), file);
    } else {
      await cdp.evaluate(`(async()=>{
        const directory=await navigator.storage.getDirectory();
        const handle=await directory.getFileHandle(${JSON.stringify(name)},{create:true});
        const writable=await handle.createWritable(); await writable.write(${JSON.stringify(content)}); await writable.close();
        window.showOpenFilePicker=async()=>[handle];
      })()`);
    }
    await cdp.waitFor(`(async()=>{ const {studioCommands}=await import('/src/lib/commands/studio-commands.ts'); return studioCommands.state().open?.enabled; })()`);
    await cdp.evaluate(`(async()=>{ const {studioCommands}=await import('/src/lib/commands/studio-commands.ts'); await studioCommands.execute('open'); })()`);
    await cdp.waitFor(`document.title.includes(${JSON.stringify(name)})`);
  }
  const browserLabels = `Array.from(document.querySelectorAll('[data-recent-documents-menu] button')).filter(b=>b.title).map(b=>b.textContent.trim())`;
  const showBrowserMenu = async () => {
    await cdp.evaluate(`(() => {
      const file=document.querySelector('details[data-file-menu]'); file.open=true;
      document.querySelector('details[data-recent-documents-menu]').open=true;
    })()`);
    await cdp.waitFor(`(${browserLabels}).length===10`);
  };
  const expected=Array.from({length:10},(_,index)=>`recent-${11-index}.gr4s`);
  let before;
  if (native) {
    for (let i=0;i<50;i++) {
      before=await nativeMenu();
      if (before.files.length===10 && before.files[0].startsWith(expected[0])) break;
      await pause(50);
    }
    assert.deepEqual(before.files.map(label=>label.split(' — ')[0]),expected);
    await nativeMenu('recent',9);
  } else {
    await showBrowserMenu();
    await cdp.waitFor(`(${browserLabels})[0]==='recent-11.gr4s'`);
    assert.deepEqual(await cdp.evaluate(browserLabels),expected);
    await cdp.evaluate(`document.querySelectorAll('[data-recent-documents-menu] button')[9].click()`);
  }
  await cdp.waitFor(`document.title.includes('recent-2.gr4s')`);
  const count=await cdp.evaluate(`(async()=>{ ${imports} return tabs.getState().tabs.length; })()`);
  if (native) {
    await waitForNativeRecentMenu('recent-2.gr4s');
    assert.equal((await nativeMenu()).openCount,before.openCount,'Recent selection must not open a file picker.');
    await rm(path.join(root,'recent-2.gr4s'));
    await nativeMenu('recent',0);
    await cdp.waitFor(`document.body.innerText.includes('ENOENT')`);
    await nativeMenu('command','manageRecent');
  } else {
    await showBrowserMenu();
    await cdp.waitFor(`(${browserLabels})[0]==='recent-2.gr4s'`);
    assert.equal((await cdp.evaluate(browserLabels))[0],'recent-2.gr4s');
    await cdp.evaluate(`window.savedRequestPermission=FileSystemFileHandle.prototype.requestPermission; FileSystemFileHandle.prototype.requestPermission=async()=> 'denied'`);
    await cdp.evaluate(`document.querySelectorAll('[data-recent-documents-menu] button')[0].click()`);
    await cdp.waitFor(`document.body.innerText.includes('not granted')`);
    await cdp.evaluate(`FileSystemFileHandle.prototype.requestPermission=window.savedRequestPermission`);
    await showBrowserMenu();
    await cdp.evaluate(`Array.from(document.querySelectorAll('[data-recent-documents-menu] button')).find(b=>b.textContent.includes('Manage Recent')).click()`);
  }
  await cdp.waitFor(`document.querySelector('dialog[open]')?.innerText.includes('Manage Recent')`);
  assert.equal(await cdp.evaluate(`(async()=>{ ${imports} return tabs.getState().tabs.length; })()`),count,'Failed opens must preserve open tabs.');
  if (native) assert.equal((await nativeMenu()).enabled,false,'Modal management must disable the native submenu.');
  await cdp.evaluate(`Array.from(document.querySelectorAll('dialog[open] button')).find(b=>b.textContent==='Close').click()`);
  await cdp.waitFor(`!document.querySelector('dialog[open]')`);
  if (native) {
    await nativeMenu('command','clearRecent');
    for (let i=0;i<50;i++) { if ((await nativeMenu()).files[0]==='No recent files') break; await pause(50); }
    const empty=await nativeMenu();
    assert.deepEqual(empty.files,['No recent files']);
    assert.equal(empty.clearEnabled,false); assert.equal(empty.manageEnabled,true);
    assert.ok((await readFile(path.join(root,'recent-11.gr4s'),'utf8')).length>0);
  } else {
    await showBrowserMenu();
    await cdp.evaluate(`Array.from(document.querySelectorAll('[data-recent-documents-menu] button')).find(b=>b.textContent==='Clear Recent').click()`);
    await cdp.evaluate(`document.querySelector('details[data-file-menu]').open=true; document.querySelector('details[data-recent-documents-menu]').open=true`);
    await cdp.waitFor(`document.querySelector('[data-recent-documents-menu]').innerText.includes('No recent files')`);
    assert.equal(await cdp.evaluate(`Array.from(document.querySelectorAll('[data-recent-documents-menu] button')).find(b=>b.textContent==='Clear Recent').disabled`),true);
  }
  checks.push(`${native?'Electron native':'Browser HTML'} recent submenu: ten-file limit, MRU reorder, direct open, failed-open recovery, Manage Recent modal, and Clear Recent.`);
}
async function waitForNativeRecentMenu(first) {
  for (let i=0;i<50;i++) { if ((await nativeMenu()).files[0]?.startsWith(first)) return; await pause(50); }
  throw Error('Recent native menu did not refresh.');
}
async function stop(child, cdp, native) {
  if (native) {
    // Native window.close triggers real beforeunload and will-prevent-unload.
    void cdp.evaluate('window.close()').catch(() => {});
  } else {
    await cdp.call('Page.navigate', {url:'about:blank'});
    await cdp.waitFor(`location.href==='about:blank' && document.readyState==='complete'`);
    await cdp.call('Browser.close').catch(() => {});
  }
  for (let i=0;i<100 && child.exitCode===null;i++) await pause(100);
  assert.notEqual(child.exitCode,null,`Application did not close: ${outputs.get(child)}`);
  cdp.socket.close();
}
try {
  const chromeProfile = path.join(root,'browser');
  const browser = () => launch(chrome,['--headless=new','--no-sandbox','--disable-gpu',`--user-data-dir=${chromeProfile}`,'--remote-debugging-port=0','about:blank']);
  let child=await browser(); let cdp=await connect(chromeProfile,child);
  await cdp.call('Page.navigate',{url:origin}); await ready(cdp);
  await prepare(cdp,false);
  await cdp.waitFor(`(async()=>{ ${imports} return tabs.getState().tabs[0].document.isDirty; })()`);
  // Close immediately after the edit: exercise final checkpoint without waiting for the debounce.
  await stop(child,cdp,false);
  await rm(path.join(chromeProfile,'DevToolsActivePort'),{force:true});
  child=await browser(); cdp=await connect(chromeProfile,child);
  await cdp.call('Page.navigate',{url:origin}); await ready(cdp);
  await cdp.waitFor(`(async()=>{ ${imports} return tabs.getState().tabs[0].snapshot.nodes[0]?.parameters.text.value==='unsaved recovered text'; })()`);
  await cdp.waitFor(`document.body.innerText.includes('unsaved recovered text')`);
  let restored=JSON.parse(await cdp.evaluate(state));
  assert.equal(restored.length,2); assert.equal(restored[0].name,'restored.gr4s'); assert.equal(restored[0].dirty,true);
  assert.equal(await cdp.evaluate(`(async()=>{ ${imports} return tabs.getState().activeTabId===tabs.getState().tabs[0].id; })()`),true);
  assert.equal(await cdp.evaluate(`(async()=>{ ${imports} const t=tabs.getState().tabs[0]; const r=await persistence().saveCurrentDocument(t.document,t.snapshot,capabilities()); return r.kind==='success' && (await (await t.document.fileHandle.getFile()).text()).includes('unsaved recovered text'); })()`),true);
  checks.push('Browser: full process restart restores tabs, selection, dirty edits, real IndexedDB file handle, and Save in place; closed tab stays closed.');
  await checkRecentMenus(cdp,false);
  await stop(child,cdp,false);

  const nativeProfile=path.join(root,'electron');
  const nativeFile=path.join(root,'restored.gr4s');
  const base={format:'gr4-studio.graph',version:1,metadata:{name:'restored.gr4s'},graph:{nodes:[{id:'note',blockType:'studio::Note',title:'Note',executionMode:'active',rotation:0,position:{x:20,y:30},parameters:{text:{kind:'literal',value:'saved'}}}],edges:[]}};
  await writeFile(nativeFile,JSON.stringify(base));
  const harness=path.join(root,'electron-harness.mjs');
  await writeFile(harness,`
    import {app,dialog,Menu,BrowserWindow} from 'electron';
    import fs from 'node:fs';
    import {createServer} from ${JSON.stringify(pathToFileURL(path.join(repo,'node_modules/vite/dist/node/index.js')).href)};
    app.setName('gr4-studio'); app.setPath('userData',${JSON.stringify(nativeProfile)}); app.setAppPath(${JSON.stringify(repo)});
    dialog.showMessageBoxSync=()=>1;
    let openCount=0;
    dialog.showOpenDialog=async()=>{ openCount++; return {filePaths:[fs.existsSync(${JSON.stringify(path.join(root,'selected-document.txt'))})
      ? fs.readFileSync(${JSON.stringify(path.join(root,'selected-document.txt'))},'utf8') : ${JSON.stringify(nativeFile)}]}; };
    setInterval(()=>{
      const requestFile=${JSON.stringify(path.join(root,'menu-request.json'))};
      if(!fs.existsSync(requestFile)) return;
      let request;
      try {
        request=JSON.parse(fs.readFileSync(requestFile,'utf8')); fs.rmSync(requestFile);
        const win=BrowserWindow.getAllWindows()[0]; win?.focus();
        const menu=Menu.getApplicationMenu(); const recent=menu.getMenuItemById('openRecent');
        if(request.action==='recent') recent.submenu.items[request.value].click();
        if(request.action==='command') menu.getMenuItemById(request.value).click();
        const result={ enabled:recent.enabled, openCount, files:recent.submenu.items.filter(item=>!item.id&&item.type!=='separator').map(item=>item.label),
          clearEnabled:menu.getMenuItemById('clearRecent').enabled, manageEnabled:menu.getMenuItemById('manageRecent').enabled };
        fs.writeFileSync(${JSON.stringify(path.join(root,'menu-response.json'))},JSON.stringify({id:request.id,result}));
      } catch(error) { if(request) fs.writeFileSync(${JSON.stringify(path.join(root,'menu-response.json'))},JSON.stringify({id:request.id,error:error.message})); }
    },25);
    process.env.VITE_CONTROL_PLANE_BASE_URL=${JSON.stringify(backend)};
    process.env.GR4_STUDIO_DEV_SERVER_URL='pending';
    const server=await createServer({root:${JSON.stringify(repo)},cacheDir:${JSON.stringify(path.join(nativeProfile,'vite-cache'))},
      configFile:${JSON.stringify(path.join(repo,'vite.config.ts'))},server:{host:'127.0.0.1',port:20000+Math.floor(Math.random()*30000)}});
    await server.listen();
    process.env.GR4_STUDIO_DEV_SERVER_URL='http://127.0.0.1:'+server.httpServer.address().port;
    process.argv.push('--remote='+${JSON.stringify(backend)});
    await import(${JSON.stringify(pathToFileURL(path.join(repo,'desktop/main.mjs')).href)});
  `);
  const electron=()=>launch(path.join(repo,'node_modules/electron/dist/electron'),['--no-sandbox','--disable-gpu','--remote-debugging-port=0',harness]);
  child=await electron(); cdp=await connect(nativeProfile,child); await ready(cdp);
  const firstOrigin=await cdp.evaluate('location.origin');
  await prepare(cdp,true);
  await cdp.waitFor(`(async()=>{ ${imports} return tabs.getState().tabs[0].document.isDirty; })()`);
  await stop(child,cdp,true);
  assert.ok((await readFile(path.join(nativeProfile,'state/workspace.json'),'utf8')).includes('unsaved recovered text'));
  await rm(path.join(nativeProfile,'DevToolsActivePort'),{force:true});
  child=await electron(); cdp=await connect(nativeProfile,child); await ready(cdp);
  const secondOrigin=await cdp.evaluate('location.origin'); assert.notEqual(firstOrigin,secondOrigin);
  await cdp.waitFor(`(async()=>{ ${imports} return tabs.getState().tabs[0].snapshot.nodes[0]?.parameters.text.value==='unsaved recovered text'; })()`);
  await cdp.waitFor(`document.body.innerText.includes('unsaved recovered text')`);
  restored=JSON.parse(await cdp.evaluate(state)); assert.equal(restored.length,2); assert.equal(restored[0].dirty,true);
  assert.equal(await cdp.evaluate(`(async()=>{ ${imports} return tabs.getState().activeTabId===tabs.getState().tabs[0].id; })()`),true);
  const saveResult=await cdp.evaluate(`(async()=>{ ${imports} const t=tabs.getState().tabs[0]; return {result:await persistence().saveCurrentDocument(t.document,t.snapshot,capabilities()),document:t.document,location:location.href}; })()`);
  assert.equal(saveResult.result.kind,'success',JSON.stringify(saveResult));
  assert.ok((await readFile(nativeFile,'utf8')).includes('unsaved recovered text'));
  checks.push('Electron: real close/restart on a different UI port restores dirty tabs and selection, keeps closed tabs closed, rebinds native handles, and Save writes the original file.');
  await checkRecentMenus(cdp,true);
  await stop(child,cdp,true);
  console.log(JSON.stringify({checks},null,2));
} catch(error) {
  console.error(JSON.stringify({completed:checks}));
  console.error(error);
  for(const child of children) console.error(outputs.get(child));
  process.exitCode=1;
} finally {
  for(const child of children) child.kill('SIGKILL');
  fixture.close();
  await pause(500);
  await rm(root,{recursive:true,force:true,maxRetries:5});
}
