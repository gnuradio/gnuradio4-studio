import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useDraggable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import { useState, type ReactNode } from 'react';
import type { StudioLayoutNode, StudioLayoutSpec } from '../graph-document/model/studio-workspace';
import {
  applySplitDropToLayout,
  buildColumnLayoutRoot,
  normalizeStudioLayoutSpec,
  type SplitDropPosition,
} from '../graph-document/model/studio-layout';
import { LayoutDropTarget } from '../workspace/layout-drag-drop';
import { edgeDropCollisionDetection } from '../workspace/layout-drop-collision';

type RenderWidget = (id: string, isTiled: boolean, dragHandleProps?: Record<string, unknown>) => ReactNode;

function WidgetPane({
  id,
  isTiled,
  editable,
  activeDragId,
  renderWidget,
}: {
  id: string;
  isTiled: boolean;
  editable: boolean;
  activeDragId: string | null;
  renderWidget: RenderWidget;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id,
    data: { widgetId: id },
    disabled: !editable,
  });
  return (
    <div ref={setNodeRef} className={`relative min-w-0 ${isDragging ? 'opacity-50' : ''}`}>
      {renderWidget(id, isTiled, editable ? { ...attributes, ...listeners } : undefined)}
      {editable ? (['left', 'right', 'top', 'bottom'] as const).map((position) => (
        <LayoutDropTarget key={position} position={position} targetPanelId={id} activeDragPanelId={activeDragId} />
      )) : null}
    </div>
  );
}

export function ControlWidgetLayout({
  widgetIds,
  layout,
  onLayoutChange,
  renderWidget,
}: {
  widgetIds: readonly string[];
  layout?: StudioLayoutSpec;
  onLayoutChange?: (layout: StudioLayoutSpec) => void;
  renderWidget: RenderWidget;
}) {
  const [activeDragId, setActiveDragId] = useState<string | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 3 } }));
  const effectiveLayout = normalizeStudioLayoutSpec(
    layout ?? { version: 2, root: buildColumnLayoutRoot(widgetIds) },
    widgetIds,
  );
  const renderNode = (node: StudioLayoutNode, isTiled = false): ReactNode => {
    if (node.kind === 'pane') {
      if (!widgetIds.includes(node.panelId)) return null;
      return (
        <WidgetPane
          id={node.panelId}
          isTiled={isTiled}
          editable={Boolean(onLayoutChange)}
          activeDragId={activeDragId}
          renderWidget={renderWidget}
        />
      );
    }
    return (
      <div className={`flex min-w-0 gap-1.5 ${node.direction === 'row' ? 'flex-row' : 'flex-col'}`}>
        {node.children.map((child, index) => (
          <div key={child.kind === 'pane' ? child.panelId : index} className="min-w-0" style={node.direction === 'row' ? { flex: `${node.sizes?.[index] ?? 1} 1 0%` } : undefined}>
            {renderNode(child, isTiled || node.direction === 'row')}
          </div>
        ))}
      </div>
    );
  };
  const handleDragEnd = (event: DragEndEvent) => {
    setActiveDragId(null);
    const draggedId = event.active.data.current?.widgetId;
    const targetId = event.over?.data.current?.targetPanelId;
    const position = event.over?.data.current?.position as SplitDropPosition | undefined;
    if (typeof draggedId !== 'string' || typeof targetId !== 'string' || !position) return;
    const nextLayout = applySplitDropToLayout(effectiveLayout, draggedId, targetId, position, widgetIds);
    if (nextLayout !== effectiveLayout) onLayoutChange?.(nextLayout);
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={edgeDropCollisionDetection}
      onDragStart={(event) => setActiveDragId(String(event.active.id))}
      onDragCancel={() => setActiveDragId(null)}
      onDragEnd={handleDragEnd}
    >
      {renderNode(effectiveLayout.root)}
      <DragOverlay>
        {activeDragId ? <div className="w-72 rounded bg-slate-950 shadow-lg">{renderWidget(activeDragId, true)}</div> : null}
      </DragOverlay>
    </DndContext>
  );
}
