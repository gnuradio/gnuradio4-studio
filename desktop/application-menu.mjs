const separator = { type: 'separator' };
export const EDIT_COMMANDS = ['cut', 'copy', 'paste', 'delete', 'selectAll'];

export function buildMenuTemplate({ platform, editor = false, state = {}, recentDocuments = [], editingText = false, dispatch, windows = [], focusWindow, showLog, canShowLog = false }) {
  const command = (id, label, accelerator, type) => ({
    id, label, accelerator,
    enabled: editor && state[id]?.enabled === true,
    ...(type ? { type, checked: state[id]?.checked === true } : {}),
    click: () => dispatch(id),
  });
  const textEditing = editingText || !editor;
  // Canvas edit shortcuts are handled in the renderer. Native accelerators
  // would consume those keys before the canvas receives them. Text roles keep
  // Electron's normal clipboard shortcuts when an input has focus.
  const edit = (id, label) => textEditing
    ? { role: id }
    : command(id, label);
  const appMenu = platform === 'darwin' ? [{ role: 'appMenu' }] : [];
  return [
    ...appMenu,
    { label: 'File', submenu: [
      command('new', 'New', 'CmdOrCtrl+N'), command('open', 'Open…', 'CmdOrCtrl+O'),
      { id: 'openRecent', label: 'Open Recent', enabled: editor && state.openRecent?.enabled === true, submenu: [
        ...(recentDocuments.length ? recentDocuments.slice(0, 10).map((entry) => ({
          // Escape native mnemonic markers so filenames render literally.
          label: `${entry.name}${entry.location ? ` — ${entry.location}` : ''}${entry.requiresSelection ? ' (Select file again…)' : ''}`.replaceAll('&', '&&'),
          click: () => dispatch('openRecent', entry.id),
        })) : [{ label: 'No recent files', enabled: false }]),
        separator, command('clearRecent', 'Clear Recent'), command('manageRecent', 'Manage Recent…'),
      ] }, separator,
      command('save', 'Save', 'CmdOrCtrl+S'), command('saveAs', 'Save As…', 'Shift+CmdOrCtrl+S'),
      command('rename', 'Rename…'), separator,
      editor ? command('closeTab', 'Close Tab', 'CmdOrCtrl+W') : { role: 'close' },
      ...(platform === 'darwin' ? [] : [separator, { role: 'quit' }]),
    ] },
    { label: 'Edit', submenu: [
      // Graph history is not implemented. Never pretend Chromium text undo edits the graph.
      { role: 'undo', enabled: textEditing }, { role: 'redo', enabled: textEditing }, separator,
      edit('cut', 'Cut'), edit('copy', 'Copy'),
      edit('paste', 'Paste'), edit('delete', 'Delete'),
      edit('selectAll', 'Select All'),
    ] },
    { label: 'View', submenu: [
      command('graph', 'Graph', 'CmdOrCtrl+1', 'checkbox'),
      command('variables', 'Variables', 'CmdOrCtrl+2', 'checkbox'),
      command('workspace', 'Layout Editor', 'CmdOrCtrl+3', 'checkbox'),
      command('application', 'In-app Display', 'CmdOrCtrl+4', 'checkbox'), separator,
      command('catalog', 'Block Catalog', undefined, 'checkbox'),
      command('inspector', 'Inspector', undefined, 'checkbox'),
      command('sessions', 'Sessions', undefined, 'checkbox'),
      command('console', 'Backend Console', 'CmdOrCtrl+J', 'checkbox'), separator,
      command('zoomIn', 'Zoom In', 'CmdOrCtrl+='), command('zoomOut', 'Zoom Out', 'CmdOrCtrl+-'),
      command('fitView', 'Fit Graph', 'CmdOrCtrl+0'), separator, { role: 'togglefullscreen' },
    ] },
    { label: 'Run', submenu: [
      command('run', 'Run / Resume', 'F5'), command('stop', 'Stop', 'Shift+F5'),
      command('openDisplay', 'Open Display'), separator, command('deleteSession', 'Delete Session'),
    ] },
    { label: 'Window', submenu: [
      { role: 'minimize' }, { role: 'zoom' }, separator,
      ...windows.map((window) => ({
        label: window.title, type: 'checkbox', checked: window.focused,
        click: () => focusWindow(window.id),
      })),
    ] },
    { role: 'help', submenu: [
      command('diagnostics', 'Control Plane Diagnostics'),
      { label: 'Show Backend Log', enabled: canShowLog, click: showLog },
      ...(platform === 'darwin' ? [] : [separator, { role: 'about' }]),
    ] },
  ];
}

export function sanitizeMenuState(value) {
  const allowed = new Set();
  const collect = (items) => items.forEach((item) => {
    if (item.id) allowed.add(item.id);
    if (item.submenu) collect(item.submenu);
  });
  collect(buildMenuTemplate({ platform: 'linux', editor: true }));
  const commands = {};
  for (const id of allowed) {
    const item = value?.commands?.[id];
    if (item && typeof item.enabled === 'boolean') {
      commands[id] = { enabled: item.enabled, ...(typeof item.checked === 'boolean' ? { checked: item.checked } : {}) };
    }
  }
  const recentDocuments = [];
  const seen = new Set();
  for (const entry of Array.isArray(value?.recentDocuments) ? value.recentDocuments : []) {
    if (!entry || typeof entry.id !== 'string' || !entry.id || typeof entry.name !== 'string' || !entry.name || seen.has(entry.id)) continue;
    seen.add(entry.id);
    recentDocuments.push({ id: entry.id, name: entry.name,
      ...(typeof entry.location === 'string' ? { location: entry.location } : {}),
      ...(entry.requiresSelection === true ? { requiresSelection: true } : {}) });
    if (recentDocuments.length === 10) break;
  }
  return { commands, editingText: value?.editingText === true, recentDocuments };
}
