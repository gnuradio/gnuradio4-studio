import { useMemo, type ReactNode } from 'react';
import { Group, Panel, Separator } from 'react-resizable-panels';
import type { StudioLayoutSpec } from '../graph-document/model/studio-workspace';
import type { StudioLayoutNode } from '../graph-document/model/studio-workspace';
import { PlotPanel } from './plotting/components/plot-panel';
import { derivePlotPanelSpec } from './plotting/model/panel-spec';
import { WorkspacePanelRenderer } from '../workspace/renderers/panel-renderers';
import type { WorkspaceLiveRendererContext } from '../workspace/renderers/live-renderer-contract';
import type { WorkspacePanelViewModel } from '../workspace/workspace-view';
import { ControlPanelView } from '../control-panels/control-panel-view';
import type { ExpressionBinding } from '../variables/model/types';
import { readExplicitPlotPanelTitle } from './application-view-model';

type ApplicationViewProps = {
  panelEntries: readonly WorkspacePanelViewModel[];
  layout: StudioLayoutSpec;
  executionState?: 'idle' | 'ready' | 'running' | 'stopped' | 'error';
  onUpdateVariableValue?: (variableName: string, binding: ExpressionBinding) => void;
};

const MIN_APPLICATION_PANEL_HEIGHT_PX = 220;
const MIN_APPLICATION_LAYOUT_HEIGHT_PX = 384;

function countVisibleLayoutRows(
  node: StudioLayoutNode,
  visibleEntryByPanelId: ReadonlyMap<string, WorkspacePanelViewModel>,
): number {
  if (node.kind === 'pane') {
    return visibleEntryByPanelId.has(node.panelId) ? 1 : 0;
  }

  const childRows = node.children
    .map((child) => countVisibleLayoutRows(child, visibleEntryByPanelId))
    .filter((rowCount) => rowCount > 0);

  if (childRows.length === 0) {
    return 0;
  }

  return node.direction === 'column'
    ? childRows.reduce((sum, rowCount) => sum + rowCount, 0)
    : Math.max(...childRows);
}

function ApplicationPanelShell({
  entry,
  executionState,
  onUpdateVariableValue,
}: {
  entry: WorkspacePanelViewModel;
  executionState?: 'idle' | 'ready' | 'running' | 'stopped' | 'error';
  onUpdateVariableValue?: (variableName: string, binding: ExpressionBinding) => void;
}) {
  const { panel } = entry;
  const plotSpec = useMemo(() => derivePlotPanelSpec(entry), [entry]);
  if (panel.kind === 'control') {
    const shellTitle = entry.nodePanelTitle ?? panel.title ?? entry.nodeDisplayName ?? panel.id;
    return (
      <article className="h-full rounded-lg bg-slate-950/35 overflow-hidden flex flex-col min-h-0">
        <header className="px-3 py-2 border-b border-slate-800/80 bg-slate-900/55">
          <h3 className="text-sm font-semibold text-slate-100 truncate" title={shellTitle}>
            {shellTitle}
          </h3>
        </header>
        <div className="p-2 flex-1 min-h-0">
          <div className="h-full rounded border border-slate-700 bg-slate-950/50 p-3">
            <ControlPanelView widgets={entry.controlWidgets ?? []} onUpdateVariableValue={onUpdateVariableValue} />
          </div>
        </div>
      </article>
    );
  }

  const explicitPlotTitle = readExplicitPlotPanelTitle(entry.nodeParameters);
  const shellTitle =
    explicitPlotTitle ?? plotSpec?.view.title ?? entry.nodePanelTitle ?? panel.title ?? entry.nodeDisplayName ?? panel.nodeId;
  const showShellHeader = !plotSpec || explicitPlotTitle !== undefined;
  const liveContext: WorkspaceLiveRendererContext = {
    panel: {
      panelId: panel.id,
      nodeId: panel.nodeId,
      kind: panel.kind,
      title: shellTitle,
    },
    binding: {
      status: entry.bindingStatus ?? 'unsupported',
      transport: entry.bindingTransport,
      endpoint: entry.bindingEndpoint,
      showEndpointInUi: entry.bindingShowEndpointInUi,
      updateMs: entry.bindingUpdateMs,
      sampleRate: entry.bindingSampleRate,
      channels: entry.bindingChannels,
      reason: entry.bindingReason,
    },
    dataState:
      entry.bindingStatus === 'invalid'
        ? { kind: 'error', message: 'Binding is invalid for runtime rendering.' }
        : entry.bindingStatus === 'configured'
          ? { kind: 'no-data', reason: 'Live data is not available yet.' }
          : { kind: 'no-data', reason: 'Configure binding to enable runtime rendering.' },
    sessionId: entry.bindingSessionId,
    executionState,
  };
  return (
    <article className="h-full rounded-lg bg-slate-950/35 overflow-hidden flex flex-col min-h-0">
      {showShellHeader ? (
        <header className="px-3 py-2 border-b border-slate-800/80 bg-slate-900/55">
          <h3 className="text-sm font-semibold text-slate-100 truncate" title={shellTitle}>
            {shellTitle}
          </h3>
        </header>
      ) : null}
      <div className={`${showShellHeader ? 'p-2' : ''} flex-1 min-h-0`}>
        {plotSpec ? (
          <PlotPanel
            spec={plotSpec}
            binding={{
              status: liveContext.binding.status,
              transport: liveContext.binding.transport,
              endpoint: liveContext.binding.endpoint,
              showEndpointInUi: liveContext.binding.showEndpointInUi,
              updateMs: liveContext.binding.updateMs,
              reason: liveContext.binding.reason,
            }}
            executionState={executionState}
          />
        ) : (
          <WorkspacePanelRenderer kind={panel.kind} liveContext={liveContext} />
        )}
      </div>
    </article>
  );
}

export function ApplicationView({ panelEntries, layout, executionState, onUpdateVariableValue }: ApplicationViewProps) {
  const visibleEntries = panelEntries.filter((entry) => entry.panel.visible);
  const visibleEntryByPanelId = new Map(visibleEntries.map((entry) => [entry.panel.id, entry]));
  const renderedPanelIds = new Set<string>();

  const renderLayoutNode = (node: StudioLayoutNode, nodePath: readonly number[] = []): ReactNode => {
    if (node.kind === 'pane') {
      const entry = visibleEntryByPanelId.get(node.panelId);
      if (!entry) {
        return null;
      }
      if (renderedPanelIds.has(entry.panel.id)) {
        return null;
      }
      renderedPanelIds.add(entry.panel.id);
      return <ApplicationPanelShell entry={entry} executionState={executionState} onUpdateVariableValue={onUpdateVariableValue} />;
    }

    const children: Array<{ key: string; node: ReactNode }> = node.children
      .map((child, index) => ({
        key: `${node.direction}:${index}`,
        node: renderLayoutNode(child, [...nodePath, index]),
      }))
      .filter((item) => item.node !== null);

    if (children.length === 0) {
      return null;
    }

    if (children.length === 1) {
      return children[0].node;
    }

    const splitClass =
      node.direction === 'row'
        ? 'flex flex-row min-h-0 min-w-0 h-full w-full'
        : 'flex flex-col min-h-0 min-w-0 h-full w-full';
    const splitSizes =
      node.sizes &&
      node.sizes.length === children.length &&
      node.sizes.every((size) => typeof size === 'number' && Number.isFinite(size) && size > 0)
        ? node.sizes
        : Array.from({ length: children.length }, () => 1);
    const totalSplitSize = splitSizes.reduce((sum, size) => sum + size, 0) || children.length;
    const percentSizes = splitSizes.map((size) => (size / totalSplitSize) * 100);
    const splitKey = nodePath.length === 0 ? 'root' : nodePath.join('-');
    const childIds = children.map((_, index) => `app-split-${splitKey}-child-${index}`);
    const defaultLayout = Object.fromEntries(childIds.map((childId, index) => [childId, percentSizes[index]]));
    const groupChildren: ReactNode[] = [];
    children.forEach((child, index) => {
      groupChildren.push(
        <Panel key={`panel-${child.key}`} id={childIds[index]} defaultSize={percentSizes[index]} minSize="5%" className="min-h-0 min-w-0">
          {child.node}
        </Panel>,
      );
      if (index < children.length - 1) {
        groupChildren.push(
          <Separator
            key={`separator-${child.key}`}
            className={
              node.direction === 'row'
                ? 'mx-1 w-3 shrink-0 self-stretch rounded-sm bg-slate-800/50'
                : 'my-1 h-3 shrink-0 self-stretch rounded-sm bg-slate-800/50'
            }
          />,
        );
      }
    });

    return (
      <Group orientation={node.direction === 'row' ? 'horizontal' : 'vertical'} className={splitClass} defaultLayout={defaultLayout}>
        {groupChildren}
      </Group>
    );
  };

  const renderedLayout = renderLayoutNode(layout.root);
  const minimumLayoutHeightPx = Math.max(
    MIN_APPLICATION_LAYOUT_HEIGHT_PX,
    countVisibleLayoutRows(layout.root, visibleEntryByPanelId) * MIN_APPLICATION_PANEL_HEIGHT_PX,
  );

  if (!renderedLayout) {
    return (
      <div className="h-full w-full p-6 text-sm text-slate-400">
        No visible panels.
      </div>
    );
  }

  return (
    <div className="h-full w-full p-3 overflow-auto">
      <div className="min-h-full" style={{ height: `${minimumLayoutHeightPx}px` }}>
        {renderedLayout}
      </div>
    </div>
  );
}
