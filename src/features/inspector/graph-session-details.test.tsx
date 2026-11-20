import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { TabExecutionContext, TabRuntimeView } from '../runtime-session/store/runtimeSessionStore';
import { GraphDetails } from './graph-details';
import { SessionDetails, SessionError } from './session-details';
import { compactTime, schedulerDisplayName, validTimestamp } from './inspector-formatting';

const runtimeView: TabRuntimeView = {executionState:'stopped',operationState:'none',graphDriftState:'in-sync',graphSubmissionState:'none',graphSubmissionUpdatedAt:null,runIntent:'create-session'};
const context: TabExecutionContext = {sessionId:'session_123',session:{id:'session_123',name:'receiver.gr4s',state:'stopped',createdAt:'2026-11-15T10:15:00Z',updatedAt:'2026-11-15T10:16:00Z',lastError:null,schedulerId:'gr::scheduler::SimpleMulti'},lastSubmittedHash:null,submittedNodeIdentities:null,graphSubmissionUpdatedAt:null,lastAction:null,lastActionStatus:'idle',busy:false,lastError:null,lastUpdatedAt:null,sessionRefreshedAt:null,activity:[]};
const graphProps = {name:'Untitled.gr4s',description:'',onDescriptionChange:()=>{},blockCount:0,connectionCount:0,schedulers:['gr::scheduler::SimpleMulti'],schedulersPending:false,schedulersError:false,onSchedulerChange:()=>{},mode:'in_app' as const,displayTitle:'',displayTitlePlaceholder:'Untitled.gr4s',inProcessControlPlane:false,onModeChange:()=>{},onDisplayTitleChange:()=>{},runtimeView,canExport:true,onExport:()=>{},exportError:null};

describe('Graph inspector', () => {
  it('leads with graph identity and compact statistics and preserves the empty description behavior', () => {
    const html = renderToStaticMarkup(<GraphDetails {...graphProps} />);
    expect(html).toContain('>Untitled.gr4s</h2>');
    expect(html).toContain('0 blocks · 0 connections');
    expect(html).toContain('aria-label="Graph description"');
    expect(html).toContain('placeholder="Add description…"');
    expect(html).not.toContain('Run creates');
    expect(html).not.toContain('no snapshot baseline');
    expect(html).not.toContain('n/a');
    expect(html).toContain('Download .gr4c');
  });
  it('keeps scheduler values canonical, uses readable labels and discloses submission metadata', () => {
    const html = renderToStaticMarkup(<GraphDetails {...graphProps} blockCount={2} connectionCount={1} schedulerId="gr::scheduler::SimpleMulti"
      runtimeView={{...runtimeView,graphSubmissionState:'stale',graphSubmissionUpdatedAt:'2026-11-15T10:15:00Z'}} />);
    expect(html).toContain('2 blocks · 1 connection');
    expect(html).toContain('value="gr::scheduler::SimpleMulti"');
    expect(html).toContain('>Simple Multi</option>');
    expect(html).toContain('>Stale<');
    expect(html).toContain('Last submitted');
    expect(html).not.toMatch(/<details[^>]*\bopen/);
  });
  it('retains the WASM display restriction and distinct display title', () => {
    const html = renderToStaticMarkup(<GraphDetails {...graphProps} name="document.gr4s" displayTitle="Receiver" inProcessControlPlane />);
    expect(html).toContain('>document.gr4s</h2>');
    expect(html).toContain('value="Receiver"');
    expect(html).toContain('WASM supports in-app displays only.');
    expect(html).not.toContain('value="popout"');
  });
  it('handles short, namespaced and templated scheduler names without altering IDs', () => {
    expect(schedulerDisplayName('SimpleMulti')).toBe('Simple Multi');
    expect(schedulerDisplayName('gr::scheduler::SimpleSingle')).toBe('Simple Single');
    expect(schedulerDisplayName('gr::scheduler::SimpleMulti<gr::Policy>')).toBe('Simple Multi');
    expect(schedulerDisplayName()).toBe('Default scheduler');
  });
});

describe('Session inspector', () => {
  it('shows a compact unlinked state without empty metadata or refresh controls', () => {
    const html = renderToStaticMarkup(<SessionDetails runtimeView={null} canRefresh={false} onRefresh={()=>{}} />);
    expect(html).toContain('No session linked');
    expect(html).not.toContain('Session ID');
    expect(html).not.toContain('Refresh session');
    expect(html).not.toContain('n/a');
  });
  it.each(['stopped','running','error'] as const)('preserves backend state %s', (state) => {
    const html = renderToStaticMarkup(<SessionDetails context={{...context,session:{...context.session!,state}}} runtimeView={runtimeView} canRefresh onRefresh={()=>{}} />);
    expect(html).toContain(`data-runtime-status="${state}"`);
    expect(html).toContain('>receiver.gr4s</h2>');
    expect(html).toContain('No activity yet.');
    expect(html).toContain('aria-label="Copy session ID"');
  });
  it('does not relabel a stopped session with a start error as failed', () => {
    const html = renderToStaticMarkup(<SessionDetails context={{...context,lastAction:'start',lastActionStatus:'error',lastError:'start failed: device unavailable'}} runtimeView={runtimeView} canRefresh onRefresh={()=>{}} />);
    expect(html).toContain('data-runtime-status="stopped"');
    expect(html).toContain('Runtime start failed');
    expect(html).not.toContain('data-runtime-status="error"');
  });
  it('bounds primary errors while keeping complete raw diagnostics behind a disclosure', () => {
    const raw = 'Unrecognized failure: ' + 'diagnostic '.repeat(5000);
    const html = renderToStaticMarkup(<SessionError message={raw} />);
    const primary = html.split('Technical details')[0];
    expect(primary.length).toBeLessThan(1500);
    expect(html).toContain(raw);
    expect(html).toContain('aria-label="Copy complete error"');
    expect(html).toContain('class="inspector-diagnostics"');
    expect(html).not.toMatch(/<details[^>]*\bopen/);
  });
  it('shows five newest events initially with access to the entire retained history', () => {
    const activity = Array.from({length:9},(_,i)=>({timestamp:`2026-11-15T10:15:0${i}Z`,action:'refresh',level:'info' as const,message:`Event ${i}`}));
    const html = renderToStaticMarkup(<SessionDetails context={{...context,activity}} runtimeView={{...runtimeView,graphDriftState:'out-of-sync',graphSubmissionState:'stale'}} canRefresh onRefresh={()=>{}} />);
    expect(html).toContain('Out of sync');
    expect(html).toContain('Event 0');
    expect(html).toContain('Event 4');
    expect(html).not.toContain('Event 5');
    expect(html).toContain('Show all activity (9)');
  });
  it('keeps a distinct backend error accessible when an operation error takes priority', () => {
    const html = renderToStaticMarkup(<SessionDetails context={{...context,lastError:'Refresh request failed',session:{...context.session!,lastError:'Backend device failure'}}} runtimeView={runtimeView} canRefresh onRefresh={()=>{}} />);
    expect(html).toContain('Additional backend error');
    expect(html).toContain('Backend device failure');
  });
  it('formats valid times consistently and omits invalid timestamp fields', () => {
    expect(validTimestamp('bad')).toBeUndefined();
    expect(validTimestamp('1970-01-01T00:00:00Z')?.getTime()).toBe(0);
    expect(compactTime('bad')).toBe('Unknown time');
    const html = renderToStaticMarkup(<SessionDetails context={{...context,session:{...context.session!,createdAt:'',updatedAt:''}}} runtimeView={runtimeView} canRefresh onRefresh={()=>{}} />);
    expect(html).not.toContain('Invalid Date');
    expect(html).not.toContain('Last refreshed');
  });
});
