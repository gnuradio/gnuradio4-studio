// Run against `npm run dev`: node scripts/theme-browser-acceptance.mjs
// Uses Chrome's built-in DevTools protocol; no browser-test dependency required.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const origin = process.env.STUDIO_URL ?? 'http://127.0.0.1:5173';
const chrome = process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const output = process.env.THEME_EVIDENCE_DIR ?? 'docs/evidence/theme-1';
const profile = await mkdtemp(path.join(tmpdir(), 'studio-theme-chrome-'));
const browser = spawn(chrome, ['--headless=new', '--no-first-run', '--no-default-browser-check',
  '--disable-background-networking', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'],
{ stdio: ['ignore', 'ignore', 'pipe'] });
let chromeLog = '';
browser.stderr.on('data', (data) => { chromeLog = (chromeLog + data.toString()).slice(-6000); });
browser.on('error', (error) => { console.error(error); });
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let socket;
const evidence = { browser: '', fixtures: 'Offline reflected block catalog and empty sessions; no live runtime execution.', checks: [], surfaces: {} };
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
  socket.onmessage = ({ data }) => {
    const message = JSON.parse(data);
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
    const button = [...document.querySelectorAll('button,summary')].find(el => el.textContent.trim() === ${JSON.stringify(text)} || el.title === ${JSON.stringify(text)});
    if (!button) throw Error('Missing control: ' + ${JSON.stringify(text)});
    button.click();
  })()`);
  const appearance = () => evaluate(`document.querySelector('section[aria-label="Appearance"]').closest('details').open = true`);
  const select = async (id) => {
    await appearance();
    await evaluate(`(() => { const el = document.querySelector('select[aria-label="Theme"]'); el.value = ${JSON.stringify(id)}; el.dispatchEvent(new Event('change', { bubbles: true })); })()`);
    await waitFor(`document.documentElement.dataset.theme === ${JSON.stringify(id)}`);
  };
  const upload = async (definition, filename = 'acceptance.gr4stheme') => {
    await appearance();
    const text = typeof definition === 'string' ? definition : JSON.stringify(definition);
    await evaluate(`(() => {
      const input = document.querySelector('input[type=file][accept=".gr4stheme"]');
      const transfer = new DataTransfer();
      transfer.items.add(new File([${JSON.stringify(text)}], ${JSON.stringify(filename)}, { type: 'application/json' }));
      input.files = transfer.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
    })()`);
    await waitFor(`!document.querySelector('section[aria-label="Appearance"] fieldset').disabled`);
  };

  await call('Page.enable');
  await call('Runtime.enable');
  evidence.browser = (await call('Browser.getVersion')).product;
  await call('Emulation.setDeviceMetricsOverride', { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false });
  // Test-only HTTP fixtures. Production code remains connected to the real backend.
  await call('Page.addScriptToEvaluateOnNewDocument', { source: `
    const catalog = [
      { id: 'gr::blocks::basic::SignalGenerator<float32>', name: 'SignalGenerator', category: 'Basic',
        outputs: [{ name: 'out', type: 'float32' }], parameters: [{ name: 'frequency', type: 'float32', default: 25 }, { name: 'sample_rate', type: 'float32', default: 1000 }] },
      { id: 'gr::blocks::math::Multiply<float32>', name: 'Multiply', category: 'Math',
        inputs: [{ name: 'in', type: 'float32' }], outputs: [{ name: 'out', type: 'float32' }], parameters: [{ name: 'gain', type: 'float32', default: 2 }] },
      { id: 'gr::studio::StudioSeriesSink<float32>', name: 'StudioSeriesSink', category: 'Studio',
        inputs: [{ name: 'in', type: 'float32' }], parameters: [{ name: 'transport', type: 'string', default: 'http_poll' }] },
      { id: 'gr::blocks::basic::MessageSink', name: 'MessageSink', category: 'Basic', inputs: [{ name: 'in', type: 'message' }] }
    ];
    const actualFetch = window.fetch;
    window.fetch = (input, init) => {
      const url = new URL(typeof input === 'string' ? input : input.url, location.href);
      if (url.pathname === '/api/blocks') return Promise.resolve(Response.json(catalog));
      if (url.pathname.startsWith('/api/blocks/')) {
        const block = catalog.find(entry => entry.id === decodeURIComponent(url.pathname.slice('/api/blocks/'.length)));
        return Promise.resolve(block ? Response.json(block) : Response.json({ error: 'Unknown block' }, { status: 404 }));
      }
      if (url.pathname === '/api/sessions') return Promise.resolve(Response.json([]));
      return actualFetch(input, init);
    };
  ` });
  const navigate = async () => {
    await call('Page.navigate', { url: origin });
    await waitFor(`document.documentElement.dataset.themeReady === 'true' && !!document.querySelector('select[aria-label="Theme"]')`);
  };
  await navigate();
  check('Four built-in themes registered', await evaluate(`document.querySelector('select[aria-label="Theme"]').options.length === 4`));
  await evaluate(`(async () => {
    const { useEditorStore } = await import('/src/features/graph-editor/store/editorStore.ts');
    const makeNode = (id, type, name, x, y, parameters = {}, executionMode = 'active') => ({
      instanceId: id, blockTypeId: type, displayName: name, position: {x,y}, rotation: 0, executionMode,
      parameters: Object.fromEntries(Object.entries(parameters).map(([key,value]) => [key, { value: String(value), bindingKind: 'literal' }]))
    });
    useEditorStore.getState().replaceGraph({ metadata: {name: 'Theme acceptance diagram.gr4s'}, nodes: [
      makeNode('signal', 'gr::blocks::basic::SignalGenerator<float32>', 'SignalGenerator', 70, 60, {frequency: 25, sample_rate: 1000}),
      makeNode('gain', 'gr::blocks::math::Multiply<float32>', 'Multiply', 430, 60, {gain: 2}),
      makeNode('sink', 'gr::studio::StudioSeriesSink<float32>', 'StudioSeriesSink', 790, 60, {transport: 'http_poll'}),
      makeNode('disabled', 'gr::blocks::math::Multiply<float32>', 'Disabled stage', 70, 300, {gain: 0}, 'disabled'),
      makeNode('bypassed', 'gr::blocks::math::Multiply<float32>', 'Bypassed stage', 430, 300, {gain: 1}, 'bypassed'),
      makeNode('message', 'gr::blocks::basic::MessageSink', 'MessageSink', 790, 300),
      makeNode('note', 'studio::Note', 'Note', 70, 540, {text: ['THEME-1 • Same graph, four themes', 'Signal → Gain → Series sink', 'Dashed: invalid connection / disabled', 'Double outline: bypassed'].join(String.fromCharCode(10))}),
      makeNode('virtual', 'studio::VirtualSink', 'Virtual route', 430, 550, {stream_id: 'monitor'}),
      makeNode('missing', 'example::MissingBlock', 'Missing block', 790, 540),
    ], edges: [
      {id:'signal-gain',sourceInstanceId:'signal',targetInstanceId:'gain',sourcePort:'out',targetPort:'in'},
      {id:'gain-sink',sourceInstanceId:'gain',targetInstanceId:'sink',sourcePort:'out',targetPort:'in'},
      {id:'disabled-bypassed',sourceInstanceId:'disabled',targetInstanceId:'bypassed',sourcePort:'out',targetPort:'in'},
      {id:'invalid-message',sourceInstanceId:'bypassed',targetInstanceId:'message',sourcePort:'out',targetPort:'in'}
    ]});
  })()`);
  await waitFor(`document.querySelectorAll('.studio-block').length === 9 && document.querySelectorAll('.react-flow__edge').length === 4`);
  await pause(300);
  await clickText('Fit view');
  await pause(250);
  const point = await evaluate(`(() => {const box = document.querySelector('[data-id="gain"] .studio-block-header').getBoundingClientRect();return {x:box.x+box.width/2,y:box.y+box.height/2};})()`);
  await call('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', clickCount: 1 });
  await call('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'left', clickCount: 1 });
  await waitFor(`document.querySelector('[data-id="gain"] .studio-block').dataset.selected === 'true'`);

  await mkdir(output, { recursive: true });
  const geometry = () => evaluate(`JSON.stringify([...document.querySelectorAll('.react-flow__node')].map(el=>({id:el.dataset.id,transform:el.style.transform,width:el.offsetWidth,height:el.offsetHeight})))`);
  const before = await geometry();
  await evaluate(`window.themeNavigationMarker = 1`);
  for (const id of ['light', 'dark', 'high-contrast', 'paper']) {
    await select(`builtin.${id}`);
    await evaluate(`document.querySelector('section[aria-label="Appearance"]').closest('details').open = false`);
    await pause(200);
    check(`${id}: theme switch preserves graph geometry`, await geometry() === before);
    check(`${id}: immediate switch without reload`, await evaluate(`window.themeNavigationMarker === 1`));
    const surfaces = await evaluate(`(async () => {
      const {themeManager} = await import('/src/features/themes/theme-store.ts');
      const tokens = themeManager.store.getState().active.tokens;
      const rgb = hex => 'rgb(' + [1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)).join(', ') + ')';
      const style = sel => getComputedStyle(document.querySelector(sel));
      const checks = {
        canvas: style('.react-flow').backgroundColor === rgb(tokens['canvas.background']),
        block: style('[data-id="gain"] .studio-block').backgroundColor === rgb(tokens['block.background']),
        blockText: style('[data-id="gain"] .studio-block').color === rgb(tokens['block.text']),
        header: style('[data-id="gain"] .studio-block-header').backgroundColor === rgb(tokens['block.header']),
        border: style('[data-id="signal"] .studio-block').borderColor === rgb(tokens['block.border']),
        selected: style('[data-id="gain"] .studio-block').outlineColor === rgb(tokens['block.selected']),
        grid: style('.react-flow__background circle').fill === rgb(tokens['canvas.grid']),
        connection: style('[data-id="signal-gain"] .react-flow__edge-path').stroke === rgb(tokens['connection.default']),
        invalid: style('[data-id="invalid-message"] .react-flow__edge-path').stroke === rgb(tokens['connection.invalid']),
        errorPattern: style('[data-id="missing"] .studio-block').borderStyle === 'dashed',
        disabledPattern: style('[data-id="disabled"] .studio-block').borderStyle === 'dashed',
        bypassPattern: style('[data-id="bypassed"] .studio-block').borderStyle === 'double',
        panel: style('main > aside').backgroundColor === rgb(tokens['app.surface']),
        streamPort: style('[data-id="signal"] .react-flow__handle [aria-hidden="true"]').backgroundColor === rgb('#f08c00'),
        messagePort: style('[data-id="message"] .react-flow__handle [aria-hidden="true"]').backgroundColor === rgb('#9ca3af'),
      };
      return {checks, canvas: style('.react-flow').backgroundColor, block: style('[data-id="gain"] .studio-block').backgroundColor};
    })()`);
    evidence.surfaces[id] = surfaces;
    for (const [name, passed] of Object.entries(surfaces.checks)) check(`${id}: ${name}`, passed);
    const screenshot = await call('Page.captureScreenshot', { format: 'png' });
    await writeFile(path.join(output, `${id}.png`), Buffer.from(screenshot.data, 'base64'));
  }

  // Real IndexedDB/localStorage and UI imports are exercised in the browser.
  const definition = { schemaVersion: 1, id: 'acceptance.midnight', name: 'Acceptance Midnight', author: 'THEME-1',
    extends: 'builtin.dark', tokens: { 'canvas.background': '#101722', 'block.text': '#F0F4FA' } };
  await upload(definition);
  check('Import retains current selection', await evaluate(`document.documentElement.dataset.theme === 'builtin.paper'`));
  check('Import adds a selector entry', await evaluate(`!!document.querySelector('option[value="acceptance.midnight"]')`));
  await select(definition.id);
  await navigate();
  check('IndexedDB import and localStorage selection survive reload', await evaluate(`document.documentElement.dataset.theme === 'acceptance.midnight'`));
  await appearance();
  const exported = await evaluate(`(async () => {
    const {themeManager} = await import('/src/features/themes/theme-store.ts');
    return JSON.parse(themeManager.export('acceptance.midnight'));
  })()`);
  assert.deepEqual(exported, definition);
  check('Export round-trip preserves partial definition');
  const replacement = { ...definition, name: 'Replaced Midnight' };
  await upload(replacement);
  check('Duplicate import requests explicit confirmation', await evaluate(`!![...document.querySelectorAll('button')].find(el=>el.textContent === 'Replace Theme')`));
  check('Duplicate does not overwrite without confirmation', await evaluate(`document.querySelector('option[value="acceptance.midnight"]').textContent.includes('Acceptance Midnight')`));
  await clickText('Cancel');
  await upload(replacement);
  await clickText('Replace Theme');
  await waitFor(`document.querySelector('option[value="acceptance.midnight"]').textContent.includes('Replaced Midnight')`);
  check('Confirmed replacement updates existing theme');
  await upload({ ...definition, tokens: { 'app.text': 'url(https://example.com)' } });
  check('Unsafe import displays validation error', await evaluate(`document.querySelector('section[aria-label="Appearance"] [role="alert"]').textContent.includes('hex color')`));
  await clickText('Delete Theme');
  await waitFor(`document.documentElement.dataset.theme === 'builtin.dark'`);
  check('Deleting active import selects built-in default', await evaluate(`!document.querySelector('option[value="acceptance.midnight"]')`));
  await navigate();
  check('Deletion and fallback selection survive reload', await evaluate(`document.documentElement.dataset.theme === 'builtin.dark' && !document.querySelector('option[value="acceptance.midnight"]')`));
  await evaluate(`localStorage.setItem('gr4-studio.theme','missing.theme')`);
  await navigate();
  check('Missing saved theme falls back safely', await evaluate(`document.documentElement.dataset.theme === 'builtin.dark' && localStorage.getItem('gr4-studio.theme') === 'builtin.dark'`));
  // Persist corrupt data directly to exercise defensive startup validation.
  await evaluate(`new Promise((resolve,reject) => {
    const open = indexedDB.open('gr4-studio-themes',1);
    open.onsuccess = () => {
      const db = open.result; const tx = db.transaction('themes','readwrite');
      tx.objectStore('themes').put({id:'corrupt.theme',schemaVersion:1,tokens:{'app.text':'javascript:alert(1)'}});
      tx.oncomplete = () => {db.close();localStorage.setItem('gr4-studio.theme','corrupt.theme');resolve(true)};
      tx.onerror = reject;
    };open.onerror=reject;
  })`);
  await navigate();
  check('Corrupt persisted theme falls back safely', await evaluate(`document.documentElement.dataset.theme === 'builtin.dark' && document.querySelector('select[aria-label="Theme"]').options.length === 4`));
  await writeFile(path.join(output, 'acceptance.json'), JSON.stringify(evidence, null, 2) + '\n');
  console.log(`PASS: ${evidence.checks.length} browser checks; screenshots and report: ${output}`);
} finally {
  socket?.close();
  browser.kill('SIGTERM');
  await pause(300);
  await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
