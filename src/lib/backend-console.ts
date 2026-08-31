export const CONSOLE_VIEW_MAX_CHARACTERS = 128 * 1024;
export const CONSOLE_VIEW_MAX_LINES = 2_000;

export function appendBoundedConsoleText(
  current: string,
  incoming: string,
  {
    replace = false,
    maxCharacters = CONSOLE_VIEW_MAX_CHARACTERS,
    maxLines = CONSOLE_VIEW_MAX_LINES,
  }: { replace?: boolean; maxCharacters?: number; maxLines?: number } = {},
): { content: string; didTruncate: boolean } {
  let content = replace ? incoming : `${current}${incoming}`;
  let didTruncate = false;

  if (content.length > maxCharacters) {
    content = content.slice(-maxCharacters);
    didTruncate = true;
  }

  const endsWithNewline = content.endsWith('\n');
  const lines = content.split('\n');
  if (endsWithNewline) {
    lines.pop();
  }
  if (lines.length > maxLines) {
    content = `${lines.slice(-maxLines).join('\n')}${endsWithNewline ? '\n' : ''}`;
    didTruncate = true;
  }

  return { content, didTruncate };
}
