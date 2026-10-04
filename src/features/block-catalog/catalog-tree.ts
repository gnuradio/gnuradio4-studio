import type { BlockCatalogItem } from '../../lib/api/blocks';

export type ParsedTypeId = {
  moduleName: string;
  familyName: string;
  variantLabel: string;
};

export type CatalogTypeGroup = Map<string, BlockCatalogItem[]>;
export type CategoryTreeNode = {
  children: Map<string, CategoryTreeNode>;
  types: CatalogTypeGroup;
};

export function createCategoryTreeNode(): CategoryTreeNode {
  return {
    children: new Map(),
    types: new Map(),
  };
}

function splitTopLevelTemplateArgs(templateArgs: string): string[] {
  const args: string[] = [];
  let depth = 0;
  let start = 0;

  for (let index = 0; index < templateArgs.length; index += 1) {
    const char = templateArgs[index];
    if (char === '<') {
      depth += 1;
      continue;
    }
    if (char === '>') {
      depth = Math.max(0, depth - 1);
      continue;
    }
    if (char === ',' && depth === 0) {
      args.push(templateArgs.slice(start, index).trim());
      start = index + 1;
    }
  }

  const tail = templateArgs.slice(start).trim();
  if (tail) {
    args.push(tail);
  }

  return args.filter((arg) => arg.length > 0);
}

function stripScopedTypeNames(typeExpr: string): string {
  return typeExpr.replace(
    /\b[A-Za-z_]\w*(?:::[A-Za-z_]\w*)+\b/g,
    (match) => {
      const segments = match.split('::');
      return segments[segments.length - 1] ?? match;
    },
  );
}

export function parseTypeId(blockTypeId: string): ParsedTypeId {
  const lt = blockTypeId.indexOf('<');
  const hasTemplate = lt >= 0 && blockTypeId.endsWith('>');
  const core = hasTemplate ? blockTypeId.slice(0, lt) : blockTypeId;
  const templateArgs = hasTemplate ? blockTypeId.slice(lt + 1, -1) : '';

  const scopeSplit = core.lastIndexOf('::');
  const dottedSplit = core.lastIndexOf('.');
  const moduleName =
    scopeSplit >= 0
      ? core.slice(0, scopeSplit)
      : dottedSplit >= 0
        ? core.slice(0, dottedSplit)
        : '(uncategorized)';
  const familyName =
    scopeSplit >= 0
      ? core.slice(scopeSplit + 2)
      : dottedSplit >= 0
        ? core.slice(dottedSplit + 1)
        : core;

  const topLevelArgs = templateArgs ? splitTopLevelTemplateArgs(templateArgs) : [];
  const primaryArg = topLevelArgs[0] ?? '';
  const compactPrimaryArg = primaryArg ? stripScopedTypeNames(primaryArg) : '';

  return {
    moduleName,
    familyName: familyName || blockTypeId,
    variantLabel: compactPrimaryArg ? `<${compactPrimaryArg}>` : '(default)',
  };
}

const TYPE_ABBREVIATIONS: Record<string, string> = {
  float: 'f32',
  float32: 'f32',
  double: 'f64',
  float64: 'f64',
  int8: 'i8',
  int16: 'i16',
  int32: 'i32',
  int64: 'i64',
  uint8: 'ui8',
  uint16: 'ui16',
  uint32: 'ui32',
  uint64: 'ui64',
  complex: 'c',
  pmtcomplex: 'c',
};

/** `std::complex<float32>` -> `c<f32>`; unknown names are kept without namespaces. */
export function abbreviateTypeExpr(typeExpr: string): string {
  const trimmed = stripScopedTypeNames(typeExpr.trim());
  const lt = trimmed.indexOf('<');
  if (lt < 0 || !trimmed.endsWith('>')) {
    return TYPE_ABBREVIATIONS[trimmed] ?? trimmed;
  }
  const head = trimmed.slice(0, lt).trim();
  const args = splitTopLevelTemplateArgs(trimmed.slice(lt + 1, -1)).map(abbreviateTypeExpr);
  return `${TYPE_ABBREVIATIONS[head] ?? head}<${args.join(', ')}>`;
}

export function deriveNamespaceCategoryPath(blockTypeId: string): string {
  const lt = blockTypeId.indexOf('<');
  const core = lt >= 0 ? blockTypeId.slice(0, lt) : blockTypeId;
  const segments = core.split('::').filter((segment) => segment.length > 0);
  const trimmed = segments[0] === 'gr' ? segments.slice(1, -1) : segments.slice(0, -1);
  return trimmed.length > 0 ? trimmed.join('/') : 'uncategorized';
}

export function isMalformedCategoryPath(category: string): boolean {
  return /[<>()]/.test(category) || category.includes(',');
}

export function normalizeCategoryPath(block: BlockCatalogItem): string {
  void block;
  return deriveNamespaceCategoryPath(block.blockTypeId);
}

export function countCategoryNode(node: CategoryTreeNode): number {
  let total = 0;
  for (const variants of node.types.values()) {
    total += variants.length;
  }
  for (const child of node.children.values()) {
    total += countCategoryNode(child);
  }
  return total;
}

export function collectCategoryPaths(
  node: CategoryTreeNode,
  path: string[] = [],
  result: string[] = [],
): string[] {
  const entries = Array.from(node.children.entries()).sort(([a], [b]) => a.localeCompare(b));

  for (const [name, child] of entries) {
    const childPath = [...path, name];
    result.push(childPath.join('/'));
    collectCategoryPaths(child, childPath, result);
  }

  return result;
}

export function buildCategoryTree(blocks: BlockCatalogItem[]): CategoryTreeNode {
  const root = createCategoryTreeNode();

  for (const block of blocks) {
    const parsed = parseTypeId(block.blockTypeId);
    const categoryPath = normalizeCategoryPath(block);
    const segments = categoryPath.split('/').filter((segment) => segment.length > 0);

    let current = root;
    for (const segment of segments) {
      const next = current.children.get(segment) ?? createCategoryTreeNode();
      current.children.set(segment, next);
      current = next;
    }

    const typeName = parsed.familyName;
    const variants = current.types.get(typeName) ?? [];
    variants.push(block);
    current.types.set(typeName, variants);
  }

  return root;
}
