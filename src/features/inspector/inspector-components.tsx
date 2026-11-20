import { useState, type ReactNode } from 'react';

export function InspectorSection({ title, children }: { title?: string; children: ReactNode }) {
  return <section className="inspector-section" aria-label={title}>
    {title && <h3 className="inspector-heading">{title}</h3>}
    {children}
  </section>;
}

export function InspectorPropertyRow({ label, children, technical = false }: {
  label: string; children: ReactNode; technical?: boolean;
}) {
  return <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)] items-baseline gap-3 text-sm leading-5">
    <dt className="text-slate-400">{label}</dt>
    <dd className={`min-w-0 text-right text-slate-100 [overflow-wrap:anywhere] ${technical ? 'font-mono text-xs' : ''}`}>{children}</dd>
  </div>;
}

export function InspectorAdvancedDetails({ children }: { children: ReactNode }) {
  return <details className="inspector-section inspector-disclosure">
    <summary className="inspector-heading">Advanced details</summary>
    <div className="mt-3 space-y-3">{children}</div>
  </details>;
}

export function InspectorCopyButton({ value, label, children = 'Copy' }: {
  value: string; label: string; children?: ReactNode;
}) {
  const [message, setMessage] = useState('');
  return <span className="inline-flex max-w-full flex-wrap items-center gap-2">
    <button type="button" aria-label={label} className="inspector-button" onClick={async () => {
      try {
        await navigator.clipboard.writeText(value);
        setMessage('Copied');
      } catch {
        setMessage('Copy unavailable. Select and copy the text.');
      }
    }}>{children}</button>
    <span role="status" className="text-xs text-slate-400">{message}</span>
  </span>;
}
