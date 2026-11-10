import { describe, expect, it } from 'vitest';
import { ApiClientError } from '../../lib/api/client';
import {
  parseRuntimeSettingsArray,
  runtimeSettingToGraphLiteral,
  resolveRuntimeSettingsAvailability,
  shouldApplyRuntimeSettingImmediately,
  shouldPropagateResolvedRuntimeSetting,
  toRuntimeSettingsErrorMessage,
} from './runtime-settings-model';

describe('runtime-settings-model', () => {
  it('reports unavailable when no selected block exists', () => {
    expect(
      resolveRuntimeSettingsAvailability({
        session: null,
        sessionId: null,
        selectedNodeRuntimeName: null,
        graphDriftState: null,
      }),
    ).toEqual({
      state: 'unavailable',
      reason: 'Select a block to inspect runtime settings.',
    });
  });

  it('reports unavailable when session is not linked or not running', () => {
    expect(
      resolveRuntimeSettingsAvailability({
        session: null,
        sessionId: null,
        selectedNodeRuntimeName: 'sig0',
        graphDriftState: 'in-sync',
      }),
    ).toEqual({
      state: 'unavailable',
      reason: 'No session linked to this tab.',
    });

    expect(
      resolveRuntimeSettingsAvailability({
        session: {
          id: 'sess_1',
          name: 'demo',
          state: 'stopped',
          createdAt: '',
          updatedAt: '',
          lastError: null,
        },
        sessionId: 'sess_1',
        selectedNodeRuntimeName: 'sig0',
        graphDriftState: 'in-sync',
      }),
    ).toEqual({
      state: 'unavailable',
      reason: 'Linked session is not running.',
    });
  });

  it('reports unavailable when local graph drift breaks runtime identity confidence', () => {
    expect(
      resolveRuntimeSettingsAvailability({
        session: {
          id: 'sess_1',
          name: 'demo',
          state: 'running',
          createdAt: '',
          updatedAt: '',
          lastError: null,
        },
        sessionId: 'sess_1',
        selectedNodeRuntimeName: 'sig0',
        graphDriftState: 'out-of-sync',
      }),
    ).toEqual({
      state: 'unavailable',
      reason: 'Graph changed since the linked runtime snapshot; refresh or rerun before editing runtime settings.',
    });
  });

  it('resolves a ready state for running sessions and selected blocks', () => {
    expect(
      resolveRuntimeSettingsAvailability({
        session: {
          id: 'sess_1',
          name: 'demo',
          state: 'running',
          createdAt: '',
          updatedAt: '',
          lastError: null,
        },
        sessionId: 'sess_1',
        selectedNodeRuntimeName: 'sig0',
        graphDriftState: 'in-sync',
      }),
    ).toEqual({
      state: 'ready',
      sessionId: 'sess_1',
      uniqueName: 'sig0',
    });
  });

  it('uses the resolved runtime name instead of assuming the editor instance id', () => {
    expect(
      resolveRuntimeSettingsAvailability({
        session: {
          id: 'sess_1',
          name: 'demo',
          state: 'running',
          createdAt: '',
          updatedAt: '',
          lastError: null,
        },
        sessionId: 'sess_1',
        selectedNodeRuntimeName: 'src0',
        graphDriftState: 'in-sync',
      }),
    ).toEqual({
      state: 'ready',
      sessionId: 'sess_1',
      uniqueName: 'src0',
    });
  });

  it('maps backend/runtime failures into user-facing messages', () => {
    expect(
      toRuntimeSettingsErrorMessage(
        new ApiClientError('Request failed', 'HTTP', 409, 'session runtime is not running'),
      ),
    ).toBe('Linked session is not running.');

    expect(
      toRuntimeSettingsErrorMessage(
        new ApiClientError('Request failed', 'HTTP', 404, 'block not found in running session'),
      ),
    ).toBe('Runtime block was not found in the linked session.');

    expect(
      toRuntimeSettingsErrorMessage(
        new ApiClientError('Request failed', 'HTTP', 400, 'unsupported array values'),
      ),
    ).toBe('unsupported array values');

    expect(
      toRuntimeSettingsErrorMessage(
        new ApiClientError('Request failed', 'HTTP', 504, 'timeout waiting for reply'),
      ),
    ).toBe('Timed out while waiting for the runtime settings reply.');
  });

  it('applies live visualization settings immediately', () => {
    expect(shouldApplyRuntimeSettingImmediately('autoscale')).toBe(true);
    expect(shouldApplyRuntimeSettingImmediately('update_ms')).toBe(true);
    expect(shouldApplyRuntimeSettingImmediately('poll_ms')).toBe(true);
    expect(shouldApplyRuntimeSettingImmediately('persistence')).toBe(true);
    expect(shouldApplyRuntimeSettingImmediately('phosphor_intensity')).toBe(true);
    expect(shouldApplyRuntimeSettingImmediately('phosphor_decay_ms')).toBe(true);
    expect(shouldApplyRuntimeSettingImmediately('x_min')).toBe(true);
    expect(shouldApplyRuntimeSettingImmediately('x_max')).toBe(true);
    expect(shouldApplyRuntimeSettingImmediately('y_min')).toBe(true);
    expect(shouldApplyRuntimeSettingImmediately('y_max')).toBe(true);
    expect(shouldApplyRuntimeSettingImmediately('z_min')).toBe(true);
    expect(shouldApplyRuntimeSettingImmediately('z_max')).toBe(true);
    expect(shouldApplyRuntimeSettingImmediately('sample_rate')).toBe(false);
    expect(shouldApplyRuntimeSettingImmediately('endpoint')).toBe(false);
  });

  it('propagates resolved expression settings for live variable controls', () => {
    expect(shouldPropagateResolvedRuntimeSetting({ name: 'alpha', bindingKind: 'expression' })).toBe(true);
    expect(shouldPropagateResolvedRuntimeSetting({ name: 'sample_rate', bindingKind: 'literal' })).toBe(false);
    expect(shouldPropagateResolvedRuntimeSetting({ name: 'poll_ms', bindingKind: 'literal' })).toBe(true);
  });
});

describe('runtime collection values', () => {
  it('parses frequency lists, empty lists, and recursive JSON settings', () => {
    expect(parseRuntimeSettingsArray('[107e6, 108000000]')).toEqual([107000000, 108000000]);
    expect(parseRuntimeSettingsArray('[]')).toEqual([]);
    expect(parseRuntimeSettingsArray('[true, "RX", null, {"real": 1, "imag": 2}, [3]]'))
      .toEqual([true, 'RX', null, { real: 1, imag: 2 }, [3]]);
  });

  it.each(['107000000', '"[107000000]"', '{}', 'null', '[107000000,]', '[1e400]'])
    ('refuses invalid list input %s before submission', (text) => {
      expect(() => parseRuntimeSettingsArray(text)).toThrow(/JSON list/);
    });

  it('keeps flat lists intact when applying runtime settings to graph properties', () => {
    expect(runtimeSettingToGraphLiteral([107000000, 108000000])).toBe('[107000000,108000000]');
    expect(runtimeSettingToGraphLiteral(['RX', 'TX'])).toBe('["RX","TX"]');
    expect(runtimeSettingToGraphLiteral([])).toBe('[]');
    expect(runtimeSettingToGraphLiteral(42)).toBe('42');
    expect(runtimeSettingToGraphLiteral({ real: 1, imag: 0 })).toBeUndefined();
    expect(runtimeSettingToGraphLiteral([[1, 2]])).toBeUndefined();
  });
});
