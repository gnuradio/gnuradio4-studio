import type { ReactElement } from 'react';
import type { StudioPanelKind } from '../../graph-document/model/studio-workspace';
import type { WorkspaceLiveRendererContext } from './live-renderer-contract';
import { AudioLiveRenderer } from './audio-live-renderer';
import { PhosphorSpectrumLiveRenderer } from './histogram-live-renderer';
import { ScalarStatusLiveRenderer } from './scalar-status-live-renderer';
import { SeriesLiveRenderer } from './series-live-renderer';
import { WaterfallLiveRenderer } from './waterfall-live-renderer';

export type WorkspacePanelRendererProps = {
  kind: StudioPanelKind;
  liveContext: WorkspaceLiveRendererContext;
};

function RendererFrame({
  title,
  subtitle,
  accentClassName,
}: {
  title: string;
  subtitle: string;
  accentClassName: string;
}) {
  return (
    <div className="mt-3 rounded border border-slate-700 bg-slate-950/70 p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-semibold text-slate-100">{title}</p>
        <span className={`h-2.5 w-2.5 rounded-full ${accentClassName}`} />
      </div>
      <p className="mt-2 text-[11px] text-slate-400">{subtitle}</p>
      <div className="mt-3 h-20 rounded border border-dashed border-slate-700 bg-slate-900/50" />
    </div>
  );
}

function Series2DPlaceholderRenderer({ liveContext }: { liveContext: WorkspaceLiveRendererContext }) {
  return (
    <RendererFrame
      title="2D Series Placeholder"
      subtitle={`XY/trajectory renderer hook point. state=${liveContext.dataState.kind}`}
      accentClassName="bg-indigo-400"
    />
  );
}

function ImagePlaceholderRenderer({ liveContext }: { liveContext: WorkspaceLiveRendererContext }) {
  return (
    <RendererFrame
      title="Image Placeholder"
      subtitle={`Frame/image renderer hook point. state=${liveContext.dataState.kind}`}
      accentClassName="bg-amber-400"
    />
  );
}

function ScalarLiveRenderer({ liveContext }: { liveContext: WorkspaceLiveRendererContext }) {
  return <ScalarStatusLiveRenderer liveContext={liveContext} presentation="scalar" />;
}

function StatusLiveRenderer({ liveContext }: { liveContext: WorkspaceLiveRendererContext }) {
  return <ScalarStatusLiveRenderer liveContext={liveContext} presentation="status" />;
}

const RENDERER_BY_KIND = {
  series: SeriesLiveRenderer,
  series2d: Series2DPlaceholderRenderer,
  histogram: PhosphorSpectrumLiveRenderer,
  waterfall: WaterfallLiveRenderer,
  image: ImagePlaceholderRenderer,
  audio: AudioLiveRenderer,
  scalar: ScalarLiveRenderer,
  status: StatusLiveRenderer,
} as Record<StudioPanelKind, (props: { liveContext: WorkspaceLiveRendererContext }) => ReactElement>;

export function WorkspacePanelRenderer({ kind, liveContext }: WorkspacePanelRendererProps) {
  const Component = RENDERER_BY_KIND[kind];
  return <Component liveContext={liveContext} />;
}
