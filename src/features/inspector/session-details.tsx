import { useState } from 'react';
import { StatusPill } from '../../components/status-pill';
import type { RuntimeActivity, TabExecutionContext, TabRuntimeView } from '../runtime-session/store/runtimeSessionStore';
import { InspectorAdvancedDetails, InspectorCopyButton, InspectorPropertyRow, InspectorSection } from './inspector-components';
import { compactTime, fullTimestamp, schedulerDisplayName, validTimestamp } from './inspector-formatting';
import { activitySummary, activityTone, presentSessionError } from './session-diagnostics';

export function SessionErrorDetails({ message }: { message: string }) {
  const diagnostics = presentSessionError(message).diagnostics;
  return <details className="inspector-disclosure text-xs">
    <summary className="text-slate-300">Technical details</summary>
    <div className="mt-2 space-y-2">
      <InspectorCopyButton value={message} label="Copy complete error">Copy error</InspectorCopyButton>
      <pre tabIndex={0} aria-label="Complete error diagnostics" className="inspector-diagnostics">{diagnostics}</pre>
    </div>
  </details>;
}

export function SessionError({ message, operation }: { message: string; operation?: string | null }) {
  const error = presentSessionError(message, operation);
  return <section aria-label="Last error" className="inspector-section">
    <h3 className="inspector-heading">Last error</h3>
    <div role="alert" className="space-y-2 rounded border border-rose-600 bg-rose-900/20 p-2">
      <p className="text-[13px] font-medium text-rose-300"><span aria-hidden="true">⚠ </span>{error.title}</p>
      {(error.block || error.setting) && <dl className="space-y-1">
        {error.block && <InspectorPropertyRow label="Block"><span className="block truncate" title={error.block}>{error.block}</span></InspectorPropertyRow>}
        {error.setting && <InspectorPropertyRow label="Setting" technical><span className="block truncate" title={error.setting}>{error.setting}</span></InspectorPropertyRow>}
      </dl>}
      <p className="line-clamp-3 text-xs leading-5 text-slate-300">{error.explanation}</p>
    </div>
    <SessionErrorDetails message={message} />
  </section>;
}

function ActivityEntry({ entry }: { entry: RuntimeActivity }) {
  const tone = activityTone(entry);
  return <li className="border-b border-slate-700 py-2 last:border-b-0">
    <details className="inspector-disclosure text-xs">
      <summary className="text-slate-300">
        <time dateTime={validTimestamp(entry.timestamp)?.toISOString()} title={fullTimestamp(entry.timestamp)} className="mr-2 text-[11px] text-slate-400">{compactTime(entry.timestamp, true)}</time>
        <span className={tone === 'error' ? 'text-rose-300' : tone === 'success' ? 'text-emerald-300' : 'text-slate-100'}>
          <span aria-hidden="true">{tone === 'error' ? '⚠ ' : tone === 'success' ? '✓ ' : '· '}</span>{activitySummary(entry)}
        </span>
      </summary>
      <div className="mt-2 space-y-2">
        <p className="text-[11px] text-slate-400 [overflow-wrap:anywhere]">Action: {entry.action}</p>
        <InspectorCopyButton value={entry.message} label="Copy activity message" />
        <pre tabIndex={0} aria-label="Complete activity message" className="inspector-diagnostics">{presentSessionError(entry.message).diagnostics}</pre>
      </div>
    </details>
  </li>;
}

export function SessionActivity({ activity }: { activity: RuntimeActivity[] }) {
  const [showAll, setShowAll] = useState(false);
  return <InspectorSection title="Recent activity">
    {activity.length === 0 ? <p className="text-xs text-slate-400">No activity yet.</p> : <>
      <ul aria-label="Session activity" className="min-w-0">
        {(showAll ? activity : activity.slice(0, 5)).map((entry, index) => <ActivityEntry key={`${entry.timestamp}:${index}`} entry={entry} />)}
      </ul>
      {activity.length > 5 && <button type="button" className="inspector-button" aria-expanded={showAll}
        onClick={() => setShowAll((current) => !current)}>{showAll ? 'Show recent activity' : `Show all activity (${activity.length})`}</button>}
    </>}
  </InspectorSection>;
}

export function SessionDetails({ context, runtimeView, canRefresh, onRefresh }: {
  context?: TabExecutionContext; runtimeView: TabRuntimeView | null; canRefresh: boolean; onRefresh: () => void;
}) {
  const session = context?.session;
  const error = context?.lastError || session?.lastError;
  const operation = context?.lastError && context.lastActionStatus === 'error' ? context.lastAction : undefined;
  return <>
    <header className="space-y-2 pb-3">
      <h2 title={session?.name} className="line-clamp-2 text-base font-semibold leading-5 text-slate-100 [overflow-wrap:anywhere]">
        {session?.name || (context?.sessionId ? 'Linked session' : 'No session linked')}
      </h2>
      {context?.sessionId ? <StatusPill status={session?.state ?? 'unknown'} /> : <p className="text-xs text-slate-400">Run this graph or link a session to inspect execution.</p>}
    </header>
    {error && <SessionError key={error} message={error} operation={operation} />}
    {context?.sessionId && <>
      <InspectorSection title="Status">
        <dl className="space-y-1">
          <InspectorPropertyRow label="Graph sync">{runtimeView?.graphDriftState === 'in-sync' ? 'In sync' : runtimeView?.graphDriftState === 'out-of-sync' ? 'Out of sync' : 'Unknown'}</InspectorPropertyRow>
          <InspectorPropertyRow label="Scheduler"><span title={session?.schedulerId}>{schedulerDisplayName(session?.schedulerId)}</span></InspectorPropertyRow>
        </dl>
        <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
          <button type="button" disabled={!canRefresh || context.busy} aria-label="Refresh session" onClick={onRefresh} className="inspector-button">
            {context.busy && context.lastAction === 'refresh' ? 'Refreshing…' : 'Refresh'}
          </button>
          {validTimestamp(context.sessionRefreshedAt) && <span className="text-[11px] text-slate-400">Updated <time dateTime={context.sessionRefreshedAt!} title={fullTimestamp(context.sessionRefreshedAt)}>{compactTime(context.sessionRefreshedAt)}</time></span>}
        </div>
      </InspectorSection>
    </>}
    {context && (context.sessionId || context.activity.length > 0) && <SessionActivity key={context.sessionId ?? 'unlinked'} activity={context.activity} />}
    {context?.sessionId && <InspectorAdvancedDetails>
      <div className="space-y-1">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-slate-400">Session ID</p>
          <InspectorCopyButton value={context.sessionId} label="Copy session ID" />
        </div>
        <p className="select-text font-mono text-[11px] text-slate-300 [overflow-wrap:anywhere]">{context.sessionId}</p>
      </div>
      <dl className="space-y-2">
        <InspectorPropertyRow label="Scheduler type" technical>{session?.schedulerId || 'Default scheduler'}</InspectorPropertyRow>
        {([['Created', session?.createdAt], ['Updated', session?.updatedAt], ['Last refreshed', context.sessionRefreshedAt]] as const).map(([label, value]) =>
          validTimestamp(value) && <InspectorPropertyRow key={label} label={label}><time dateTime={value!} title={value!}>{fullTimestamp(value)}</time></InspectorPropertyRow>)}
      </dl>
      {context.lastError && session?.lastError && context.lastError !== session.lastError && <div className="space-y-2">
        <p className="text-xs text-slate-400">Additional backend error</p>
        <SessionErrorDetails message={session.lastError} />
      </div>}
    </InspectorAdvancedDetails>}
  </>;
}
