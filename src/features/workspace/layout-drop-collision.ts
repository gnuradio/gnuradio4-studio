import { pointerWithin, rectIntersection, type CollisionDetection } from '@dnd-kit/core';

export const edgeDropCollisionDetection: CollisionDetection = (args) => {
  const edgeTargets = args.droppableContainers.filter((container) =>
    String(container.id).startsWith('split-drop:'),
  );
  const pointerHits = pointerWithin({
    ...args,
    droppableContainers: edgeTargets,
  });
  if (pointerHits.length > 0) {
    return pointerHits;
  }
  return rectIntersection(args);
};

