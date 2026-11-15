import { useEffect, useLayoutEffect, useRef, type ComponentProps, type KeyboardEvent } from 'react';
import { Group, useGroupRef } from 'react-resizable-panels';

type Props = Omit<ComponentProps<typeof Group>, 'groupRef' | 'elementRef' | 'onLayoutChange' | 'onLayoutChanged'> & {
  onUserResize?: (layout: Record<string, number>) => void;
};

function ownsSeparator(target: EventTarget | null, group: HTMLDivElement) {
  return target instanceof Element && Boolean(target.closest('[role="separator"]')) && target.closest('[data-group]') === group;
}

export function LayoutSplitGroup({ onUserResize, ...props }: Props) {
  const groupRef = useGroupRef();
  const elementRef = useRef<HTMLDivElement>(null);
  const onUserResizeRef = useRef(onUserResize);
  onUserResizeRef.current = onUserResize;
  const desiredLayoutRef = useRef(props.defaultLayout);
  desiredLayoutRef.current = props.defaultLayout;
  const groupIdentity = JSON.stringify([props.orientation, props.defaultLayout]);
  const editable = Boolean(onUserResize);
  const fineTargetSize = props.resizeTargetMinimumSize?.fine ?? 10;
  const coarseTargetSize = props.resizeTargetMinimumSize?.coarse ?? 20;

  useLayoutEffect(() => {
    const group = groupRef.current;
    const desired = desiredLayoutRef.current;
    if (!group || !desired) return;
    const current = group.getLayout();
    if (Object.keys(current).length === Object.keys(desired).length &&
        Object.keys(desired).some((id) => Math.abs((current[id] ?? 0) - desired[id]) > 0.000001)) {
      group.setLayout(desired);
    }
  }, [groupIdentity, groupRef]);

  useEffect(() => {
    const group = elementRef.current;
    const win = group?.ownerDocument.defaultView;
    if (!editable || !group || !win) return;
    let pendingPointer: AbortController | undefined;
    const onPointerDown = (event: PointerEvent) => {
      const hitSeparator = Array.from(group.querySelectorAll('[role="separator"]')).some((separator) => {
        const rect = separator.getBoundingClientRect();
        const minimumSize = event.pointerType === 'touch' ? coarseTargetSize : fineTargetSize;
        const padX = Math.max(0, minimumSize - rect.width) / 2;
        const padY = Math.max(0, minimumSize - rect.height) / 2;
        return ownsSeparator(separator, group) && event.clientX >= rect.left - padX && event.clientX <= rect.right + padX &&
          event.clientY >= rect.top - padY && event.clientY <= rect.bottom + padY;
      });
      if (event.button !== 0 || (!ownsSeparator(event.target, group) && !hitSeparator)) return;
      pendingPointer?.abort();
      const controller = new AbortController();
      pendingPointer = controller;
      win.addEventListener('pointerup', () => {
        controller.abort();
        pendingPointer = undefined;
        const layout = groupRef.current?.getLayout();
        if (layout) onUserResizeRef.current?.(layout);
      }, { signal: controller.signal, once: true, capture: true });
      win.addEventListener('pointercancel', () => {
        controller.abort();
        pendingPointer = undefined;
      }, { signal: controller.signal, once: true, capture: true });
    };
    // The panel library may capture the pointer on the body before this listener runs.
    win.addEventListener('pointerdown', onPointerDown, true);
    return () => {
      win.removeEventListener('pointerdown', onPointerDown, true);
      pendingPointer?.abort();
    };
  }, [editable, groupIdentity, groupRef, fineTargetSize, coarseTargetSize]);

  const onKeyUpCapture = (event: KeyboardEvent<HTMLDivElement>) => {
    if (editable && ownsSeparator(event.target, event.currentTarget) &&
        ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'Enter'].includes(event.key)) {
      const layout = groupRef.current?.getLayout();
      if (layout) onUserResizeRef.current?.(layout);
    }
  };

  return <Group
    key={JSON.stringify([props.orientation, Object.keys(props.defaultLayout ?? {})])}
    {...props}
    groupRef={groupRef}
    elementRef={elementRef}
    onKeyUpCapture={onKeyUpCapture}
  />;
}
