import type { StudioPanelKind } from '../../graph-document/model/studio-workspace';

export type WorkspaceLivePanelIdentity = {
  panelId: string;
  nodeId?: string;
  kind: StudioPanelKind;
  title?: string;
};

export type WorkspaceLiveBindingInfo = {
  status: 'unsupported' | 'unconfigured' | 'configured' | 'invalid';
  transport?: string;
  endpoint?: string;
  showEndpointInUi?: boolean;
  updateMs?: number;
  sampleRate?: number;
  channels?: number;
  bufferMs?: number;
  reason?: string;
};

export type WorkspaceLiveDataState =
  | { kind: 'loading' }
  | { kind: 'no-data'; reason?: string }
  | { kind: 'error'; message: string }
  | { kind: 'ready' };

export type WorkspaceLiveRendererContext = {
  panel: WorkspaceLivePanelIdentity;
  binding: WorkspaceLiveBindingInfo;
  dataState: WorkspaceLiveDataState;
  sessionId?: string;
  executionState?: 'idle' | 'ready' | 'running' | 'stopped' | 'error';
};
