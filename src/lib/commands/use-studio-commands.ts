import { useEffect, useId, useLayoutEffect } from 'react';
import { hasDesktopMenus, isTextEditingTarget, studioCommands, type StudioCommands } from './studio-commands';

export function useStudioCommands(commands: StudioCommands) {
  const owner = useId();
  // Update closures and enabled state after each committed render, before user input.
  useLayoutEffect(() => studioCommands.register(owner, commands));
}

export function useDesktopCommands(onError: (error: unknown) => void) {
  useLayoutEffect(() => { studioCommands.onError(onError); });
  useEffect(() => {
    if (!hasDesktopMenus()) return;
    const shell = window.gr4StudioShell!;
    let previous = '';
    const publish = () => {
      const state = { commands: studioCommands.state(), editingText: isTextEditingTarget(document.activeElement) };
      const serialized = JSON.stringify(state);
      if (serialized !== previous) {
        previous = serialized;
        shell.setMenuState?.(state);
      }
    };
    const disposeState = studioCommands.subscribe(publish);
    const disposeCommands = shell.onMenuCommand?.((id) => { void studioCommands.execute(id); });
    document.addEventListener('focusin', publish);
    document.addEventListener('focusout', publish);
    publish();
    return () => {
      disposeState();
      disposeCommands?.();
      document.removeEventListener('focusin', publish);
      document.removeEventListener('focusout', publish);
      shell.setMenuState?.({ commands: {}, editingText: false });
    };
  }, []);
}
