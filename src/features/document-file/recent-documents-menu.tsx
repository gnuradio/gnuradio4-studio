import type { RecentDocument } from './recent-documents';
import { executeStudioCommand } from '../../lib/commands/studio-commands';

type Props = { entries: RecentDocument[]; enabled: boolean; onRefresh: () => Promise<void> };

export function RecentDocumentsMenu({ entries, enabled, onRefresh }: Props) {
  const closeMenu = (target: HTMLElement) => {
    target.closest('details[data-file-menu]')?.removeAttribute('open');
    target.closest('details[data-recent-documents-menu]')?.removeAttribute('open');
  };
  const button = 'w-full rounded px-2 py-1 text-left text-xs text-slate-200 hover:bg-slate-800 disabled:opacity-50';
  return <details data-recent-documents-menu onToggle={(event) => {
    if (event.currentTarget.open) void onRefresh();
  }}>
    <summary aria-disabled={!enabled} onClick={(event) => { if (!enabled) event.preventDefault(); }}
      className={`${button} flex cursor-pointer list-none items-center justify-between`}>
      Open Recent <span aria-hidden="true">▸</span>
    </summary>
    <div aria-label="Recent files" className="ml-2 border-l border-slate-600 pl-1">
      {entries.length === 0 ? <p className="px-2 py-1 text-xs text-slate-400">No recent files</p>
        : entries.map((entry) => <button key={entry.id} type="button" disabled={!enabled}
          title={entry.location ? `${entry.location}/${entry.name}` : entry.name}
          onClick={(event) => {
            closeMenu(event.currentTarget);
            // Use the already loaded entry: permission requests must start in this click.
            executeStudioCommand('openRecent', entry.id);
          }} className={`${button} block truncate`}>
          {entry.name}{entry.requiresSelection ? ' (Select file again…)' : ''}
        </button>)}
      <div className="mt-1 border-t border-slate-700 pt-1">
        <button type="button" className={button} disabled={!enabled || entries.length === 0}
          onClick={(event) => { closeMenu(event.currentTarget); executeStudioCommand('clearRecent'); }}>Clear Recent</button>
        <button type="button" className={button} disabled={!enabled}
          onClick={(event) => { closeMenu(event.currentTarget); executeStudioCommand('manageRecent'); }}>Manage Recent…</button>
      </div>
    </div>
  </details>;
}
