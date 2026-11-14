import type { ApplicationMode, StudioLayoutSpec } from '../../graph-document/model/studio-workspace';
import type { ExecutionState } from '../../runtime-session/store/runtimeSessionStore';
import type { ExpressionBinding } from '../../variables/model/types';
import type { WorkspacePanelViewModel } from '../../workspace/workspace-view';

const STORAGE_PREFIX = 'gr4-studio:display-application:';
const COMMAND_STORAGE_PREFIX = `${STORAGE_PREFIX}command:`;
const COMMAND_CHANNEL_NAME = 'gr4-studio:display-application:commands';

export type DisplayApplicationLaunchSnapshot = {
  launchId: string;
  sourceTabId: string;
  sessionId: string;
  title: string;
  mode: Extract<ApplicationMode, 'new_tab' | 'popout'>;
  executionState: ExecutionState;
  panelEntries: WorkspacePanelViewModel[];
  layout: StudioLayoutSpec;
  createdAt: string;
};

export type DisplayApplicationVariableUpdateCommand = {
  type: 'variable-update';
  commandId: string;
  launchId: string;
  sourceTabId: string;
  variableName: string;
  binding: ExpressionBinding;
  createdAt: string;
};

export type DisplayApplicationCommand = DisplayApplicationVariableUpdateCommand;

function createLaunchId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function storageKey(launchId: string): string {
  return `${STORAGE_PREFIX}${launchId}`;
}

function commandStorageKey(commandId: string): string {
  return `${COMMAND_STORAGE_PREFIX}${commandId}`;
}

export function writeDisplayApplicationLaunchSnapshot(
  input: Omit<DisplayApplicationLaunchSnapshot, 'launchId' | 'createdAt'>,
  storage: Storage = window.localStorage,
): DisplayApplicationLaunchSnapshot {
  const snapshot: DisplayApplicationLaunchSnapshot = {
    ...input,
    launchId: createLaunchId(),
    createdAt: new Date().toISOString(),
  };
  storage.setItem(storageKey(snapshot.launchId), JSON.stringify(snapshot));
  return snapshot;
}

export function readDisplayApplicationLaunchSnapshot(
  launchId: string,
  storage: Storage = window.localStorage,
): DisplayApplicationLaunchSnapshot | null {
  const raw = storage.getItem(storageKey(launchId));
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as DisplayApplicationLaunchSnapshot;
    if (!parsed || parsed.launchId !== launchId || !parsed.sessionId || !Array.isArray(parsed.panelEntries)) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function buildDisplayApplicationUrl(launchId: string, location: Location = window.location): string {
  if (location.protocol === 'file:' || import.meta.env.PROD) {
    const base = location.href.split('#')[0];
    return `${base}#/app-runtime/${encodeURIComponent(launchId)}`;
  }
  return `${location.origin}/app-runtime/${encodeURIComponent(launchId)}`;
}

export function publishDisplayApplicationVariableUpdate(
  input: Omit<DisplayApplicationVariableUpdateCommand, 'type' | 'commandId' | 'createdAt'>,
  storage: Storage = window.localStorage,
): DisplayApplicationVariableUpdateCommand {
  const command: DisplayApplicationVariableUpdateCommand = {
    ...input,
    type: 'variable-update',
    commandId: createLaunchId(),
    createdAt: new Date().toISOString(),
  };
  const serialized = JSON.stringify(command);
  storage.setItem(commandStorageKey(command.commandId), serialized);

  if (typeof BroadcastChannel !== 'undefined') {
    const channel = new BroadcastChannel(COMMAND_CHANNEL_NAME);
    channel.postMessage(command);
    channel.close();
  }

  return command;
}

function parseDisplayApplicationCommand(value: unknown): DisplayApplicationCommand | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const command = value as Partial<DisplayApplicationVariableUpdateCommand>;
  if (
    command.type !== 'variable-update' ||
    typeof command.commandId !== 'string' ||
    typeof command.launchId !== 'string' ||
    typeof command.sourceTabId !== 'string' ||
    typeof command.variableName !== 'string' ||
    !command.binding ||
    typeof command.binding !== 'object'
  ) {
    return null;
  }

  return command as DisplayApplicationCommand;
}

export function subscribeToDisplayApplicationCommands(
  callback: (command: DisplayApplicationCommand) => void,
): () => void {
  const seenCommandIds = new Set<string>();
  const handleCommand = (value: unknown) => {
    const command = parseDisplayApplicationCommand(value);
    if (!command || seenCommandIds.has(command.commandId)) {
      return;
    }
    seenCommandIds.add(command.commandId);
    callback(command);
  };

  const channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel(COMMAND_CHANNEL_NAME) : null;
  channel?.addEventListener('message', (event) => handleCommand(event.data));

  const handleStorage = (event: StorageEvent) => {
    if (!event.key?.startsWith(COMMAND_STORAGE_PREFIX) || !event.newValue) {
      return;
    }
    try {
      handleCommand(JSON.parse(event.newValue));
    } catch {
    }
  };
  window.addEventListener('storage', handleStorage);

  return () => {
    channel?.close();
    window.removeEventListener('storage', handleStorage);
  };
}
