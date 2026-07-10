import { useState } from 'react';
import type { PlotPanelSpec, PlotRuntimeBinding } from '../model/types';
import { PlotSurface } from './plot-surface';
import { useTimeseriesLiveFrame } from '../runtime/timeseries-live-runtime';

type PlotPanelProps = {
  spec: PlotPanelSpec;
  binding: PlotRuntimeBinding;
  executionState?: 'idle' | 'ready' | 'running' | 'stopped' | 'error';
};

export function PlotPanel({ spec, binding, executionState }: PlotPanelProps) {
  const [isPaused, setIsPaused] = useState(false);
  const frame = useTimeseriesLiveFrame({
    spec,
    binding,
    executionState,
    isPaused,
  });

  return <PlotSurface spec={spec.view} frame={frame} binding={binding} isPaused={isPaused} onPausedChange={setIsPaused} />;
}
