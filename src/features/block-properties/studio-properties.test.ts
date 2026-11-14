import { describe, expect, it } from 'vitest';
import { studioFftSummary, studioPropertyChoices, validateStudioProperties, type StudioPropertyValues } from './studio-properties';
import { isDescriptorBindingHiddenParameter } from '../graph-editor/runtime/studio-managed-runtime-authoring';

const waterfall = 'gr::studio::StudioWaterfallSink<float32>';
const xy = 'gr::studio::Studio2DSeriesSink<complex<float32>>';
const dataset = 'gr::studio::StudioDataSetSink<float32>';
const literals = (values: Record<string, string | number | boolean>): StudioPropertyValues =>
  Object.fromEntries(Object.entries(values).map(([name, value]) => [name, { value: String(value), bindingKind: 'literal' }]));

describe('Studio properties', () => {
  it('limits choices to the exact registered block capabilities', () => {
    expect(studioPropertyChoices(dataset, 'transport')).toEqual(['http_snapshot', 'http_poll']);
    expect(studioPropertyChoices(waterfall, 'transport')).toContain('websocket');
    expect(studioPropertyChoices(xy, 'render_mode')).toEqual(['line', 'scatter']);
    expect(studioPropertyChoices('gr::studio::StudioWaterfallSink<unknown>', 'transport')).toBeUndefined();
  });

  it('omits ineffective fields without hiding waterfall intensity limits', () => {
    for (const name of ['x_min', 'x_max', 'y_min', 'y_max', 'topic']) {
      expect(isDescriptorBindingHiddenParameter(waterfall, name)).toBe(true);
    }
    expect(isDescriptorBindingHiddenParameter(waterfall, 'z_min')).toBe(false);
    expect(isDescriptorBindingHiddenParameter(xy, 'x_min')).toBe(false);
    expect(isDescriptorBindingHiddenParameter('other::Sink<float32>', 'topic')).toBe(false);
  });

  it('rejects zero, reversed and nonfinite manual ranges', () => {
    for (const bounds of [[0, 0], [2, -2], [0, 'NaN']]) {
      expect(validateStudioProperties(xy, literals({ autoscale: false, x_min: bounds[0], x_max: bounds[1] }))).toHaveProperty('x_max');
    }
    expect(validateStudioProperties(waterfall, literals({ autoscale: false, z_min: -140, z_max: 10 }))).toEqual({});
  });

  it('rejects invalid counts, cadence and point styling', () => {
    expect(validateStudioProperties(waterfall, literals({ sample_rate: 0, fft_size: 3.5, num_averages: -1, update_ms: '50ms' })))
      .toHaveProperty('sample_rate');
    expect(Object.keys(validateStudioProperties(xy, literals({ render_mode: 'dots', point_alpha: 1.5, point_size: 0 })))).toEqual(['render_mode', 'point_alpha', 'point_size']);
  });

  it('accepts the full dataset sentinel only for dataset inputs', () => {
    expect(validateStudioProperties(dataset, literals({ window_size: -1 }))).toEqual({});
    expect(validateStudioProperties(xy, literals({ window_size: -1 }))).toHaveProperty('window_size');
    expect(validateStudioProperties(dataset, literals({ signal_index: -1 }))).toHaveProperty('signal_index');
  });

  it('checks labels against input count and defers expression values', () => {
    expect(validateStudioProperties('gr::studio::StudioSeriesSink<float32>', literals({ n_inputs: 2, series_labels: 'left,right,extra' }))).toHaveProperty('series_labels');
    expect(validateStudioProperties(waterfall, { sample_rate: { value: 'samp_rate', bindingKind: 'expression' } })).toEqual({});
  });

  it('shows the same history rounding as the block', () => {
    expect(studioFftSummary(waterfall, literals({ fft_size: 1024, sample_rate: 48000, num_averages: 8, time_span: 5 })))
      .toEqual(['Bin spacing: 46.875 Hz', 'FFT duration: 21.3333 ms', 'Average window: 170.667 ms', 'History: 235 rows, 5.01333 s', 'Row duration: 21.3333 ms']);
    expect(studioFftSummary(waterfall, literals({ fft_size: 1024, sample_rate: 1, time_span: 256 })))
      .toContain('History: 1 row, 1,024 s');
  });

  it('does not invent derived values for unevaluated expressions', () => {
    expect(studioFftSummary(waterfall, { ...literals({ fft_size: 1024 }), sample_rate: { value: 'samp_rate', bindingKind: 'expression' } })).toEqual([]);
  });
});
