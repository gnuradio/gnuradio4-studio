type SidePanelToggleButtonProps = {
  direction: 'left' | 'right';
  label: string;
  onClick: () => void;
  className?: string;
};

export function SidePanelToggleButton({
  direction,
  label,
  onClick,
  className = '',
}: SidePanelToggleButtonProps) {
  const path = direction === 'left' ? 'M10 3 5 8l5 5' : 'M6 3l5 5-5 5';

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className={`h-6 w-6 shrink-0 rounded border border-slate-700 bg-slate-900 text-slate-300 hover:border-accent hover:text-slate-100 transition ${className}`}
    >
      <svg viewBox="0 0 16 16" className="mx-auto h-3.5 w-3.5" fill="none" aria-hidden="true">
        <path d={path} stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </button>
  );
}
