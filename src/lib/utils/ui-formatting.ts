export type StatusTone = 'idle' | 'syncing' | 'running' | 'ready' | 'stopped' | 'error' | 'connected' | 'disconnected';

export function statusToneClass(tone: StatusTone): string {
  const statusStyles: Record<StatusTone, string> = {
    idle: 'border-slate-600 bg-slate-800 text-slate-200',
    syncing: 'border-sky-500/60 bg-sky-900/30 text-sky-200',
    running: 'border-emerald-500/60 bg-emerald-900/30 text-emerald-200',
    ready: 'border-cyan-500/60 bg-cyan-900/30 text-cyan-200',
    stopped: 'border-slate-500/60 bg-slate-900 text-slate-200',
    error: 'border-rose-500/60 bg-rose-900/30 text-rose-200',
    connected: 'border-emerald-500/60 bg-emerald-900/30 text-emerald-200',
    disconnected: 'border-amber-500/60 bg-amber-900/30 text-amber-200',
  };
  return statusStyles[tone];
}

export function formatTimestamp(timestampMs?: number | null): string {
  if (!timestampMs || !Number.isFinite(timestampMs)) {
    return 'n/a';
  }
  return new Date(timestampMs).toLocaleString();
}

export function formatStatus(status?: string | null): StatusTone {
  const normalized = (status ?? '').toLowerCase();

  if (normalized === 'running' || normalized === 'active' || normalized === 'started') {
    return 'running';
  }
  if (normalized === 'ready') {
    return 'ready';
  }
  if (normalized === 'stopped' || normalized === 'idle') {
    return 'stopped';
  }
  if (normalized === 'syncing' || normalized === 'loading') {
    return 'syncing';
  }
  if (normalized === 'connected') {
    return 'connected';
  }
  if (normalized === 'disconnected') {
    return 'disconnected';
  }
  if (normalized === 'error' || normalized === 'failed' || normalized === 'failure') {
    return 'error';
  }

  return 'idle';
}

export function formatMegabytes(bytes?: number | null): string {
  if (!bytes || !Number.isFinite(bytes) || bytes <= 0) {
    return 'n/a';
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
