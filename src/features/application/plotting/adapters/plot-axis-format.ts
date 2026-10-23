import type uPlot from 'uplot';
import type { PlotAxisMetadata, PlotViewSpec } from '../model/types';

export function frequencyDisplayUnit(min: number, max: number): { scale: number; unit: string } {
  const magnitude = Math.max(Math.abs(min), Math.abs(max));
  if (magnitude >= 1e9) return { scale: 1e9, unit: 'GHz' };
  if (magnitude >= 1e6) return { scale: 1e6, unit: 'MHz' };
  if (magnitude >= 1e3) return { scale: 1e3, unit: 'kHz' };
  return { scale: 1, unit: 'Hz' };
}

export function formatFrequencyTicks(splits: readonly number[], scale: number): string[] {
  let step = Number.POSITIVE_INFINITY;
  for (let i = 1; i < splits.length; i += 1) {
    const difference = Math.abs(splits[i] - splits[i - 1]) / scale;
    if (difference > 0) step = Math.min(step, difference);
  }
  // One extra digit retains fractional increments such as 2.5; trim redundant zeros.
  const decimals = Number.isFinite(step) ? Math.min(12, Math.max(0, 1 - Math.floor(Math.log10(step)))) : 6;
  return splits.map((value) => {
    const text = (value / scale).toFixed(decimals).replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
    return text === '-0' ? '0' : text;
  });
}

function axisName(name: string | undefined, fallback: string): string {
  const text = name?.trim() || fallback;
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function buildPlotXAxis(spec: PlotViewSpec, metadata?: PlotAxisMetadata): uPlot.Axis {
  const frequency = metadata?.axisUnit === 'Hz' || (!metadata?.axisUnit && spec.xMode === 'frequency');
  const name = spec.xLabel ?? axisName(metadata?.axisName, frequency ? 'Frequency' : 'sample');
  if (!frequency) {
    return { label: spec.xLabel ?? `${name}${metadata?.axisUnit ? ` (${metadata.axisUnit})` : ''}` };
  }
  return {
    label: (chart) => {
      const unit = frequencyDisplayUnit(chart.scales.x.min ?? 0, chart.scales.x.max ?? 0).unit;
      return `${name.replace(/\s*\((?:Hz|kHz|MHz|GHz)\)\s*$/, '')} (${unit})`;
    },
    values: (chart, splits) => formatFrequencyTicks(splits,
      frequencyDisplayUnit(chart.scales.x.min ?? 0, chart.scales.x.max ?? 0).scale),
    space: (_chart, _axis, min, max) => {
      const { scale } = frequencyDisplayUnit(min, max);
      const labels = formatFrequencyTicks([min, min + (max - min) / 10, max], scale);
      return Math.max(80, Math.max(...labels.map((label) => label.length)) * 7 + 24);
    },
  };
}

export function buildPlotYLabel(spec: PlotViewSpec, metadata?: PlotAxisMetadata): string {
  return spec.yLabel ?? `${axisName(metadata?.signalName, 'value')}${metadata?.signalUnit ? ` (${metadata.signalUnit})` : ''}`;
}
