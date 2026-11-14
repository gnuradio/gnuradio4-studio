import { lookupStudioKnownBlockBinding } from '../graph-editor/runtime/known-block-bindings';
import { getAuthoringParameterLabel } from '../graph-editor/runtime/studio-managed-runtime-authoring';

type PropertyValue = { value: string; bindingKind: 'literal' | 'expression' };
export type StudioPropertyValues = Record<string, PropertyValue>;

export function studioPropertyChoices(blockTypeId: string, name: string): readonly string[] | undefined {
  const binding = lookupStudioKnownBlockBinding(blockTypeId);
  if (!binding) return undefined;
  if (name === 'transport') return binding.supportedTransports;
  if (name === 'render_mode') return ['line', 'scatter'];
  if (name === 'window_mode') return ['rolling', 'buffered'];
  if (name === 'channels' && binding.family === 'image') return ['1', '3', '4'];
  return undefined;
}

export function validateStudioProperties(blockTypeId: string, values: StudioPropertyValues): Record<string, string> {
  if (!lookupStudioKnownBlockBinding(blockTypeId)) return {};
  const errors: Record<string, string> = {};
  const number = (name: string): number | undefined => {
    const entry = values[name];
    return entry?.bindingKind === 'literal' ? Number(entry.value.trim() || NaN) : undefined;
  };
  const positiveIntegers = new Set(['fft_size', 'num_averages', 'window_size', 'n_inputs', 'channels',
    'width', 'height', 'update_ms', 'poll_ms', 'frame_ms', 'buffer_ms']);
  const nonnegativeIntegers = new Set(['signal_index', 'axis_index', 'max_labels']);
  const positive = new Set(['sample_rate', 'time_span', 'point_size', 'phosphor_decay_ms', 'phosphor_intensity']);
  const finite = new Set(['center_freq', 'gain', 'point_alpha', 'x_min', 'x_max', 'y_min', 'y_max', 'z_min', 'z_max']);
  for (const [name, entry] of Object.entries(values)) {
    if (entry.bindingKind !== 'literal') continue;
    const label = getAuthoringParameterLabel(blockTypeId, name, name);
    const choices = studioPropertyChoices(blockTypeId, name);
    if (choices && !choices.includes(entry.value)) errors[name] = `${label}: choose ${choices.join(', ')}.`;
    const value = number(name)!;
    if (name === 'window_size' && value === -1 &&
        lookupStudioKnownBlockBinding(blockTypeId)?.payloadFormat === 'dataset-xy-json-v1') continue;
    if (positiveIntegers.has(name) && (!Number.isSafeInteger(value) || value <= 0))
      errors[name] = `${label} must be a positive whole number.`;
    if (nonnegativeIntegers.has(name) && (!Number.isSafeInteger(value) || value < 0))
      errors[name] = `${label} must be a nonnegative whole number.`;
    if (positive.has(name) && (!Number.isFinite(value) || value <= 0))
      errors[name] = `${label} must be greater than zero.`;
    if (finite.has(name) && !Number.isFinite(value)) errors[name] = `${label} must be a finite number.`;
    if (name === 'point_alpha' && (value < 0 || value > 1)) errors[name] = 'Point opacity must be between 0 and 1.';
    if (name === 'n_inputs' && value > 32) errors[name] = 'Input ports must be between 1 and 32.';
  }
  if (values.autoscale?.bindingKind === 'literal' && values.autoscale.value === 'false') {
    const axes = lookupStudioKnownBlockBinding(blockTypeId)?.family === 'waterfall' ? ['z'] : ['x', 'y'];
    for (const axis of axes) {
      const min = number(`${axis}_min`), max = number(`${axis}_max`);
      if (min !== undefined && max !== undefined && min >= max)
        errors[`${axis}_max`] = `${getAuthoringParameterLabel(blockTypeId, `${axis}_max`, `${axis} max`)} must be greater than the minimum.`;
    }
  }
  const channels = number('channels') ?? number('n_inputs');
  if (channels !== undefined) {
    for (const name of ['labels', 'units', 'series_labels']) {
      const entry = values[name];
      if (entry?.bindingKind === 'literal' && entry.value.trim() && entry.value.split(',').length > channels)
        errors[name] = `Provide at most ${channels} entries, in input order.`;
    }
  }
  return errors;
}

export function studioFftSummary(blockTypeId: string, values: StudioPropertyValues): string[] {
  const binding = lookupStudioKnownBlockBinding(blockTypeId);
  if (!binding?.parameters.sampleRate || !values.fft_size) return [];
  const number = (name: string) => values[name]?.bindingKind === 'literal' ? Number(values[name].value) : NaN;
  const size = number('fft_size'), rate = number('sample_rate'), averages = number('num_averages');
  if (!Number.isSafeInteger(size) || size < 1 || !Number.isFinite(rate) || rate <= 0) return [];
  const format = (value: number) => Number(value.toPrecision(6)).toLocaleString('en-US', { maximumSignificantDigits: 6 });
  const lines = [`Bin spacing: ${format(rate / size)} Hz`, `FFT duration: ${format(1000 * size / rate)} ms`];
  if (Number.isSafeInteger(averages) && averages > 0) lines.push(`Average window: ${format(1000 * averages * size / rate)} ms`);
  const span = number('time_span');
  if (binding.family === 'waterfall' && Number.isFinite(span) && span > 0) {
    const rows = Math.max(1, Math.ceil(Math.ceil(span * rate) / size));
    lines.push(`History: ${format(rows)} ${rows === 1 ? 'row' : 'rows'}, ${format(rows * size / rate)} s`);
    lines.push(`Row duration: ${format(1000 * size / rate)} ms`);
  }
  return lines;
}

export function studioPropertyGroup(blockTypeId: string, name: string): string {
  if (!lookupStudioKnownBlockBinding(blockTypeId)) return '';
  if (['transport', 'endpoint', 'update_ms', 'poll_ms', 'frame_ms', 'buffer_ms'].includes(name)) return 'Updates and connection';
  if (['sample_rate', 'center_freq', 'fft_size', 'num_averages', 'window', 'time_span', 'window_size',
    'window_mode', 'n_inputs', 'channels', 'width', 'height', 'signal_index', 'axis_index'].includes(name)) return 'Input';
  return 'Display';
}
