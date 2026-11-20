import type { PlotAdapterProps } from '../model/types';
import { PhosphorSpectrumUplotAdapter } from './histogram-spectrum-uplot-adapter';
import { TimeseriesUplotAdapter } from './timeseries-uplot-adapter';
import { WaterfallCanvasAdapter } from './waterfall-canvas-adapter';

export function PlotAdapterSwitch(props: PlotAdapterProps) {
  if (props.spec.kind === 'timeseries') {
    return <TimeseriesUplotAdapter {...props} />;
  }
  if (props.spec.kind === 'histogram') {
    return <PhosphorSpectrumUplotAdapter {...props} />;
  }
  if (props.spec.kind === 'waterfall') {
    return <WaterfallCanvasAdapter {...props} />;
  }

  return (
    <div className="h-full min-h-[9rem] rounded border border-slate-700 bg-slate-950/70 p-3">
      <div className="text-xs font-semibold text-slate-100">Plot adapter placeholder</div>
      <p className="mt-2 text-xs text-slate-400">
        Plot kind &quot;{props.spec.kind}&quot; is not wired in Step 1.
      </p>
    </div>
  );
}
