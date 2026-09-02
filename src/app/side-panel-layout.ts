const LEFT_PANEL_WIDTH = '18rem';
const RIGHT_PANEL_WIDTH = '20rem';
const COLLAPSED_PANEL_WIDTH = '2.25rem';

export function getStudioShellGridTemplate(leftCollapsed: boolean, rightCollapsed: boolean): string {
  const leftWidth = leftCollapsed ? COLLAPSED_PANEL_WIDTH : LEFT_PANEL_WIDTH;
  const rightWidth = rightCollapsed ? COLLAPSED_PANEL_WIDTH : RIGHT_PANEL_WIDTH;
  return `${leftWidth} minmax(0, 1fr) ${rightWidth}`;
}
