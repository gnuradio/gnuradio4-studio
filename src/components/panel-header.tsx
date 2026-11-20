import { PropsWithChildren } from 'react';

type PanelHeaderProps = PropsWithChildren<{ title: string }>;

export function PanelHeader({ title, children }: PanelHeaderProps) {
  return (
    <div className="px-3 py-2 border-b border-border flex items-center justify-between bg-slate-900/70">
      <h2 className="text-base font-semibold text-slate-200">{title}</h2>
      {children}
    </div>
  );
}
