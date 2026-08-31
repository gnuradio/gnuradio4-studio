export const BACKEND_CONSOLE_MAX_CHARACTERS = 128 * 1024;
export const BACKEND_CONSOLE_MAX_LINES = 2_000;

export function createBackendConsoleBuffer({
  maxCharacters = BACKEND_CONSOLE_MAX_CHARACTERS,
  maxLines = BACKEND_CONSOLE_MAX_LINES,
} = {}) {
  let content = '';
  let cursor = 0;
  let truncated = false;
  let updatedAt = null;

  const snapshot = () => ({
    content,
    cursor,
    truncated,
    updatedAt,
  });

  return {
    append(value, timestamp = new Date().toISOString()) {
      const text = String(value);
      if (!text) {
        return { ...snapshot(), didTruncate: false };
      }

      cursor += 1;
      updatedAt = timestamp;
      content += text;
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

      truncated ||= didTruncate;
      return { ...snapshot(), didTruncate };
    },
    snapshot,
  };
}
