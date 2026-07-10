export type PlotKind = 'timeseries' | 'fft' | 'waterfall' | 'histogram' | 'scatter';

export type PhosphorSpectrumTuning = {
  intensity: number;
  decayMs: number;
  colorMap: string;
};

export type PlotViewSpec = {
  kind: PlotKind;
  title?: string;
  xLabel?: string;
  yLabel?: string;
  seriesLabels?: string[];
  legend?: boolean;
  streaming?: boolean;
  xMode?: 'time' | 'sample-index' | 'frequency';
  windowSize?: number;
  xRange?: {
    min?: number;
    max?: number;
    auto?: boolean;
  };
  yRange?: {
    min?: number;
    max?: number;
    auto?: boolean;
  };
  plotColors?: string[];
  colorAssignmentMode?: 'byIndex';
  maxLabels?: number;
  phosphor?: PhosphorSpectrumTuning;
};

export type PlotSeriesFrame = {
  id: string;
  label: string;
  x?: number[] | Float64Array;
  y: number[] | Float32Array | Float64Array;
};

export type PlotTagValue = string | number | boolean | null;

export type PlotTagAnnotation = {
  key: string;
  label: string;
  offset?: number;
  x?: number;
  y?: number;
  value?: PlotTagValue;
  metadata?: Record<string, PlotTagValue>;
};

export type PlotImageFrame = {
  width: number;
  height: number;
  values: number[] | Float32Array | Uint8Array;
  xAxis?: number[] | Float64Array;
  minValue?: number;
  maxValue?: number;
  timeSpan?: number;
  sampleType?: string;
  signalName?: string;
  signalUnit?: string;
  axisName?: string;
  axisUnit?: string;
  colorMap?: string;
};

export type PlotXyRenderMode = 'line' | 'scatter';
export type PlotAxisMode = 'x' | 'y' | 'xy';

export type PlotDataFrame = {
  kind: PlotKind;
  series?: PlotSeriesFrame[];
  image?: PlotImageFrame;
  meta?: {
    sequence?: number;
    emittedAtMs?: number;
    sampleRateHz?: number;
    liveIngressFpsHz?: number;
    domain?: 'time' | 'frequency' | 'image';
    xyRenderMode?: PlotXyRenderMode;
    xyPointSize?: number;
    xyPointAlpha?: number;
    tags?: PlotTagAnnotation[];
    state?: 'loading' | 'no-data' | 'error' | 'ready';
    errorKind?: 'invalid-binding' | 'runtime';
    errorMessage?: string;
    statusMessage?: string;
  };
};

export type PlotPanelSpec = {
  panelId: string;
  kind: PlotKind;
  source: {
    sinkId: string;
    channel?: string;
    field?: string;
    payloadFormat?: 'series-window-json-v1' | 'series2d-xy-json-v1' | 'dataset-xy-json-v1' | 'waterfall-spectrum-json-v1';
  };
  view: PlotViewSpec;
};

export type PlotRuntimeBinding = {
  status: 'unsupported' | 'unconfigured' | 'configured' | 'invalid';
  transport?: string;
  endpoint?: string;
  showEndpointInUi?: boolean;
  updateMs?: number;
  reason?: string;
};

export type PlotAdapterProps = {
  spec: PlotViewSpec;
  frame: PlotDataFrame;
  width: number;
  height: number;
  axisMode?: PlotAxisMode;
  viewResetKey?: number;
};
