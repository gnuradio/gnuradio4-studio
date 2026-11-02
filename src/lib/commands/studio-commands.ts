export type StudioCommandId =
  | 'new' | 'open' | 'openRecent' | 'save' | 'saveAs' | 'rename' | 'closeTab'
  | 'cut' | 'copy' | 'paste' | 'delete' | 'selectAll'
  | 'graph' | 'variables' | 'workspace' | 'application'
  | 'catalog' | 'inspector' | 'zoomIn' | 'zoomOut' | 'fitView'
  | 'run' | 'stop' | 'openDisplay' | 'deleteSession'
  | 'sessions' | 'console' | 'diagnostics';

export type CommandState = { enabled: boolean; checked?: boolean };
export type StudioCommand = CommandState & { execute: () => unknown };
export type StudioCommands = Partial<Record<StudioCommandId, StudioCommand>>;
export type StudioCommandState = Partial<Record<StudioCommandId, CommandState>>;

function hasModalDialog(): boolean {
  return typeof document !== 'undefined' && document.querySelector('dialog[open]') !== null;
}

// Each renderer owns its commands. Graph commands exist only while its canvas is mounted.
export function createStudioCommands() {
  const owners = new Map<string, StudioCommands>();
  const listeners = new Set<() => void>();
  let pending = false;
  let inFlight = false;
  let reportError: (error: unknown) => void = console.error;
  const notify = () => {
    if (pending) return;
    pending = true;
    queueMicrotask(() => {
      pending = false;
      listeners.forEach((listener) => listener());
    });
  };
  const all = () => Object.assign({}, ...owners.values()) as StudioCommands;
  return {
    register(owner: string, commands: StudioCommands) {
      owners.set(owner, commands);
      notify();
      return () => {
        if (owners.get(owner) === commands) owners.delete(owner);
        notify();
      };
    },
    state(): StudioCommandState {
      return Object.fromEntries(Object.entries(all()).map(([id, command]) => [id, {
        enabled: command.enabled && !inFlight && !hasModalDialog(),
        ...(command.checked === undefined ? {} : { checked: command.checked }),
      }]));
    },
    async execute(id: StudioCommandId) {
      const command = all()[id];
      if (!command?.enabled || inFlight || hasModalDialog()) return false;
      inFlight = true;
      notify();
      try {
        const result = command.execute();
        if (result && typeof (result as PromiseLike<unknown>).then === 'function') await result;
        return true;
      } catch (error) {
        reportError(error);
        return false;
      } finally {
        inFlight = false;
        notify();
      }
    },
    onError(handler: typeof reportError) { reportError = handler; },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
  };
}

export const studioCommands = createStudioCommands();
export const executeStudioCommand = (id: StudioCommandId) => { void studioCommands.execute(id); };

export function isTextEditingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.matches('input, textarea, select') || target.isContentEditable;
}

export function hasDesktopMenus(): boolean {
  return window.gr4StudioShell?.capabilities?.nativeMenus === true;
}
