import type { ReactNode } from 'react';
import type { ApplicationMode } from '../graph-document/model/studio-workspace';
import type { TabRuntimeView } from '../runtime-session/store/runtimeSessionStore';
import { InspectorAdvancedDetails, InspectorPropertyRow, InspectorSection } from './inspector-components';
import { fullTimestamp, schedulerDisplayName, validTimestamp } from './inspector-formatting';

export function GraphDetails({ name, description, onDescriptionChange, blockCount, connectionCount, schedulerId, schedulers,
  schedulersPending, schedulersError, onSchedulerChange, mode, displayTitle, displayTitlePlaceholder,
  inProcessControlPlane, onModeChange, onDisplayTitleChange, runtimeView, issues, canExport, onExport, exportError,
}: {
  name: string; description?: string; onDescriptionChange: (description: string) => void; blockCount: number; connectionCount: number;
  schedulerId?: string; schedulers: string[]; schedulersPending: boolean; schedulersError: boolean;
  onSchedulerChange: (value: string | undefined) => void;
  mode: ApplicationMode; displayTitle: string; displayTitlePlaceholder: string; inProcessControlPlane: boolean;
  onModeChange: (mode: ApplicationMode) => void; onDisplayTitleChange: (title: string) => void;
  runtimeView: TabRuntimeView | null; issues?: ReactNode; canExport: boolean; onExport: () => void; exportError: string | null;
}) {
  const unavailableScheduler = Boolean(schedulerId && !schedulersPending && !schedulersError && !schedulers.includes(schedulerId));
  return <>
    <header className="space-y-1 pb-3">
      <h2 title={name} className="line-clamp-2 text-lg font-semibold leading-5 text-slate-100 [overflow-wrap:anywhere]">{name}</h2>
      <p className="text-xs text-slate-400">{blockCount} {blockCount === 1 ? 'block' : 'blocks'} · {connectionCount} {connectionCount === 1 ? 'connection' : 'connections'}</p>
    </header>
    <InspectorSection title="Scheduler">
      <select aria-label="Scheduler" title={schedulerId ?? 'Default scheduler'} value={schedulerId ?? ''}
        disabled={schedulersPending || schedulersError} onChange={(event) => onSchedulerChange(event.target.value || undefined)}
        className="inspector-input disabled:opacity-60">
        <option value="">Default scheduler</option>
        {unavailableScheduler && <option value={schedulerId} disabled>Configured scheduler unavailable</option>}
        {schedulers.map((id) => <option key={id} value={id} title={id}>{schedulerDisplayName(id)}</option>)}
      </select>
      {schedulersPending && <p className="text-xs text-slate-400">Loading schedulers…</p>}
      {schedulersError && <p role="alert" className="text-xs text-rose-300">Failed to load schedulers.</p>}
      {unavailableScheduler && <p className="text-xs text-amber-200">The configured scheduler is not in the current catalog.</p>}
    </InspectorSection>
    <InspectorSection title="Display">
      <label className="block space-y-1 text-sm text-slate-400">
        <span>Mode</span>
        <select aria-label="Display mode" value={mode} disabled={inProcessControlPlane}
          title={inProcessControlPlane ? 'WASM supports in-app displays only.' : undefined}
          onChange={(event) => onModeChange(event.target.value as ApplicationMode)} className="inspector-input disabled:opacity-60">
          <option value="in_app">In-app</option>
          {!inProcessControlPlane && <><option value="new_tab">New tab</option><option value="popout">Popout</option></>}
        </select>
      </label>
      {inProcessControlPlane && <p className="text-xs text-slate-400">WASM supports in-app displays only.</p>}
      <label className="block space-y-1 text-sm text-slate-400">
        <span>Title</span>
        <input type="text" aria-label="Display title" value={displayTitle} placeholder={displayTitlePlaceholder}
          onChange={(event) => onDisplayTitleChange(event.target.value)} className="inspector-input placeholder:text-slate-400" />
      </label>
    </InspectorSection>
    <InspectorSection title="Description">
      <textarea aria-label="Graph description" value={description ?? ''} rows={3} placeholder="Add description…"
        onChange={(event) => onDescriptionChange(event.target.value)} className="inspector-input resize-y placeholder:text-slate-400" />
    </InspectorSection>
    <InspectorAdvancedDetails>
      <dl className="space-y-2">
        <InspectorPropertyRow label="Scheduler type" technical>{schedulerId || 'Default scheduler'}</InspectorPropertyRow>
        {runtimeView && runtimeView.graphSubmissionState !== 'none' && <InspectorPropertyRow label="Submission snapshot">
          {runtimeView.graphSubmissionState === 'current' ? 'Current' : 'Stale'}
        </InspectorPropertyRow>}
        {validTimestamp(runtimeView?.graphSubmissionUpdatedAt) && <InspectorPropertyRow label="Last submitted">
          <time dateTime={runtimeView!.graphSubmissionUpdatedAt!} title={runtimeView!.graphSubmissionUpdatedAt!}>{fullTimestamp(runtimeView?.graphSubmissionUpdatedAt)}</time>
        </InspectorPropertyRow>}
      </dl>
    </InspectorAdvancedDetails>
    {issues}
    <InspectorSection>
      <button type="button" className="inspector-button" onClick={onExport} disabled={!canExport}
        title={canExport ? 'Download the current graph as a .gr4c runtime representation.' : 'No active graph to export.'}>
        Download .gr4c
      </button>
      {exportError && <p role="alert" className="text-xs text-rose-300">{exportError}</p>}
    </InspectorSection>
  </>;
}
