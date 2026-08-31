import fs from 'node:fs/promises';

export const BACKEND_LOG_TAIL_MAX_BYTES = 64 * 1024;
export const BACKEND_LOG_TAIL_MAX_LINES = 200;

const ANSI_ESCAPE_SEQUENCE = /\u001B(?:\[[0-?]*[ -/]*[@-~]|\][^\u0007]*(?:\u0007|\u001B\\))/g;
const UNSAFE_CONTROL_CHARACTER = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

export function sanitizeBackendLogText(value) {
  return value.replace(ANSI_ESCAPE_SEQUENCE, '').replace(UNSAFE_CONTROL_CHARACTER, '');
}

export async function readBackendLogTail(
  logPath,
  {
    maxBytes = BACKEND_LOG_TAIL_MAX_BYTES,
    maxLines = BACKEND_LOG_TAIL_MAX_LINES,
  } = {},
) {
  const handle = await fs.open(logPath, 'r');

  try {
    const stats = await handle.stat();
    const start = Math.max(0, stats.size - maxBytes);
    const bytesToRead = Math.min(stats.size, maxBytes);
    let startsAtLineBoundary = start === 0;
    if (start > 0) {
      const precedingByte = Buffer.alloc(1);
      const precedingRead = await handle.read(precedingByte, 0, 1, start - 1);
      startsAtLineBoundary = precedingRead.bytesRead === 1 && precedingByte[0] === 0x0a;
    }
    const buffer = Buffer.alloc(bytesToRead);
    const { bytesRead } = await handle.read(buffer, 0, bytesToRead, start);
    let text = sanitizeBackendLogText(buffer.subarray(0, bytesRead).toString('utf8'));
    let truncated = start > 0;

    if (start > 0 && !startsAtLineBoundary) {
      const firstNewline = text.indexOf('\n');
      if (firstNewline !== -1) {
        text = text.slice(firstNewline + 1);
      } else if (text.length > 0) {
        text = `…${text}`;
      }
    }

    let lines = text.split(/\r?\n/);
    if (lines.at(-1) === '') {
      lines = lines.slice(0, -1);
    }
    if (lines.length > maxLines) {
      lines = lines.slice(-maxLines);
      truncated = true;
    }

    return {
      content: lines.join('\n'),
      lineCount: lines.length,
      truncated,
      sizeBytes: stats.size,
      modifiedAt: stats.mtime.toISOString(),
    };
  } finally {
    await handle.close();
  }
}
