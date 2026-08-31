const { contextBridge, ipcRenderer } = require('electron');

const controlPlaneBaseUrl =
  process.env.GR4_STUDIO_CONTROL_PLANE_BASE_URL || process.env.GR4_CONTROL_PLANE_URL || 'http://127.0.0.1:8080';
const backendMode = process.env.GR4_STUDIO_BACKEND_MODE || 'unknown';

// The renderer reads this injected runtime config before falling back to Vite env defaults.
contextBridge.exposeInMainWorld('gr4StudioRuntime', {
  controlPlaneBaseUrl,
  backendMode,
});

contextBridge.exposeInMainWorld('gr4StudioShell', {
  getBootStatus() {
    return ipcRenderer.invoke('gr4-studio:boot-status:get');
  },
  onBootStatus(callback) {
    const listener = (_event, status) => {
      callback(status);
    };

    ipcRenderer.on('gr4-studio:boot-status', listener);
    return () => {
      ipcRenderer.removeListener('gr4-studio:boot-status', listener);
    };
  },
  onMenuCommand(callback) {
    const listener = (_event, command) => {
      callback(command);
    };

    ipcRenderer.on('gr4-studio:menu-command', listener);
    return () => {
      ipcRenderer.removeListener('gr4-studio:menu-command', listener);
    };
  },
  getControlPlaneDiagnostics() {
    return ipcRenderer.invoke('gr4-studio:control-plane-diagnostics:get');
  },
  getControlPlaneConsole() {
    return ipcRenderer.invoke('gr4-studio:control-plane-console:get');
  },
  onControlPlaneConsoleOutput(callback) {
    const listener = (_event, output) => {
      callback(output);
    };

    ipcRenderer.on('gr4-studio:control-plane-console:output', listener);
    return () => {
      ipcRenderer.removeListener('gr4-studio:control-plane-console:output', listener);
    };
  },
  revealControlPlaneLog() {
    return ipcRenderer.invoke('gr4-studio:control-plane-diagnostics:reveal');
  },
  openDisplayApplication(input) {
    return ipcRenderer.invoke('gr4-studio:display-application:open', input);
  },
  getDisplayApplicationLaunchSnapshot(launchId) {
    return ipcRenderer.invoke('gr4-studio:display-application:snapshot:get', launchId);
  },
});
