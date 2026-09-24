import type { ApplicationMode } from '../../graph-document/model/studio-workspace';

// A pop-out or new tab is a separate window, and every window boots its own control plane. With the
// in-process WASM control plane that is a second, empty one: it never sees the session, so the window
// waits for data forever. Graphs saved with those modes run in-app there instead. The saved mode is
// left alone, so the same graph still opens its own window with a native control plane.
export function effectiveApplicationMode(
  mode: ApplicationMode,
  { inProcessControlPlane }: { inProcessControlPlane: boolean },
): ApplicationMode {
  return inProcessControlPlane && (mode === 'new_tab' || mode === 'popout') ? 'in_app' : mode;
}
