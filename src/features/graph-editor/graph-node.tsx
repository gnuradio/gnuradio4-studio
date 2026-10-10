import { Handle, Position, useUpdateNodeInternals, type Node, type NodeProps } from '@xyflow/react';
import type { CSSProperties } from 'react';
import { useEffect } from 'react';
import type { RenderedPort } from '../ports/model/types';
import { getPortTypeColor } from '../ports/model/typeColors';
import type { FlowNodeData } from './model/types';
import { HttpTimeSeriesPopout } from './runtime/http-time-series-popout';
import {
  isQuarterTurnNodeRotation,
  resolveNodePortVisualSide,
  type LogicalNodePortSide,
  type VisualNodePortSide,
} from './model/node-rotation';

type GraphFlowNode = Node<FlowNodeData>;

const PORT_BADGE_HEIGHT_PX = 18;
const PORT_BADGE_GAP_PX = Math.floor(PORT_BADGE_HEIGHT_PX * 0.5);
const PORT_BADGE_STEP_PX = PORT_BADGE_HEIGHT_PX + PORT_BADGE_GAP_PX;
const PORT_DOT_SIZE_PX = 7;
const PORT_TAB_LENGTH_PX = 24;
const PORT_BADGE_MAX_WIDTH_PX = 140;
const NODE_MIN_BODY_HEIGHT_PX = 120;
const NODE_VERTICAL_PADDING_PX = 20;
const NODE_MIN_BODY_WIDTH_PX = 224;
const VIRTUAL_NODE_MIN_WIDTH_PX = 96;
const VIRTUAL_NODE_MAX_WIDTH_PX = 210;
const VIRTUAL_NODE_HEIGHT_PX = 48;
const NOTE_NODE_WIDTH_PX = 240;
const NOTE_NODE_MIN_HEIGHT_PX = 96;

function stackedPortPosition(index: number, total: number): string {
  if (total <= 1) {
    return '50%';
  }

  const offsetPx = (index - (total - 1) / 2) * PORT_BADGE_STEP_PX;
  return `calc(50% + ${offsetPx}px)`;
}

function requiredNodeHeightForPorts(portCount: number): number {
  if (portCount <= 0) {
    return NODE_MIN_BODY_HEIGHT_PX;
  }

  const stackedPortsHeight = PORT_BADGE_HEIGHT_PX + (portCount - 1) * PORT_BADGE_STEP_PX;
  return Math.max(
    NODE_MIN_BODY_HEIGHT_PX,
    stackedPortsHeight + NODE_VERTICAL_PADDING_PX * 2,
  );
}

function requiredNodeWidthForPorts(portCount: number): number {
  if (portCount <= 1) {
    return NODE_MIN_BODY_WIDTH_PX;
  }

  const stackedPortsWidth = PORT_BADGE_HEIGHT_PX + (portCount - 1) * PORT_BADGE_STEP_PX;
  return Math.max(
    NODE_MIN_BODY_WIDTH_PX,
    stackedPortsWidth + NODE_VERTICAL_PADDING_PX * 2,
  );
}

type PortBadgeProps = {
  port: RenderedPort;
  index: number;
  total: number;
  side: LogicalNodePortSide;
  rotation: 0 | 90 | 180 | 270;
  expanded: boolean;
};

function getHandlePositionForVisualSide(side: VisualNodePortSide): Position {
  if (side === 'top') {
    return Position.Top;
  }

  if (side === 'bottom') {
    return Position.Bottom;
  }

  if (side === 'right') {
    return Position.Right;
  }

  return Position.Left;
}

function getPortBadgePlacementStyle(
  side: VisualNodePortSide,
  index: number,
  total: number,
): CSSProperties {
  const offset = stackedPortPosition(index, total);

  if (side === 'top') {
    return {
      top: 0,
      left: offset,
      transform: 'translate(-50%, -100%)',
    };
  }

  if (side === 'bottom') {
    return {
      bottom: 0,
      left: offset,
      transform: 'translate(-50%, 100%)',
    };
  }

  if (side === 'right') {
    return {
      right: 8,
      top: offset,
      transform: 'translate(100%, -50%)',
    };
  }

  return {
    left: 8,
    top: offset,
    transform: 'translate(-100%, -50%)',
  };
}

function isVerticalPortSide(side: VisualNodePortSide): boolean {
  return side === 'top' || side === 'bottom';
}

function getVirtualNodeWidth(streamId: string): number {
  const estimatedWidth = streamId.length * 7 + 52;
  return Math.min(VIRTUAL_NODE_MAX_WIDTH_PX, Math.max(VIRTUAL_NODE_MIN_WIDTH_PX, estimatedWidth));
}

function getPortDotPlacementStyle(side: VisualNodePortSide): CSSProperties {
  // The dot sits at the outer end of the tab, i.e. at the connection end.
  if (side === 'top') {
    return { top: 4.5, left: '50%', transform: 'translateX(-50%)' };
  }

  if (side === 'bottom') {
    return { bottom: 4.5, left: '50%', transform: 'translateX(-50%)' };
  }

  if (side === 'right') {
    return { right: 4.5, top: '50%', transform: 'translateY(-50%)' };
  }

  return { left: 4.5, top: '50%', transform: 'translateY(-50%)' };
}

// The pill is anchored at the card-side end of the (fixed-size) handle and grows
// outward on hover, so the handle bounds, and with them the edge anchor, never move.
function getPortPillAnchorStyle(side: VisualNodePortSide): CSSProperties {
  if (side === 'top') {
    return { bottom: 0, left: 0 };
  }

  if (side === 'bottom') {
    return { top: 0, left: 0 };
  }

  if (side === 'right') {
    return { left: 0, top: 0 };
  }

  return { right: 0, top: 0 };
}

function PortTabContent({ port, visualSide, expanded }: { port: RenderedPort; visualSide: VisualNodePortSide; expanded: boolean }) {
  const typeColor = getPortTypeColor(port.typeName);
  const isVertical = isVerticalPortSide(visualSide);
  // The dot comes first in the DOM and sits at the card-side end of the pill.
  const outwardIsStart = visualSide === 'left' || visualSide === 'top';
  const flexDirection = isVertical
    ? outwardIsStart ? 'column-reverse' : 'column'
    : outwardIsStart ? 'row-reverse' : 'row';

  const dot = (
    <span
      className="relative shrink-0"
      style={isVertical ? { height: PORT_TAB_LENGTH_PX } : { width: PORT_TAB_LENGTH_PX }}
    >
      <span
        className="absolute rounded-full transition-transform group-hover/port:scale-125 group-[.valid]/port:scale-125"
        style={{
          width: PORT_DOT_SIZE_PX,
          height: PORT_DOT_SIZE_PX,
          background: typeColor.background,
          boxShadow: `0 0 0 1px ${typeColor.border}`,
          ...getPortDotPlacementStyle(visualSide),
        }}
        aria-hidden="true"
      />
    </span>
  );

  const label = (
    <span
      className={`flex items-center overflow-hidden whitespace-nowrap text-[10px] font-medium leading-4 text-slate-200 transition-all duration-150 ${
        isVertical
          ? expanded ? 'max-h-[140px]' : 'max-h-0 group-hover/port:max-h-[140px]'
          : expanded ? 'max-w-[140px]' : 'max-w-0 group-hover/port:max-w-[140px]'
      }`}
      style={isVertical ? { writingMode: 'vertical-rl' } : undefined}
    >
      <span className={isVertical ? 'py-1.5' : 'px-1.5'}>
        {port.displayLabel}
      </span>
    </span>
  );

  return (
    <span
      className="absolute flex items-stretch rounded-full border border-slate-600 bg-slate-900 shadow-sm"
      style={{
        flexDirection,
        width: isVertical ? PORT_BADGE_HEIGHT_PX : undefined,
        height: isVertical ? undefined : PORT_BADGE_HEIGHT_PX,
        ...getPortPillAnchorStyle(visualSide),
      }}
    >
      {dot}
      {label}
    </span>
  );
}

function getPortTabStyle(side: VisualNodePortSide, index: number, total: number): CSSProperties {
  const isVertical = isVerticalPortSide(side);

  return {
    ...getPortBadgePlacementStyle(side, index, total),
    width: isVertical ? PORT_BADGE_HEIGHT_PX : PORT_TAB_LENGTH_PX,
    height: isVertical ? PORT_TAB_LENGTH_PX : PORT_BADGE_HEIGHT_PX,
    minWidth: 0,
    minHeight: 0,
    border: 'none',
    background: 'transparent',
    borderRadius: 0,
    pointerEvents: 'all',
  };
}

const PORT_TAB_CLASS = 'group/port absolute z-0';

function ConnectablePortBadge({ port, index, total, side, rotation, expanded }: PortBadgeProps) {
  const visualSide = resolveNodePortVisualSide(side, rotation);

  return (
    <Handle
      id={port.handleId ?? port.portId}
      key={`${side}:${port.key}`}
      type={side === 'input' ? 'target' : 'source'}
      position={getHandlePositionForVisualSide(visualSide)}
      className={PORT_TAB_CLASS}
      style={getPortTabStyle(visualSide, index, total)}
    >
      <PortTabContent port={port} visualSide={visualSide} expanded={expanded} />
    </Handle>
  );
}

function CollapsedPortBadge({ port, index, total, side, rotation, expanded }: PortBadgeProps) {
  const visualSide = resolveNodePortVisualSide(side, rotation);

  return (
    <div className={PORT_TAB_CLASS} style={getPortTabStyle(visualSide, index, total)}>
      <PortTabContent port={port} visualSide={visualSide} expanded={expanded} />
    </div>
  );
}

export function GraphNode({ data, selected }: NodeProps<GraphFlowNode>) {
  const inputPorts = data.renderedInputPorts;
  const outputPorts = data.renderedOutputPorts;
  const updateNodeInternals = useUpdateNodeInternals();
  const executionMode = data.executionMode ?? 'active';
  const rotation = data.rotation;
  const isVirtualRouting = data.isVirtualRouting;
  const isNote = data.isNote;
  const isQuarterTurn = isQuarterTurnNodeRotation(rotation);
  const maxPortCount = Math.max(inputPorts.length, outputPorts.length);
  const streamId = data.parameterValues.stream_id?.trim() || 'route';
  const noteText = data.parameterValues.text?.trim() || 'Note';
  const virtualNodeWidthPx = getVirtualNodeWidth(streamId);
  const nodeWidthPx = isNote
    ? NOTE_NODE_WIDTH_PX
    : isVirtualRouting
    ? virtualNodeWidthPx
    : isQuarterTurn
    ? requiredNodeWidthForPorts(maxPortCount)
    : NODE_MIN_BODY_WIDTH_PX;
  const requiredHeightPx = isNote
    ? NOTE_NODE_MIN_HEIGHT_PX
    : isVirtualRouting
    ? VIRTUAL_NODE_HEIGHT_PX
    : isQuarterTurn
    ? NODE_MIN_BODY_HEIGHT_PX
    : requiredNodeHeightForPorts(maxPortCount);
  const nodeStyle: CSSProperties = {
    width: `${nodeWidthPx}px`,
    minWidth: `${nodeWidthPx}px`,
    maxWidth: `${nodeWidthPx}px`,
    minHeight: `${requiredHeightPx}px`,
  };
  const handleSignature = [
    `rotation:${rotation}`,
    ...inputPorts.map((port) => `${port.key}:${port.handleId ?? port.portId ?? ''}`),
    ...outputPorts.map((port) => `${port.key}:${port.handleId ?? port.portId ?? ''}`),
  ].join('|');

  useEffect(() => {
    updateNodeInternals(data.instanceId);
  }, [data.instanceId, handleSignature, updateNodeInternals]);

  return (
    <div
      className="relative isolate group"
      style={nodeStyle}
    >
      {inputPorts.map((port, index) =>
        port.connectable && port.portId ? (
          <ConnectablePortBadge
            key={`in:${port.key}`}
            port={port}
            index={index}
            total={inputPorts.length}
            side="input"
            rotation={rotation}
            expanded={selected}
          />
        ) : (
          <CollapsedPortBadge
            key={`collapsed-in:${port.key}`}
            port={port}
            index={index}
            total={inputPorts.length}
            side="input"
            rotation={rotation}
            expanded={selected}
          />
        ),
      )}

      {outputPorts.map((port, index) =>
        port.connectable && port.portId ? (
          <ConnectablePortBadge
            key={`out:${port.key}`}
            port={port}
            index={index}
            total={outputPorts.length}
            side="output"
            rotation={rotation}
            expanded={selected}
          />
        ) : (
          <CollapsedPortBadge
            key={`collapsed-out:${port.key}`}
            port={port}
            index={index}
            total={outputPorts.length}
            side="output"
            rotation={rotation}
            expanded={selected}
          />
        ),
      )}

      <div
        className={`relative z-10 h-full border shadow-sm transition ${
          isVirtualRouting ? 'rounded-2xl px-2.5 py-1.5' : isNote ? 'rounded-lg px-3 py-2.5' : 'rounded-md px-3 py-2'
        } ${
          executionMode === 'disabled'
            ? selected
              ? 'border-slate-500 bg-slate-900 ring-1 ring-slate-400/55'
              : 'border-slate-700 bg-slate-900'
            : executionMode === 'bypassed'
              ? selected
                ? 'border-amber-300 bg-slate-800 ring-1 ring-amber-200/70 shadow-[0_0_0_1px_rgba(245,158,11,0.55),0_0_18px_rgba(245,158,11,0.35)]'
                : 'border-amber-700 bg-slate-900 shadow-[0_0_0_1px_rgba(180,83,9,0.35)]'
              : isVirtualRouting
                ? selected
                  ? 'border-sky-300 bg-slate-800 ring-1 ring-sky-200/70 shadow-[0_0_0_1px_rgba(14,165,233,0.55),0_0_18px_rgba(14,165,233,0.35)]'
                  : 'border-sky-700 bg-slate-900 shadow-[0_0_0_1px_rgba(14,165,233,0.30)]'
              : isNote
                ? selected
                  ? 'border-yellow-200 bg-yellow-950/35 ring-1 ring-yellow-200/65 shadow-[0_0_0_1px_rgba(250,204,21,0.45),0_0_18px_rgba(250,204,21,0.20)]'
                  : 'border-yellow-600/80 bg-yellow-950/25 shadow-[0_0_0_1px_rgba(250,204,21,0.20)]'
              : data.missingFromCatalog
                ? selected
                  ? 'border-rose-300 bg-slate-800 ring-1 ring-rose-300/70 shadow-[0_0_0_1px_rgba(244,63,94,0.65),0_0_18px_rgba(244,63,94,0.45)]'
                  : 'border-rose-600 bg-slate-900 shadow-[0_0_0_1px_rgba(225,29,72,0.35)]'
                : selected
                  ? 'border-emerald-300 bg-slate-800 ring-1 ring-emerald-200/70 shadow-[0_0_0_1px_rgba(16,185,129,0.55),0_0_18px_rgba(16,185,129,0.45)]'
                  : 'border-slate-700 bg-slate-900'
        }`}
        style={{ minHeight: `${requiredHeightPx}px` }}
        title={`${data.displayName}\n${data.blockTypeId}${executionMode === 'active' ? '' : `\nMode: ${executionMode}`}`}
      >
        {executionMode === 'disabled' && (
          <div
            className="pointer-events-none absolute inset-0 rounded-md opacity-35"
            style={{
              backgroundImage:
                'repeating-linear-gradient(135deg, rgba(148, 163, 184, 0.38) 0, rgba(148, 163, 184, 0.38) 3px, transparent 3px, transparent 10px)',
            }}
            aria-hidden="true"
          />
        )}
        {isNote ? (
          <div className="relative z-10 h-full min-h-[76px] overflow-hidden text-[12px] leading-5 text-yellow-50/95">
            <div className="whitespace-pre-wrap break-words">
              {noteText}
            </div>
          </div>
        ) : isVirtualRouting ? (
          <div className="relative z-10 flex h-full min-h-[36px] flex-col items-center justify-center gap-0.5">
            <div className="max-w-full overflow-hidden text-ellipsis whitespace-nowrap text-[8px] font-bold uppercase tracking-wide text-sky-300/90">
              Virtual
            </div>
            <div
              className="max-w-full rounded-full border border-sky-500/70 bg-sky-950/80 px-3 py-1 text-center text-[11px] font-semibold text-sky-100 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]"
              title={streamId}
            >
              <span className="block max-w-full overflow-hidden text-ellipsis whitespace-nowrap">
                {streamId}
              </span>
            </div>
          </div>
        ) : (
        <div className="relative z-10">
          {data.supportsRuntimeVisualization && (
            <button
              type="button"
              onClick={() => data.onOpenRuntimeVisualization?.(data.instanceId)}
              className={`absolute right-2 top-2 rounded border border-slate-600 bg-slate-950/90 px-1.5 py-0.5 text-[10px] text-slate-200 hover:bg-slate-800 transition-opacity ${
                selected || data.isRuntimeVisualizationOpen ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
              }`}
              title="View runtime plot"
            >
              Plot
            </button>
          )}

          <div className="text-sm font-medium text-slate-100">{data.shortDisplayName}</div>
          {isVirtualRouting && (
            <div className="mt-1 inline-flex rounded border border-sky-700 bg-sky-950/45 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-sky-200">
              Virtual
            </div>
          )}
          {executionMode !== 'active' && (
            <div
              className={`mt-1 inline-flex rounded border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                executionMode === 'disabled'
                  ? 'border-slate-600 bg-slate-800 text-slate-300'
                  : 'border-amber-600 bg-amber-950/45 text-amber-200'
              }`}
            >
              {executionMode === 'disabled' ? 'Disabled' : 'Bypassed'}
            </div>
          )}
          {data.parameterLines.length > 0 ? (
            <div className="mt-2 grid grid-cols-2 gap-1 min-w-0">
              {data.parameterLines.map((line) => (
                <div
                  key={line}
                  className="min-w-0 rounded border border-slate-700 bg-slate-800/60 px-1.5 py-0.5 text-[10px] text-slate-200 overflow-hidden text-ellipsis whitespace-nowrap"
                  title={line}
                >
                  {line}
                </div>
              ))}
              {data.parameterOverflowCount > 0 && (
                <div
                  className="min-w-0 rounded border border-slate-700 bg-slate-900 px-1.5 py-0.5 text-[10px] text-slate-400 overflow-hidden text-ellipsis whitespace-nowrap"
                  title={`${data.parameterOverflowCount} additional parameter value(s)`}
                >
                  +{data.parameterOverflowCount} more
                </div>
              )}
            </div>
          ) : (
            <div className="mt-2 text-[10px] text-slate-500">No non-advanced parameters</div>
          )}
        </div>
        )}

      </div>

      {data.supportsRuntimeVisualization && data.isRuntimeVisualizationOpen && (
        <HttpTimeSeriesPopout
          instanceId={data.instanceId}
          blockTypeId={data.blockTypeId}
          displayName={data.displayName}
          parameterValues={data.parameterValues}
          onClose={() => data.onCloseRuntimeVisualization?.()}
        />
      )}
    </div>
  );
}
