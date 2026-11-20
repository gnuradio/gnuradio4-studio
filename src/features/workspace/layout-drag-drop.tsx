import { useDroppable } from '@dnd-kit/core';
import type { SplitDropPosition } from '../graph-document/model/studio-layout';

export function LayoutDropTarget({
  position,
  targetPanelId,
  activeDragPanelId,
}: {
  position: SplitDropPosition;
  targetPanelId: string;
  activeDragPanelId: string | null;
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: `split-drop:${targetPanelId}:${position}`,
    data: {
      targetPanelId,
      position,
    },
  });
  const active = Boolean(activeDragPanelId && activeDragPanelId !== targetPanelId);
  const placement =
    position === 'left'
      ? 'left-0 top-1 bottom-1 w-8'
      : position === 'right'
        ? 'right-0 top-1 bottom-1 w-8'
        : position === 'top'
          ? 'top-0 left-1 right-1 h-8'
          : 'bottom-0 left-1 right-1 h-8';
  const directionLabel =
    position === 'left'
      ? 'left'
      : position === 'right'
        ? 'right'
        : position === 'top'
          ? 'top'
          : 'bottom';
  const activeClass = active
    ? `z-30 border text-emerald-100 opacity-100 ${
        isOver
          ? 'border-emerald-300/90 bg-emerald-500/45 shadow-sm'
          : 'border-emerald-400/65 bg-emerald-500/22'
      }`
    : 'pointer-events-none opacity-0';

  return (
    <div
      ref={setNodeRef}
      aria-label={`Drop ${position} of ${targetPanelId}`}
      className={`absolute ${placement} rounded-md transition-all duration-100 ${activeClass}`}
    >
      {active && (
        <span
          className={`absolute rounded border border-emerald-300/70 bg-slate-900/85 px-1.5 py-0.5 text-xs font-semibold uppercase tracking-wide text-emerald-100 ${
            position === 'left'
              ? 'left-1 top-1/2 -translate-y-1/2'
              : position === 'right'
                ? 'right-1 top-1/2 -translate-y-1/2'
                : position === 'top'
                  ? 'left-1/2 top-1 -translate-x-1/2'
                  : 'left-1/2 bottom-1 -translate-x-1/2'
          }`}
        >
          {directionLabel}
        </span>
      )}
    </div>
  );
}

