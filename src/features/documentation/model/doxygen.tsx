import type { ReactNode } from 'react';

export type DoxygenDefinitionItem = {
  term: string;
  description: string;
};

export type DoxygenBlock =
  | {
      kind: 'paragraph';
      text: string;
    }
  | {
      kind: 'list';
      items: string[];
    }
  | {
      kind: 'definitionList';
      items: DoxygenDefinitionItem[];
    }
  | {
      kind: 'code';
      text: string;
    };

const DOXYGEN_TAGS_TO_NEWLINES = [
  [/<br\s*\/?>/gi, '\n'],
  [/<\/p>/gi, '\n\n'],
  [/<p\b[^>]*>/gi, '\n\n'],
  [/<\/li>/gi, '\n'],
] as const;

const DOXYGEN_CODE_START_RE = /^[@\\]code\b(?:\s*\{[^}]*\})?\s*$/i;
const DOXYGEN_CODE_END_RE = /^[@\\]endcode\b\s*$/i;
const DOXYGEN_BULLET_RE = /^\s*[-*+]\s+(.*)$/;
const DOXYGEN_PARAM_RE = /^[@\\](param|tparam|retval|return|returns)\b(?:\s*\[[^\]]+\])?\s*(.*)$/i;
const DOXYGEN_INLINE_CODE_RE = /`([^`]+)`/g;

function normalizeDoxygenText(text: string): string {
  return DOXYGEN_TAGS_TO_NEWLINES.reduce(
    (accumulator, [pattern, replacement]) => accumulator.replace(pattern, replacement),
    text.replace(/\r\n?/g, '\n').trim(),
  );
}

function stripBriefMarker(line: string): string {
  return line.replace(/^[@\\]brief\s+/i, '').replace(/^[@\\]brief$/i, '');
}

export function extractDoxygenBrief(text?: string): string | undefined {
  if (!text || !text.trim()) {
    return undefined;
  }

  const normalized = normalizeDoxygenText(text);
  const lines = normalized.split('\n');
  for (const rawLine of lines) {
    const trimmed = rawLine.trim();
    if (!trimmed) {
      continue;
    }

    return stripBriefMarker(trimmed);
  }

  return undefined;
}

function flushParagraph(blocks: DoxygenBlock[], paragraphLines: string[]) {
  if (paragraphLines.length === 0) {
    return;
  }
  blocks.push({ kind: 'paragraph', text: paragraphLines.join('\n').trim() });
  paragraphLines.length = 0;
}

function flushList(blocks: DoxygenBlock[], listItems: string[]) {
  if (listItems.length === 0) {
    return;
  }
  blocks.push({ kind: 'list', items: [...listItems] });
  listItems.length = 0;
}

function flushDefinitionList(blocks: DoxygenBlock[], definitionItems: DoxygenDefinitionItem[]) {
  if (definitionItems.length === 0) {
    return;
  }
  blocks.push({ kind: 'definitionList', items: [...definitionItems] });
  definitionItems.length = 0;
}

function flushCode(blocks: DoxygenBlock[], codeLines: string[]) {
  if (codeLines.length === 0) {
    return;
  }
  blocks.push({ kind: 'code', text: codeLines.join('\n') });
  codeLines.length = 0;
}

function parseDefinitionLine(line: string): DoxygenDefinitionItem | null {
  const match = line.match(DOXYGEN_PARAM_RE);
  if (!match) {
    return null;
  }

  const tag = match[1]?.toLowerCase() ?? '';
  const remainder = match[2]?.trim() ?? '';
  if (tag === 'return' || tag === 'returns' || tag === 'retval') {
    return {
      term: 'Returns',
      description: remainder.replace(/^[-:]\s*/, ''),
    };
  }

  const [term = '', ...rest] = remainder.split(/\s+/);
  const description = rest.join(' ').replace(/^[-:]\s*/, '');
  if (!term) {
    return null;
  }

  return {
    term,
    description,
  };
}

export function parseDoxygenBlocks(text?: string): DoxygenBlock[] {
  if (!text || !text.trim()) {
    return [];
  }

  const normalized = normalizeDoxygenText(text);
  const lines = normalized.split('\n');
  const blocks: DoxygenBlock[] = [];
  const paragraphLines: string[] = [];
  const listItems: string[] = [];
  const definitionItems: DoxygenDefinitionItem[] = [];
  const codeLines: string[] = [];
  let inCodeBlock = false;

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    const trimmed = line.trim();

    if (inCodeBlock) {
      if (DOXYGEN_CODE_END_RE.test(trimmed)) {
        flushCode(blocks, codeLines);
        inCodeBlock = false;
      } else {
        codeLines.push(line);
      }
      continue;
    }

    if (!trimmed) {
      flushParagraph(blocks, paragraphLines);
      flushList(blocks, listItems);
      flushDefinitionList(blocks, definitionItems);
      continue;
    }

    if (DOXYGEN_CODE_START_RE.test(trimmed)) {
      flushParagraph(blocks, paragraphLines);
      flushList(blocks, listItems);
      flushDefinitionList(blocks, definitionItems);
      inCodeBlock = true;
      continue;
    }

    const definition = parseDefinitionLine(trimmed);
    if (definition) {
      flushParagraph(blocks, paragraphLines);
      flushList(blocks, listItems);
      definitionItems.push(definition);
      continue;
    }

    const bullet = trimmed.match(DOXYGEN_BULLET_RE);
    if (bullet) {
      flushParagraph(blocks, paragraphLines);
      flushDefinitionList(blocks, definitionItems);
      listItems.push(bullet[1]?.trim() ?? '');
      continue;
    }

    flushList(blocks, listItems);
    flushDefinitionList(blocks, definitionItems);
    paragraphLines.push(stripBriefMarker(trimmed));
  }

  flushParagraph(blocks, paragraphLines);
  flushList(blocks, listItems);
  flushDefinitionList(blocks, definitionItems);
  flushCode(blocks, codeLines);

  return blocks.filter((block) => {
    if (block.kind === 'paragraph') {
      return block.text.length > 0;
    }
    if (block.kind === 'list') {
      return block.items.length > 0;
    }
    if (block.kind === 'definitionList') {
      return block.items.length > 0;
    }
    return block.text.length > 0;
  });
}

function renderInlineText(text: string): ReactNode[] {
  const parts = text.split(DOXYGEN_INLINE_CODE_RE);
  const nodes: ReactNode[] = [];

  parts.forEach((part, index) => {
    if (!part) {
      return;
    }

    if (index % 2 === 1) {
      nodes.push(
        <code
          key={`inline-code-${index}`}
          className="rounded bg-slate-950/80 px-1 py-0.5 font-mono text-xs text-slate-100"
        >
          {part}
        </code>,
      );
      return;
    }

    nodes.push(part);
  });

  return nodes;
}

export function renderDoxygenBlocks(blocks: DoxygenBlock[]): ReactNode[] {
  return blocks.map((block, index) => {
    if (block.kind === 'paragraph') {
      return (
        <p key={`paragraph-${index}`} className="whitespace-pre-wrap leading-6">
          {renderInlineText(block.text)}
        </p>
      );
    }

    if (block.kind === 'list') {
      return (
        <ul key={`list-${index}`} className="list-disc space-y-1 pl-5">
          {block.items.map((item, itemIndex) => (
            <li key={`list-${index}-${itemIndex}`}>{renderInlineText(item)}</li>
          ))}
        </ul>
      );
    }

    if (block.kind === 'definitionList') {
      return (
        <dl key={`definition-list-${index}`} className="space-y-3">
          {block.items.map((item, itemIndex) => (
            <div key={`definition-${index}-${itemIndex}`} className="space-y-1">
              <dt className="font-mono text-sm">{renderInlineText(item.term)}</dt>
              {item.description ? (
                <dd className="whitespace-pre-wrap leading-6">
                  {renderInlineText(item.description)}
                </dd>
              ) : null}
            </div>
          ))}
        </dl>
      );
    }

    return (
      <pre
        key={`code-${index}`}
        className="overflow-x-auto rounded border border-slate-700 bg-slate-950 p-3 text-slate-100"
      >
        <code className="font-mono text-xs leading-5">{block.text}</code>
      </pre>
    );
  });
}

export function DoxygenText({ text, className }: { text?: string; className?: string }) {
  const blocks = parseDoxygenBlocks(text);
  if (blocks.length === 0) {
    return null;
  }

  return <div className={className}>{renderDoxygenBlocks(blocks)}</div>;
}
