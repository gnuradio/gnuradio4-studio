import { describe, expect, it } from 'vitest';
import { buildPlotXAxis, buildPlotYLabel, formatFrequencyTicks, frequencyDisplayUnit } from './plot-axis-format';
import { parseLiveFrameFromPayload } from '../runtime/timeseries-live-runtime';
import { createPlotFrameController } from '../runtime/plot-frame-controller';

const view = { kind: 'timeseries' as const, xMode: 'frequency' as const };

describe('DataSet frequency axes', () => {
  it('formats the GHz range from the reported plot without long Hz labels', () => {
    const unit = frequencyDisplayUnit(2.76e9, 3.01e9);
    expect(unit).toEqual({ scale: 1e9, unit: 'GHz' });
    expect(formatFrequencyTicks([2.76e9, 2.77e9, 2.78e9], unit.scale)).toEqual(['2.76', '2.77', '2.78']);
  });

  it('keeps adjacent ticks distinct when zooming to individual Hz at GHz frequencies', () => {
    expect(formatFrequencyTicks([2.760000001e9, 2.760000002e9, 2.760000003e9], 1e9))
      .toEqual(['2.760000001', '2.760000002', '2.760000003']);
    expect(formatFrequencyTicks([0, 2.5, 5], 1)).toEqual(['0', '2.5', '5']);
  });

  it('selects Hz, kHz and MHz for lower frequency ranges', () => {
    expect(frequencyDisplayUnit(-100, 100).unit).toBe('Hz');
    expect(frequencyDisplayUnit(0, 2000).unit).toBe('kHz');
    expect(frequencyDisplayUnit(88e6, 108e6).unit).toBe('MHz');
  });

  it('uses metadata without assigning frequency units to other DataSet axes', () => {
    const axis = buildPlotXAxis(view, { axisName: 'distance', axisUnit: 'm' });
    expect(axis.label).toBe('Distance (m)');
    expect(axis.values).toBeUndefined();
    expect(buildPlotYLabel(view, { signalName: 'spectrum', signalUnit: 'dBm' })).toBe('Spectrum (dBm)');
    expect(buildPlotYLabel({ ...view, yLabel: 'Custom power' }, { signalUnit: 'dBm' })).toBe('Custom power');
  });

  it('retains axis metadata from the payload through frame ingestion without scaling RF coordinates', () => {
    const parsed = parseLiveFrameFromPayload({
      payloadFormat: 'dataset-xy-json-v1',
      payload: { payload_format: 'dataset-xy-json-v1', layout: 'pairs_xy', points: 2,
        axis_name: 'frequency', axis_unit: 'Hz', signal_name: 'spectrum', signal_unit: 'dBm',
        data: [[2.76e9, -100], [3.01e9, -90]] },
    });
    if (parsed.kind !== 'series') throw new Error('Expected a spectrum series');
    const controller = createPlotFrameController({ panelId: 'rf', kind: 'timeseries', source: { sinkId: 'dataset' }, view });
    controller.ingestSeries(parsed.series, 0, 'replace', { axisMetadata: parsed.axisMetadata });
    expect(controller.getFrame().meta?.axisMetadata).toEqual({
      axisName: 'frequency', axisUnit: 'Hz', signalName: 'spectrum', signalUnit: 'dBm',
    });
    expect(controller.getFrame().series?.[0].x).toEqual([2.76e9, 3.01e9]);
  });
});
