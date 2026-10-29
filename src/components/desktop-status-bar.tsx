import { executeStudioCommand } from '../lib/commands/studio-commands';
import type { BackendMode } from '../lib/runtime-config';
import { StatusBadge } from './status-badge';

type Props = {
  backendMode: BackendMode;
  controlPlaneBaseUrl: string;
  connectionStatus: 'idle' | 'loading' | 'connected' | 'error';
};

export function DesktopStatusBarContent({ backendMode, controlPlaneBaseUrl, connectionStatus }: Props) {
  const mode = backendMode === 'local' ? 'Local backend' : backendMode === 'remote' ? 'Remote backend' : 'Backend';
  return (
    <>
      <span className="min-w-0 truncate" title={controlPlaneBaseUrl}>{mode} · {controlPlaneBaseUrl.replace(/^https?:\/\//, '')}</span>
      <StatusBadge status={connectionStatus} />
      <button type="button" onClick={() => executeStudioCommand('sessions')} className="ml-auto rounded px-2 py-1 hover:bg-slate-800">Sessions</button>
    </>
  );
}
