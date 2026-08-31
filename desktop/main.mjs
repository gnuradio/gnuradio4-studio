import { app, BrowserWindow, Menu, dialog, ipcMain, shell } from 'electron';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { probeBackendReady, startDesktopAppServer } from './app-server.mjs';
import { createBackendConsoleBuffer, BACKEND_CONSOLE_MAX_CHARACTERS } from './backend-console.mjs';
import { readBackendLogTail, sanitizeBackendLogText } from './backend-diagnostics.mjs';
import { normalizeBackendUrl, parseLaunchArgs } from './launch-args.mjs';
import { buildLocalBackendEnvironment, startLocalBackend } from './local-backend.mjs';

const APP_NAME = 'gr4-studio';
const DEFAULT_BACKEND_URL = 'http://127.0.0.1:8080';
const RECENT_REMOTE_ENDPOINTS_FILE = 'recent-remote-endpoints.json';
const APP_ICON_CANDIDATES = ['apple-touch-icon.png', 'favicon-32x32.png', 'favicon-16x16.png', 'favicon.ico'];
const BACKEND_CONSOLE_FLUSH_INTERVAL_MS = 50;
const backendConsoleBuffer = createBackendConsoleBuffer();
let remotePickerResolve = null;
let mainWindow = null;
let remotePickerWindow = null;
const displayApplicationWindows = new Set();
const displayApplicationLaunchSnapshots = new Map();
let desktopAppServer = null;
let localBackend = null;
let localBackendExitMessage = null;
let mainStartUrl = null;
let shutdownPromise = null;
let shutdownComplete = false;
let pendingBackendConsoleText = '';
let pendingBackendConsoleReplace = false;
let backendConsoleFlushTimer = null;
let desktopBootStatus = {
  phase: 'starting',
  message: 'Preparing gr4-studio…',
  controlPlaneBaseUrl: DEFAULT_BACKEND_URL,
  backendMode: 'unknown',
  source: 'default',
  currentSessionRouting: 'app-api',
};

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function recentEndpointsPath() {
  return path.join(app.getPath('userData'), RECENT_REMOTE_ENDPOINTS_FILE);
}

async function loadRecentRemoteEndpoints() {
  try {
    const raw = await fs.readFile(recentEndpointsPath(), 'utf8');
    const parsed = JSON.parse(raw);
    const items = Array.isArray(parsed?.recentEndpoints) ? parsed.recentEndpoints : [];
    return items.map((item) => normalizeBackendUrl(String(item))).filter(Boolean);
  } catch {
    return [];
  }
}

async function saveRecentRemoteEndpoint(endpoint) {
  const normalized = normalizeBackendUrl(endpoint);
  if (!normalized) {
    return;
  }

  const recent = await loadRecentRemoteEndpoints();
  const next = [normalized, ...recent.filter((item) => item !== normalized)].slice(0, 8);
  await fs.mkdir(path.dirname(recentEndpointsPath()), { recursive: true });
  await fs.writeFile(recentEndpointsPath(), `${JSON.stringify({ recentEndpoints: next }, null, 2)}\n`, 'utf8');
}

async function resolveAppIconPath() {
  for (const candidate of APP_ICON_CANDIDATES) {
    const candidatePath = path.join(app.getAppPath(), candidate);
    try {
      await fs.access(candidatePath);
      return candidatePath;
    } catch {
      // Keep looking for the best available installed icon asset.
    }
  }

  return null;
}

function sendMenuCommand(command) {
  const targetWindow = BrowserWindow.getFocusedWindow() ?? mainWindow;
  if (!targetWindow) {
    return;
  }

  targetWindow.webContents.send('gr4-studio:menu-command', command);
}

function buildApplicationMenu() {
  return Menu.buildFromTemplate([
    {
      label: APP_NAME,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    {
      label: 'File',
      submenu: [
        {
          label: 'New',
          accelerator: 'CmdOrCtrl+N',
          click: () => sendMenuCommand('new'),
        },
        {
          label: 'Open...',
          accelerator: 'CmdOrCtrl+O',
          click: () => sendMenuCommand('open'),
        },
        { type: 'separator' },
        {
          label: 'Save',
          accelerator: 'CmdOrCtrl+S',
          click: () => sendMenuCommand('save'),
        },
        {
          label: 'Save As...',
          accelerator: 'Shift+CmdOrCtrl+S',
          click: () => sendMenuCommand('saveAs'),
        },
        {
          label: 'Rename...',
          accelerator: 'CmdOrCtrl+R',
          click: () => sendMenuCommand('rename'),
        },
      ],
    },
    {
      label: 'Edit',
      submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'delete' }, { role: 'selectAll' }],
    },
  ]);
}

function buildRemotePickerHtml(recentEndpoints, currentValue, appIconUrl) {
  const options = recentEndpoints
    .map((endpoint) => `<option value="${escapeHtml(endpoint)}">${escapeHtml(endpoint)}</option>`)
    .join('');
  const recentMarkup =
    recentEndpoints.length > 0
      ? `<label for="recent">Recent endpoints</label><select id="recent">${options}</select>`
      : `<p class="hint">No recent endpoints yet. Enter one manually.</p>`;

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Connect to gr4cp</title>
    <style>
      :root { color-scheme: dark; font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: linear-gradient(135deg, #09111f, #0f172a 55%, #111827); color: #e5eefb; }
  .card { width: min(560px, calc(100vw - 48px)); border: 1px solid rgba(148,163,184,.24); border-radius: 18px; padding: 24px; background: rgba(15,23,42,.94); box-shadow: 0 20px 60px rgba(0,0,0,.35); }
  .brand { display: flex; align-items: center; gap: 14px; margin-bottom: 18px; }
  .brand-mark { width: 40px; height: 40px; flex: 0 0 auto; }
  .brand-name { margin: 0; font-size: 20px; font-weight: 700; letter-spacing: 0.2em; text-transform: uppercase; }
      h1 { margin: 0 0 8px; font-size: 22px; }
      p { margin: 0 0 18px; color: #94a3b8; line-height: 1.5; }
      label { display: block; margin: 12px 0 8px; font-size: 13px; color: #cbd5e1; }
      input, select { width: 100%; box-sizing: border-box; border: 1px solid #334155; border-radius: 10px; background: #020617; color: #e5eefb; padding: 12px 14px; font-size: 14px; }
      input:focus, select:focus { outline: 2px solid #38bdf8; outline-offset: 2px; }
      .row { display: flex; gap: 12px; justify-content: flex-end; margin-top: 18px; }
      button { border: 0; border-radius: 10px; padding: 11px 16px; font-weight: 600; cursor: pointer; }
      .primary { background: #38bdf8; color: #082f49; }
      .secondary { background: #1e293b; color: #e2e8f0; }
      .hint { font-size: 12px; color: #64748b; }
      .stack { display: grid; gap: 8px; }
    </style>
  </head>
  <body>
    <div class="card">
      <div class="brand">
        <img class="brand-mark" src="${appIconUrl}" alt="" aria-hidden="true" />
        <div>
          <p class="brand-name">gr4-studio</p>
        </div>
      </div>
      <h1>Connect to a remote gr4cp</h1>
      <p>Choose a previously used endpoint or enter a new one.</p>
      <div class="stack">
        ${recentMarkup}
        <label for="endpoint">Endpoint</label>
        <input id="endpoint" type="url" value="${escapeHtml(currentValue)}" placeholder="http://127.0.0.1:8080" autofocus />
      </div>
      <div class="row">
        <button id="cancel" class="secondary" type="button">Cancel</button>
        <button id="connect" class="primary" type="button">Connect</button>
      </div>
    </div>
    <script>
      const endpoint = document.getElementById('endpoint');
      const recent = document.getElementById('recent');
      const connect = document.getElementById('connect');
      const cancel = document.getElementById('cancel');

      if (recent) {
        recent.addEventListener('change', () => {
          endpoint.value = recent.value;
        });
      }

      function submit() {
        window.remotePicker.submit(endpoint.value);
      }

      connect.addEventListener('click', submit);
      cancel.addEventListener('click', () => window.remotePicker.cancel());
      endpoint.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
          submit();
        }
      });
    </script>
  </body>
</html>`;
}

function openRemotePicker(recentEndpoints) {
  return new Promise((resolve, reject) => {
    remotePickerWindow = new BrowserWindow({
      width: 620,
      height: 420,
      resizable: false,
      modal: true,
      show: false,
      title: `Connect to ${APP_NAME}`,
      backgroundColor: '#0f172a',
      webPreferences: {
        preload: path.join(app.getAppPath(), 'desktop', 'remote-picker-preload.cjs'),
        contextIsolation: true,
        nodeIntegration: false,
      },
    });

    remotePickerResolve = resolve;
    remotePickerWindow.once('closed', () => {
      remotePickerWindow = null;
      if (remotePickerResolve) {
        remotePickerResolve(null);
        remotePickerResolve = null;
      }
    });

    const appIconUrl = pathToFileURL(path.join(app.getAppPath(), 'favicon-32x32.png')).toString();
    const html = buildRemotePickerHtml(recentEndpoints, recentEndpoints[0] ?? '', appIconUrl);
    remotePickerWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
    remotePickerWindow.once('ready-to-show', () => remotePickerWindow?.show());
    remotePickerWindow.on('unresponsive', () => {
      reject(new Error('Remote endpoint picker became unresponsive'));
    });
  });
}

ipcMain.handle('gr4-studio:remote-picker:submit', async (_event, endpoint) => {
  const normalized = normalizeBackendUrl(String(endpoint));
  if (!normalized) {
    throw new Error('Please enter a valid http or https endpoint.');
  }

  await saveRecentRemoteEndpoint(normalized);
  const resolve = remotePickerResolve;
  remotePickerResolve = null;
  resolve?.(normalized);
  BrowserWindow.fromWebContents(_event.sender)?.close();
  return normalized;
});

ipcMain.handle('gr4-studio:remote-picker:cancel', async () => {
  const resolve = remotePickerResolve;
  remotePickerResolve = null;
  resolve?.(null);
  BrowserWindow.fromWebContents(_event.sender)?.close();
  return null;
});

function resolveStartUrl() {
  return process.env.GR4_STUDIO_DEV_SERVER_URL || null;
}

function logDesktop(message) {
  console.info(`[gr4-studio] ${message}`);
}

function flushBackendConsoleOutput() {
  if (backendConsoleFlushTimer) {
    clearTimeout(backendConsoleFlushTimer);
    backendConsoleFlushTimer = null;
  }
  if (!pendingBackendConsoleText && !pendingBackendConsoleReplace) {
    return;
  }

  const snapshot = backendConsoleBuffer.snapshot();
  const payload = {
    cursor: snapshot.cursor,
    text: pendingBackendConsoleReplace ? snapshot.content : pendingBackendConsoleText,
    replace: pendingBackendConsoleReplace,
    truncated: snapshot.truncated,
    updatedAt: snapshot.updatedAt,
    running: Boolean(localBackend && !localBackend.getExitDetails()),
  };
  pendingBackendConsoleText = '';
  pendingBackendConsoleReplace = false;

  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('gr4-studio:control-plane-console:output', payload);
  }
}

function recordBackendConsoleOutput(entry) {
  const text = sanitizeBackendLogText(entry.text);
  if (!text) {
    return;
  }

  const result = backendConsoleBuffer.append(text, entry.receivedAt);
  pendingBackendConsoleText += text;
  if (result.didTruncate || pendingBackendConsoleText.length > BACKEND_CONSOLE_MAX_CHARACTERS) {
    pendingBackendConsoleText = '';
    pendingBackendConsoleReplace = true;
  }

  if (!backendConsoleFlushTimer) {
    backendConsoleFlushTimer = setTimeout(flushBackendConsoleOutput, BACKEND_CONSOLE_FLUSH_INTERVAL_MS);
  }
}

function localBackendExecutableName() {
  return process.platform === 'win32' ? 'gr4cp_server.exe' : 'gr4cp_server';
}

async function isInstallPrefix(candidate) {
  if (!candidate) {
    return false;
  }

  try {
    await fs.access(path.join(candidate, 'bin', localBackendExecutableName()));
    return true;
  } catch {
    return false;
  }
}

async function discoverInstallPrefix() {
  const configuredPrefix = process.env.GR4_STUDIO_PREFIX;
  if (configuredPrefix) {
    const resolved = path.resolve(configuredPrefix);
    if (await isInstallPrefix(resolved)) {
      return resolved;
    }
  }

  const startingPaths = [app.getAppPath(), process.resourcesPath, path.dirname(process.execPath)];
  const visited = new Set();
  for (const startingPath of startingPaths) {
    let candidate = path.resolve(startingPath);
    for (let depth = 0; depth < 10; depth += 1) {
      if (!visited.has(candidate)) {
        visited.add(candidate);
        if (await isInstallPrefix(candidate)) {
          return candidate;
        }
      }

      const parent = path.dirname(candidate);
      if (parent === candidate) {
        break;
      }
      candidate = parent;
    }
  }

  return null;
}

function formatManagedBackendExit(details) {
  if (details.error) {
    return details.error.message;
  }
  if (details.signal) {
    return `terminated by signal ${details.signal}`;
  }
  return `exited with status ${details.code ?? 'unknown'}`;
}

async function startManagedLocalBackend() {
  const prefix = await discoverInstallPrefix();
  const executable =
    process.env.GR4_STUDIO_CONTROL_PLANE_EXECUTABLE ||
    (prefix ? path.join(prefix, 'bin', localBackendExecutableName()) : localBackendExecutableName());
  const logPath = path.resolve(
    process.env.GR4_STUDIO_BACKEND_LOG_FILE ||
      (prefix
        ? path.join(prefix, 'var', 'logs', 'gr4cp_server.log')
        : path.join(app.getPath('logs'), 'gr4cp_server.log')),
  );
  const portFilePath = path.join(
    app.getPath('temp'),
    `gr4-studio-control-plane-${process.pid}-${randomUUID()}.port`,
  );

  if (prefix) {
    process.env.GR4_STUDIO_PREFIX = prefix;
  }
  process.env.GR4_STUDIO_BACKEND_LOG_FILE = logPath;
  logDesktop(`Starting managed local backend executable=${executable} log=${logPath}`);

  const backend = await startLocalBackend({
    executable,
    environment: buildLocalBackendEnvironment(prefix, process.env),
    logPath,
    portFilePath,
    onOutput: recordBackendConsoleOutput,
    onUnexpectedExit(details) {
      const message = `Managed local backend ${formatManagedBackendExit(details)}.`;
      localBackendExitMessage = message;
      console.error(`[gr4-studio] ${message}`);
      updateDesktopBootStatus({
        phase: 'error',
        message,
      });
    },
  });

  localBackend = backend;
  process.env.GR4_STUDIO_CONTROL_PLANE_BASE_URL = backend.baseUrl;
  logDesktop(`Using managed local backend ${backend.baseUrl} pid=${backend.processId ?? 'unknown'}`);
  return backend;
}

function updateDesktopBootStatus(patch) {
  desktopBootStatus = {
    ...desktopBootStatus,
    ...patch,
  };

  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('gr4-studio:boot-status', desktopBootStatus);
  }
}

function attachRendererDiagnostics(window, label) {
  const formatConsoleValue = (value) => {
    if (typeof value === 'string') {
      return value;
    }
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  };

  window.webContents.on('console-message', (...args) => {
    const maybeDetails = args.find((arg) => arg && typeof arg === 'object' && 'message' in arg);
    if (maybeDetails) {
      const severity = ['debug', 'info', 'warn', 'error'][maybeDetails.level] ?? 'log';
      const message = [
        maybeDetails.message,
        ...(Array.isArray(maybeDetails.args) ? maybeDetails.args.map(formatConsoleValue) : []),
      ].join(' ');
      console.info(`[gr4-studio][${label}:${severity}] ${message} (${maybeDetails.sourceId}:${maybeDetails.line})`);
      return;
    }

    const [, level, message, line, sourceId] = args;
    const severity = ['debug', 'info', 'warn', 'error'][level] ?? 'log';
    console.info(`[gr4-studio][${label}:${severity}] ${formatConsoleValue(message)} (${sourceId}:${line})`);
  });
  window.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedUrl) => {
    console.error(
      `[gr4-studio] ${label} failed to load: code=${errorCode} description=${errorDescription} url=${validatedUrl}`,
    );
  });
  window.webContents.on('render-process-gone', (_event, details) => {
    console.error(
      `[gr4-studio] ${label} renderer exited: reason=${details.reason} exitCode=${details.exitCode}`,
    );
  });
}

function resolveBackendRuntimeConfig() {
  const backendMode = process.env.GR4_STUDIO_BACKEND_MODE || 'unknown';
  const explicitUrl = normalizeBackendUrl(process.env.GR4_STUDIO_CONTROL_PLANE_BASE_URL || process.env.GR4_CONTROL_PLANE_URL);
  if (explicitUrl) {
    return {
      backendMode,
      controlPlaneBaseUrl: explicitUrl,
      source: backendMode === 'local' && localBackend ? 'managed' : 'explicit',
    };
  }

  return {
    backendMode,
    controlPlaneBaseUrl: DEFAULT_BACKEND_URL,
    source: 'default',
  };
}

ipcMain.handle('gr4-studio:boot-status:get', async () => desktopBootStatus);

ipcMain.handle('gr4-studio:control-plane-console:get', async () => {
  if (desktopBootStatus.backendMode !== 'local') {
    return {
      available: false,
      reason: 'remote-backend',
      message: 'Live console output is available only for an Electron-managed local backend.',
    };
  }

  const snapshot = backendConsoleBuffer.snapshot();
  return {
    available: true,
    ...snapshot,
    logPath: resolveLocalBackendLogPath(),
    running: Boolean(localBackend && !localBackend.getExitDetails()),
  };
});

function resolveLocalBackendLogPath() {
  if (desktopBootStatus.backendMode !== 'local') {
    return null;
  }

  const configuredPath = process.env.GR4_STUDIO_BACKEND_LOG_FILE;
  return configuredPath && path.isAbsolute(configuredPath) ? configuredPath : null;
}

ipcMain.handle('gr4-studio:control-plane-diagnostics:get', async () => {
  if (desktopBootStatus.backendMode !== 'local') {
    return {
      available: false,
      reason: 'remote-backend',
      message: 'Control-plane logs are available only when Studio manages a local backend.',
    };
  }

  const logPath = resolveLocalBackendLogPath();
  if (!logPath) {
    return {
      available: false,
      reason: 'not-configured',
      message: 'This Studio process was not launched with a managed control-plane log.',
    };
  }

  try {
    return {
      available: true,
      logPath,
      capturedAt: new Date().toISOString(),
      ...(await readBackendLogTail(logPath)),
    };
  } catch (error) {
    return {
      available: false,
      reason: error?.code === 'ENOENT' ? 'not-found' : 'read-failed',
      message:
        error?.code === 'ENOENT'
          ? 'The control-plane log has not been created yet.'
          : `Could not read the control-plane log: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
});

ipcMain.handle('gr4-studio:control-plane-diagnostics:reveal', async () => {
  const logPath = resolveLocalBackendLogPath();
  if (!logPath) {
    return { ok: false, error: 'No managed local control-plane log is configured.' };
  }

  try {
    await fs.access(logPath);
    shell.showItemInFolder(logPath);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
});

ipcMain.handle('gr4-studio:display-application:snapshot:get', async (_event, launchId) => {
  const key = typeof launchId === 'string' ? launchId.trim() : '';
  return key ? displayApplicationLaunchSnapshots.get(key) ?? null : null;
});

function resolveDisplayApplicationUrl(launchId) {
  if (!mainStartUrl) {
    throw new Error('Studio has not finished opening its main window.');
  }

  const encodedLaunchId = encodeURIComponent(String(launchId));
  if (mainStartUrl.startsWith('file:')) {
    const [base] = mainStartUrl.split('#', 1);
    return `${base}#/app-runtime/${encodedLaunchId}`;
  }

  return new URL(`/app-runtime/${encodedLaunchId}`, mainStartUrl).toString();
}

ipcMain.handle('gr4-studio:display-application:open', async (_event, input) => {
  const launchId = typeof input?.launchId === 'string' ? input.launchId.trim() : '';
  if (!launchId) {
    return { ok: false, error: 'Missing display application launch id.' };
  }

  try {
    if (input?.snapshot && typeof input.snapshot === 'object') {
      displayApplicationLaunchSnapshots.set(launchId, input.snapshot);
    }
    logDesktop(`Opening display application launch=${launchId}`);
    const appIconPath = await resolveAppIconPath();
    const displayWindow = new BrowserWindow({
      width: 1280,
      height: 820,
      minWidth: 720,
      minHeight: 480,
      backgroundColor: '#0f172a',
      title: typeof input?.title === 'string' && input.title.trim() ? input.title.trim() : `${APP_NAME} Application`,
      icon: appIconPath ?? undefined,
      webPreferences: {
        preload: path.join(app.getAppPath(), 'desktop', 'preload.cjs'),
        contextIsolation: true,
        nodeIntegration: false,
      },
    });

    displayApplicationWindows.add(displayWindow);
    displayWindow.on('closed', () => {
      displayApplicationWindows.delete(displayWindow);
    });
    attachRendererDiagnostics(displayWindow, 'display-application');

    const displayUrl = resolveDisplayApplicationUrl(launchId);
    await displayWindow.loadURL(displayUrl);
    displayWindow.focus();
    return { ok: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[gr4-studio] Failed to open display application:', message);
    return { ok: false, error: message };
  }
});

async function resolveWindowStartUrl(runtimeConfig) {
  const devServerUrl = resolveStartUrl();
  if (devServerUrl) {
    return devServerUrl;
  }

  if (!desktopAppServer) {
    desktopAppServer = await startDesktopAppServer({
      backendBaseUrl: runtimeConfig.controlPlaneBaseUrl,
      staticRoot: app.getAppPath(),
    });
    logDesktop(`Desktop app server listening at ${desktopAppServer.origin}`);
  }

  updateDesktopBootStatus({
    appServerOrigin: desktopAppServer.origin,
  });

  return `${desktopAppServer.origin}/`;
}

async function createWindow(startUrl, runtimeConfig) {
  process.env.GR4_STUDIO_CONTROL_PLANE_BASE_URL = runtimeConfig.controlPlaneBaseUrl;
  mainStartUrl = startUrl;
  const appIconPath = await resolveAppIconPath();

  mainWindow = new BrowserWindow({
    width: 1600,
    height: 1000,
    backgroundColor: '#0f172a',
    title: APP_NAME,
    icon: appIconPath ?? undefined,
    webPreferences: {
      preload: path.join(app.getAppPath(), 'desktop', 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  attachRendererDiagnostics(mainWindow, 'renderer');

  return mainWindow.loadURL(startUrl).then(() => mainWindow);
}

async function beginBackendStartup(runtimeConfig) {
  updateDesktopBootStatus({
    phase: 'waiting-backend',
    message:
      runtimeConfig.backendMode === 'local'
        ? 'Checking local backend…'
        : 'Checking backend reachability…',
    controlPlaneBaseUrl: runtimeConfig.controlPlaneBaseUrl,
    backendMode: runtimeConfig.backendMode,
    source: runtimeConfig.source,
  });

  logDesktop(
    `Backend mode=${runtimeConfig.backendMode} url=${runtimeConfig.controlPlaneBaseUrl} source=${runtimeConfig.source}`,
  );

  try {
    const readiness = await probeBackendReady(runtimeConfig.controlPlaneBaseUrl, {
      attempts: runtimeConfig.backendMode === 'local' ? 120 : 60,
    });
    logDesktop(`Backend reachable via ${readiness.probePath} (status ${readiness.status})`);
    updateDesktopBootStatus({
      phase: 'ready',
      message: `Backend reachable via ${readiness.probePath}`,
      probePath: readiness.probePath,
    });
  } catch (error) {
    if (runtimeConfig.backendMode === 'local' && localBackendExitMessage) {
      return;
    }
    const message = error instanceof Error ? error.message : String(error);
    console.error('[gr4-studio] Backend startup failed:', message);
    updateDesktopBootStatus({
      phase: 'error',
      message,
    });
  }
}

async function closeOwnedResources() {
  const appServer = desktopAppServer;
  desktopAppServer = null;
  if (appServer) {
    try {
      await appServer.close();
    } catch (error) {
      console.error('[gr4-studio] Failed to stop desktop app server:', error);
    }
  }

  const backend = localBackend;
  localBackend = null;
  if (backend) {
    try {
      await backend.stop();
    } catch (error) {
      console.error('[gr4-studio] Failed to stop managed local backend:', error);
    }
  }
}

function shutdownAndQuit(exitCode = null) {
  if (shutdownPromise) {
    return shutdownPromise;
  }

  shutdownPromise = closeOwnedResources().finally(() => {
    shutdownComplete = true;
    if (exitCode === null) {
      app.quit();
    } else {
      app.exit(exitCode);
    }
  });
  return shutdownPromise;
}

async function bootstrap() {
  app.on('window-all-closed', () => {
    app.quit();
  });
  app.on('before-quit', (event) => {
    if (!shutdownComplete) {
      event.preventDefault();
      void shutdownAndQuit();
    }
  });
  process.once('SIGINT', () => {
    void shutdownAndQuit(130);
  });
  process.once('SIGTERM', () => {
    void shutdownAndQuit(143);
  });

  app.setName(APP_NAME);
  await app.whenReady();
  if (process.platform === 'win32') {
    app.setAppUserModelId(APP_NAME);
  }
  Menu.setApplicationMenu(buildApplicationMenu());

  const appIconPath = await resolveAppIconPath();
  if (appIconPath && process.platform === 'darwin' && app.dock) {
    app.dock.setIcon(appIconPath);
  }

  const launch = parseLaunchArgs(process.argv, {
    defaultApp: Boolean(process.defaultApp),
    environment: process.env,
  });
  if (launch.remoteUrl) {
    process.env.GR4_STUDIO_BACKEND_MODE = 'remote';
    process.env.GR4_STUDIO_CONTROL_PLANE_BASE_URL = launch.remoteUrl;
    await saveRecentRemoteEndpoint(launch.remoteUrl);
  } else if (launch.promptForRemote) {
    const recentEndpoints = await loadRecentRemoteEndpoints();
    const chosen = await openRemotePicker(recentEndpoints);
    if (!chosen) {
      app.quit();
      return;
    }
    process.env.GR4_STUDIO_BACKEND_MODE = 'remote';
    process.env.GR4_STUDIO_CONTROL_PLANE_BASE_URL = chosen;
  } else {
    process.env.GR4_STUDIO_BACKEND_MODE = 'local';
    delete process.env.GR4_STUDIO_CONTROL_PLANE_BASE_URL;
  }

  let localBackendStartupError = null;
  if (process.env.GR4_STUDIO_BACKEND_MODE === 'local') {
    delete process.env.GR4_STUDIO_CONTROL_PLANE_BASE_URL;
    try {
      await startManagedLocalBackend();
    } catch (error) {
      localBackendStartupError = error instanceof Error ? error.message : String(error);
      console.error('[gr4-studio] Managed local backend startup failed:', localBackendStartupError);
    }
  }

  const runtimeConfig = resolveBackendRuntimeConfig();
  updateDesktopBootStatus({
    phase: 'starting',
    message: runtimeConfig.backendMode === 'local' ? 'Starting local backend…' : 'Opening gr4-studio…',
    controlPlaneBaseUrl: runtimeConfig.controlPlaneBaseUrl,
    backendMode: runtimeConfig.backendMode,
    source: runtimeConfig.source,
  });
  const startUrl = await resolveWindowStartUrl(runtimeConfig);
  await createWindow(startUrl, runtimeConfig);
  if (localBackendStartupError || localBackendExitMessage) {
    updateDesktopBootStatus({
      phase: 'error',
      message: localBackendStartupError ?? localBackendExitMessage,
    });
  } else {
    void beginBackendStartup(runtimeConfig);
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      const nextRuntimeConfig = resolveBackendRuntimeConfig();
      void resolveWindowStartUrl(nextRuntimeConfig).then((nextStartUrl) => createWindow(nextStartUrl, nextRuntimeConfig));
      void beginBackendStartup(nextRuntimeConfig);
    }
  });
}

bootstrap().catch(async (error) => {
  console.error('[gr4-studio] Failed to start desktop app:', error);
  await dialog.showErrorBox('gr4-studio failed to start', error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
  app.quit();
});
