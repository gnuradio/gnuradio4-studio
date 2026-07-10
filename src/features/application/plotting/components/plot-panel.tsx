import { useState } from 'react';
import type { PlotAxisMode, PlotPanelSpec, PlotRuntimeBinding } from '../model/types';
import { PlotSurface } from './plot-surface';
import { useTimeseriesLiveFrame } from '../runtime/timeseries-live-runtime';

type PlotPanelProps = {
  spec: PlotPanelSpec;
  binding: PlotRuntimeBinding;
  executionState?: 'idle' | 'ready' | 'running' | 'stopped' | 'error';
};

export function PlotPanel({ spec, binding, executionState }: PlotPanelProps) {
  const [isPaused, setIsPaused] = useState(false);
  const [axisMode, setAxisMode] = useState<PlotAxisMode>('x');
  const [viewResetKey, setViewResetKey] = useState(0);
  const frame = useTimeseriesLiveFrame({
    spec,
    binding,
    executionState,
    isPaused,
  });

  return (
    <PlotSurface
      spec={spec.view}
      frame={frame}
      binding={binding}
      isPaused={isPaused}
      onPausedChange={setIsPaused}
      axisMode={axisMode}
      onAxisModeChange={setAxisMode}
      viewResetKey={viewResetKey}
      onViewReset={() => setViewResetKey((key) => key + 1)}
    />
  );
}
