import { describe, expect, it } from 'vitest';
import { activitySummary, activityTone, presentSessionError } from './session-diagnostics';

describe('Session diagnostics presentation', () => {
  it('extracts real GR4 unknown-setting diagnostics without assuming a specific block or parameter', () => {
    const detail = "session session_123 prepare failed: block 'mixer_0' of type 'gr::Mixer<std::complex<float>>' declares no setting named 'gian'; the nearest are ['gain']";
    const original = `app-api request failed: ${detail}: route=app-api url=/api/sessions/session_123/start upstream=${JSON.stringify({error:{code:'runtime_failure',message:detail}})}`;
    const error = presentSessionError(original, 'create');
    expect(error).toMatchObject({title:'Runtime preparation failed',block:'mixer_0',setting:'gian',explanation:'The block does not recognize this setting.',original});
    expect(error.diagnostics).toContain('\n  "error": {');
    expect(error.diagnostics).toContain('route=app-api url=/api/sessions/session_123/start');
    expect(error.diagnostics).toContain("the nearest are ['gain']");
  });

  it('prefers structured fields over heuristic extraction from message text', () => {
    const original = JSON.stringify({error:{code:'RUNTIME_START_FAILED',message:'Session start failed',details:{
      block_instance_name:'oscillator',setting:'frequency_offset',reason:'Unknown setting',operation:'start',
    }}});
    expect(presentSessionError(original)).toMatchObject({title:'Runtime start failed',block:'oscillator',setting:'frequency_offset',explanation:'The block does not recognize this setting.'});
  });

  it('supports legacy error envelopes, direct messages and strict double JSON encoding', () => {
    expect(presentSessionError(JSON.stringify({error_code:'SESSION_REFRESH_FAILED',error_message:'Permission denied'})))
      .toMatchObject({title:'Session refresh failed',explanation:'Permission denied'});
    expect(presentSessionError(JSON.stringify(JSON.stringify({error:{message:'Failed to stop runtime'}}))))
      .toMatchObject({title:'Runtime stop failed',explanation:'Failed to stop runtime'});
    expect(presentSessionError(JSON.stringify({error:'Access denied'})).explanation).toBe('Access denied');
  });

  it('summarizes network, timeout and arbitrary failures without inventing a fix', () => {
    expect(presentSessionError('Connection refused', 'refresh')).toMatchObject({title:'Session refresh failed',explanation:'Connection refused'});
    expect(presentSessionError('Session did not converge to running in time.', 'start').explanation).toBe('Session did not converge to running in time.');
    expect(presentSessionError('Unexpected scheduler fault')).toMatchObject({title:'Runtime error',explanation:'Unexpected scheduler fault'});
    expect(presentSessionError('Error near block names and settings')).not.toHaveProperty('setting', 'settings');
  });

  it('bounds unknown summaries but retains every character of the original diagnostic', () => {
    const raw = 'Unrecognized device error: ' + 'raw-output '.repeat(20000);
    const error = presentSessionError(raw);
    expect(error.explanation.length).toBeLessThanOrEqual(180);
    expect(error.explanation).toMatch(/^Unrecognized device error:/);
    expect(error.original).toBe(raw);
    expect(error.diagnostics).toBe(raw);
  });

  it.each(['{"unexpected":{"dump":"raw"}}', '[{"trace":"raw"}]', '{malformed json'])('keeps unrecognized JSON out of the primary summary: %s', (raw) => {
    const error = presentSessionError(raw);
    expect(error.explanation).toBe('See technical details for the complete error response.');
    expect(error.original).toBe(raw);
    expect(error.diagnostics).toContain(raw.startsWith('{malformed') ? '{malformed json' : 'raw');
  });

  it('does not scan arbitrary braces or interpret unrelated diagnostic properties as an error', () => {
    const raw = 'An error occurred {this is not an envelope}';
    expect(presentSessionError(raw).explanation).toBe(raw);
    expect(presentSessionError('{"other":{"message":"Invented cause","setting":"secret"}}').setting).toBeUndefined();
    const error = presentSessionError('Query error: route=app-api url=/api/sessions/x upstream={broken');
    expect(error.explanation).toBe('Query error:');
    expect(error.diagnostics).toContain('upstream={broken');
  });

  it('does not use the request route as evidence of which runtime phase failed', () => {
    const raw = 'app-api request failed: rejected: route=app-api url=/api/sessions/x/start upstream={"error":{"message":"Rejected"}}';
    expect(presentSessionError(raw).title).toBe('Runtime error');
  });

  it.each(['constructor', 'toString', '__proto__'])('treats unfamiliar operation values as unrecognized: %s', (operation) => {
    expect(presentSessionError(JSON.stringify({error:{operation,message:'Unrecognized failure'}})).title).toBe('Runtime error');
    expect(presentSessionError('Unrecognized failure', operation).title).toBe('Runtime error');
  });

  it('keeps activity summaries short and distinguishes explicit success from information', () => {
    const error = {timestamp:'',action:'start',level:'error' as const,message:'start failed: ' + 'trace '.repeat(200)};
    expect(activitySummary(error)).toBe('Runtime start failed');
    expect(activityTone(error)).toBe('error');
    const created = {...error,action:'create',level:'info' as const,message:'Created session some-long-id.'};
    expect(activitySummary(created)).toBe('Session created');
    expect(activityTone(created)).toBe('success');
    expect(activityTone({...created,message:'Waiting for session readiness…'})).toBe('info');
    expect(activitySummary({...created,message:'{"diagnostic":"raw"}'})).toBe('Session activity');
  });
});
