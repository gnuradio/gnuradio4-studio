import type { BackendMode } from '../lib/runtime-config';

type BackendPillProps = {
  mode: BackendMode;
  controlPlaneBaseUrl: string;
  className?: string;
};

const pillStyles: Record<BackendMode, string> = {
  local: 'border-emerald-500/40 bg-emerald-950/40 text-emerald-200',
  remote: 'border-cyan-500/40 bg-cyan-950/40 text-cyan-200',
  unknown: 'border-slate-600 bg-slate-800/80 text-slate-300',
};

export function BackendPill({ mode, controlPlaneBaseUrl, className = '' }: BackendPillProps) {
  return (
    <span
      title={controlPlaneBaseUrl}
      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium uppercase tracking-[0.18em] ${pillStyles[mode]} ${className}`}
    >
      {mode}
    </span>
  );
}
