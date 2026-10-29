import type { GraphTab } from '../store/graphTabsStore';

type GraphTabsBarProps = {
  tabs: GraphTab[];
  activeTabId: string | null;
  sessionByTabId: Record<string, { sessionId: string; status?: string }>;
  onSelectTab: (tabId: string) => void;
  onCreateTab: () => void;
  onCloseTab: (tabId: string) => void;
  onOpenSessions?: () => void;
  canCreate?: boolean;
};

export function GraphTabsBar({
  tabs,
  activeTabId,
  sessionByTabId,
  onSelectTab,
  onCreateTab,
  onCloseTab,
  onOpenSessions,
  canCreate = true,
}: GraphTabsBarProps) {
  return (
    <div className="h-10 shrink-0 border-b border-border bg-slate-950/80 px-2 flex items-center gap-2 overflow-x-auto">
      <div className="flex items-center gap-1">
        {tabs.map((tab) => {
          const isActive = tab.id === activeTabId;
          const linkedSession = sessionByTabId[tab.id];
          return (
            <div
              key={tab.id}
              className={`group flex items-center gap-2 rounded border px-2 py-1 text-xs ${
                isActive
                  ? 'border-emerald-600/70 bg-emerald-900/30 text-emerald-100'
                  : 'border-slate-700 bg-slate-900 text-slate-300 hover:bg-slate-800'
              }`}
            >
              <button
                type="button"
                onClick={() => onSelectTab(tab.id)}
                className="max-w-40 truncate text-left"
                title={tab.title}
              >
                {tab.title}
                {tab.isDirty ? ' *' : ''}
              </button>
              {linkedSession && (
                <span
                  className="max-w-36 truncate rounded border border-slate-600 bg-slate-800 px-1.5 py-0.5 text-[10px] text-slate-200"
                  title={`${linkedSession.sessionId} (${linkedSession.status ?? 'unknown'})`}
                >
                  {linkedSession.status ?? 'linked'}
                </span>
              )}
              {tabs.length > 1 && (
                <button
                  type="button"
                  onClick={() => onCloseTab(tab.id)}
                  className="text-slate-400 hover:text-rose-300"
                  aria-label={`Close ${tab.title}`}
                >
                  ×
                </button>
              )}
            </div>
          );
        })}
      </div>

      <button
        type="button"
        onClick={onCreateTab}
        disabled={!canCreate}
        className="rounded border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-200 hover:bg-slate-800"
      >
        + New Tab
      </button>

      <div className="ml-auto" />

      {onOpenSessions && <button
        type="button"
        onClick={onOpenSessions}
        className="rounded border border-indigo-700/70 bg-indigo-900/30 px-2 py-1 text-xs text-indigo-200 hover:bg-indigo-800/40"
      >
        Sessions
      </button>}
    </div>
  );
}
