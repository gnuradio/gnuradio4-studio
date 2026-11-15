import { useEffect, useId, useLayoutEffect, useRef } from 'react';
import { hasDesktopMenus, isTextEditingTarget, studioCommands, type StudioCommands } from './studio-commands';
import type { RecentDocumentMenuEntry } from '../../features/document-file/recent-documents';

export function useStudioCommands(commands: StudioCommands) {
  const owner = useId();
  // Update closures and enabled state after each committed render, before user input.
  useLayoutEffect(() => studioCommands.register(owner, commands));
}

export function useDesktopCommands(onError: (error: unknown) => void, recentDocuments: RecentDocumentMenuEntry[]) {
  const recent = useRef(recentDocuments);
  const publishMenuState = useRef<(() => void) | null>(null);
  useLayoutEffect(() => { studioCommands.onError(onError); });
  useLayoutEffect(() => {
    recent.current = recentDocuments;
    publishMenuState.current?.();
  }, [recentDocuments]);
  useEffect(() => {
    if (!hasDesktopMenus()) return;
    const shell = window.gr4StudioShell!;
    let previous = '';
    const publish = () => {
      const state = { commands: studioCommands.state(), editingText: isTextEditingTarget(document.activeElement),
        recentDocuments: recent.current.map(({ id, name, location, requiresSelection }) => ({ id, name, location, requiresSelection })) };
      const serialized = JSON.stringify(state);
      if (serialized !== previous) {
        previous = serialized;
        shell.setMenuState?.(state);
      }
    };
    const disposeState = studioCommands.subscribe(publish);
    publishMenuState.current = publish;
    const disposeCommands = shell.onMenuCommand?.((id, argument) => { void studioCommands.execute(id, argument); });
    document.addEventListener('focusin', publish);
    document.addEventListener('focusout', publish);
    publish();
    return () => {
      disposeState();
      publishMenuState.current = null;
      disposeCommands?.();
      document.removeEventListener('focusin', publish);
      document.removeEventListener('focusout', publish);
      shell.setMenuState?.({ commands: {}, editingText: false });
    };
  }, []);
}
