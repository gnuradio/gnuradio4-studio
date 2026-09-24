import { describe, expect, it } from 'vitest';
import type { ApplicationMode } from '../../graph-document/model/studio-workspace';
import { effectiveApplicationMode } from './application-mode';

describe('effectiveApplicationMode', () => {
  it('keeps every mode as saved with a native control plane', () => {
    const modes: ApplicationMode[] = ['in_app', 'new_tab', 'popout', 'external'];
    for (const mode of modes) {
      expect(effectiveApplicationMode(mode, { inProcessControlPlane: false })).toBe(mode);
    }
  });

  it('runs separate-window modes in-app with the in-process WASM control plane', () => {
    expect(effectiveApplicationMode('new_tab', { inProcessControlPlane: true })).toBe('in_app');
    expect(effectiveApplicationMode('popout', { inProcessControlPlane: true })).toBe('in_app');
  });

  it('leaves the modes that do not open another window alone with the WASM control plane', () => {
    expect(effectiveApplicationMode('in_app', { inProcessControlPlane: true })).toBe('in_app');
    expect(effectiveApplicationMode('external', { inProcessControlPlane: true })).toBe('external');
  });
});
