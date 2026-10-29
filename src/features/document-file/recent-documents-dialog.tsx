import { useLayoutEffect, useRef, useState } from 'react';
import type { createRecentDocuments, RecentDocument } from './recent-documents';

type Props = {
  history: ReturnType<typeof createRecentDocuments>;
  onOpen: (entry: RecentDocument, locate?: boolean) => Promise<boolean>;
  onClose: () => void;
  error: string | null;
};

export function RecentDocumentsDialog({ history, onOpen, onClose, error }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const backdropPointerDown = useRef(false);
  const [entries, setEntries] = useState<RecentDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [showOpenError, setShowOpenError] = useState(false);
  useLayoutEffect(() => {
    dialog.current?.showModal();
    let active = true;
    history.list().then((items) => { if (active) setEntries(items); })
      .catch((cause) => { if (active) setHistoryError(String(cause)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [history]);

  const changeHistory = async (operation: () => Promise<void>) => {
    setBusy(true);
    setHistoryError(null);
    setShowOpenError(false);
    try {
      await operation();
      setEntries(await history.list());
    } catch (cause) {
      setHistoryError(cause instanceof Error ? cause.message : String(cause));
    } finally { setBusy(false); }
  };
  const open = async (entry: RecentDocument, locate = false) => {
    setBusy(true);
    setShowOpenError(true);
    try {
      if (await onOpen(entry, locate)) onClose();
    } finally { setBusy(false); }
  };
  const button = 'rounded border border-slate-600 px-3 py-1.5 text-xs hover:bg-slate-700 disabled:opacity-50';
  return <dialog ref={dialog} aria-labelledby="recent-documents-title"
    onCancel={(event) => { event.preventDefault(); if (!busy) onClose(); }}
    onPointerDown={(event) => {
      const bounds = event.currentTarget.getBoundingClientRect();
      backdropPointerDown.current = event.target === event.currentTarget
        && (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom);
    }}
    onClick={(event) => {
      const bounds = event.currentTarget.getBoundingClientRect();
      const outside = event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom;
      if (!busy && backdropPointerDown.current && event.target === event.currentTarget && outside) onClose();
      backdropPointerDown.current = false;
    }}
    className="w-[min(42rem,calc(100vw-2rem))] rounded-lg border border-slate-600 bg-slate-900 p-5 text-slate-100 shadow-xl backdrop:bg-black/60">
    <div className="mb-2 flex items-center justify-between gap-4">
      <h2 id="recent-documents-title" className="text-lg font-semibold">Open Recent</h2>
      <button type="button" className={button} disabled={busy} onClick={onClose} autoFocus>Close</button>
    </div>
    <p className="mb-4 text-sm text-slate-400">Your last 10 files. Files open in a new tab; unsaved tabs stay open.</p>
    {((showOpenError && error) || historyError) && <p role="alert" className="mb-3 text-sm text-red-300">
      {historyError || error} Select the file again, or remove it from this list.
    </p>}
    {history.warning && <p role="status" className="mb-3 text-sm text-amber-300">{history.warning}</p>}
    {loading ? <p role="status" className="py-6 text-sm">Loading recent files…</p>
      : entries.length === 0 ? <p className="py-6 text-sm text-slate-400">No recent files. Open a .gr4s file to get started.</p>
      : <ul className="max-h-[55vh] space-y-2 overflow-y-auto">
        {entries.map((entry) => <li key={entry.id} className="flex items-center gap-2 rounded border border-slate-700 p-2">
          <button type="button" disabled={busy} onClick={() => void open(entry)}
            className="min-w-0 flex-1 rounded p-2 text-left hover:bg-slate-800 disabled:opacity-50">
            <span className="block truncate text-sm font-medium" title={entry.name}>{entry.name}</span>
            {entry.location && <span className="block truncate text-xs text-slate-400" title={entry.location}>{entry.location}</span>}
            <span className="block text-xs text-slate-400">{entry.requiresSelection ? 'Select file again… · ' : ''}{new Date(entry.lastOpenedAt).toLocaleString()}</span>
          </button>
          {!entry.requiresSelection && <button type="button" className={button} disabled={busy}
            aria-label={`Locate ${entry.name}`} onClick={() => void open(entry, true)}>Locate…</button>}
          <button type="button" className={button} disabled={busy} aria-label={`Remove ${entry.name}`}
            onClick={() => void changeHistory(() => history.remove(entry.id))}>Remove</button>
        </li>)}
      </ul>}
    <div className="mt-4 flex justify-end">
      <button type="button" className={button} disabled={loading || busy || entries.length === 0}
        onClick={() => void changeHistory(() => history.clear())}>Clear Recent</button>
    </div>
  </dialog>;
}
