import { useLayoutEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import type { StudioCommandId, StudioCommands } from '../../lib/commands/studio-commands';

const blockItems: Array<{ command: StudioCommandId; label: string; shortcut?: string } | null> = [
  { command: 'cut', label: 'Cut', shortcut: '⌘/Ctrl+X' },
  { command: 'copy', label: 'Copy', shortcut: '⌘/Ctrl+C' },
  { command: 'paste', label: 'Paste', shortcut: '⌘/Ctrl+V' },
  { command: 'delete', label: 'Delete', shortcut: 'Delete' },
  null,
  { command: 'rotateLeft', label: 'Rotate Counterclockwise', shortcut: 'Left' },
  { command: 'rotateRight', label: 'Rotate Clockwise', shortcut: 'Right' },
  null,
  { command: 'enable', label: 'Enable', shortcut: 'E' },
  { command: 'disable', label: 'Disable', shortcut: 'D' },
  { command: 'bypass', label: 'Bypass', shortcut: 'B' },
  null,
  { command: 'properties', label: 'Properties…', shortcut: 'Enter' },
];
const canvasItems = [
  { command: 'paste' as const, label: 'Paste here' },
  { command: 'selectAll' as const, label: 'Select All' },
  { command: 'fitView' as const, label: 'Fit Graph' },
];

export function GraphContextMenu({ x, y, block, commands, bypassReason, onSelect, onClose }: {
  x: number;
  y: number;
  block: boolean;
  commands: StudioCommands;
  bypassReason?: string;
  onSelect: (command: StudioCommandId) => void;
  onClose: () => void;
}) {
  const menuRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const menu = menuRef.current!;
    const previousFocus = document.activeElement;
    const bounds = menu.getBoundingClientRect();
    menu.style.left = `${Math.max(8, Math.min(x, window.innerWidth - bounds.width - 8))}px`;
    menu.style.top = `${Math.max(8, Math.min(y, window.innerHeight - bounds.height - 8))}px`;
    (menu.querySelector<HTMLButtonElement>('button:not(:disabled)') ?? menu).focus({ preventScroll: true });
    const dismiss = (event: Event) => {
      if (!menu.contains(event.target as globalThis.Node)) onClose();
    };
    document.addEventListener('pointerdown', dismiss, true);
    window.addEventListener('resize', onClose);
    window.addEventListener('scroll', dismiss, true);
    return () => {
      document.removeEventListener('pointerdown', dismiss, true);
      window.removeEventListener('resize', onClose);
      window.removeEventListener('scroll', dismiss, true);
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus({ preventScroll: true });
    };
  }, [x, y, onClose]);

  return createPortal(
    <div ref={menuRef} role="menu" aria-label={block ? 'Block actions' : 'Canvas actions'} tabIndex={-1}
      className="fixed z-50 max-h-[calc(100vh-16px)] min-w-64 overflow-y-auto rounded-md border border-slate-600 bg-slate-900 p-1 text-sm text-slate-100 shadow-xl"
      style={{ left: x, top: y }}
      onContextMenu={(event) => event.preventDefault()}
      onKeyDown={(event) => {
        if (['Escape', 'Tab'].includes(event.key)) {
          event.preventDefault();
          event.stopPropagation();
          onClose();
        } else if (['ArrowDown', 'ArrowUp', 'Home', 'End', 'ArrowLeft', 'ArrowRight'].includes(event.key)) {
          event.preventDefault();
          event.stopPropagation();
          const buttons = [...menuRef.current!.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
          const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
          const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1
            : (current + (event.key === 'ArrowUp' ? -1 : 1) + buttons.length) % buttons.length;
          if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') buttons[next]?.focus();
        } else if (event.key === 'Enter' || event.key === ' ') {
          // Let the focused button activate without also invoking canvas shortcuts.
          event.stopPropagation();
        }
      }}>
      {(block ? blockItems : canvasItems).map((item, index) => item ? (
        <button key={item.command} type="button" role="menuitem" disabled={!commands[item.command]?.enabled}
          title={item.command === 'bypass' ? bypassReason : undefined}
          className="flex w-full items-center justify-between gap-5 rounded px-3 py-1.5 text-left hover:bg-slate-700 focus:bg-slate-700 focus:outline-none disabled:cursor-default disabled:text-slate-500 disabled:hover:bg-transparent"
          onClick={() => onSelect(item.command)}>
          <span>{item.label}</span>
          {'shortcut' in item && <span className="text-xs text-slate-400">{item.shortcut}</span>}
        </button>
      ) : <div key={index} role="separator" className="my-1 border-t border-slate-700" />)}
    </div>, document.body,
  );
}
