import { useEffect, useMemo, useRef, useState } from 'react';
import type { BlockCatalogItem } from '../../lib/api/blocks';
import { ApiClientError } from '../../lib/api/client';
import { PanelHeader } from '../../components/panel-header';
import { extractDoxygenBrief } from '../documentation/model/doxygen';
import { toEditorCatalogBlock } from '../graph-editor/model/nodeFactory';
import { getVirtualRoutingCatalogBlocks } from '../graph-editor/model/virtual-routing';
import { useEditorStore } from '../graph-editor/store/editorStore';
import {
  buildCategoryTree,
  collectCategoryPaths,
  countCategoryNode,
  normalizeCategoryPath,
  parseTypeId,
  type CatalogTypeGroup,
  type CategoryTreeNode,
} from './catalog-tree';
import { useBlockCatalogQuery } from './hooks/use-block-catalog-query';
import { config } from '../../lib/config';
import { SidePanelToggleButton } from '../../components/side-panel-toggle-button';

function BlockVariantButton({ block }: { block: BlockCatalogItem }) {
  const addNodeFromCatalogItem = useEditorStore((state) => state.addNodeFromCatalogItem);
  const parsed = parseTypeId(block.blockTypeId);

  return (
    <button
      className="w-full text-left rounded-md border border-slate-700 bg-slate-800/70 px-3 py-2 hover:border-accent hover:bg-slate-800 transition"
      onClick={() => addNodeFromCatalogItem(toEditorCatalogBlock(block))}
      title={block.blockTypeId}
      type="button"
    >
      <div className="text-sm font-medium text-slate-100">
        {parsed.familyName} {parsed.variantLabel}
      </div>
      {block.description && (
        <div className="mt-1 text-xs text-slate-400 line-clamp-2">
          {extractDoxygenBrief(block.description) ?? block.description}
        </div>
      )}
    </button>
  );
}

function TypeGroupList({ types, pathKey }: { types: CatalogTypeGroup; pathKey: string }) {
  const typeNames = Array.from(types.keys()).sort((a, b) => a.localeCompare(b));

  return (
    <div className="space-y-2 pb-1">
      {typeNames.map((typeName) => {
        const variants = (types.get(typeName) ?? [])
          .slice()
          .sort((a, b) => a.blockTypeId.localeCompare(b.blockTypeId));

        return (
          <details
            key={`${pathKey}:${typeName}`}
            className="rounded border border-slate-700 bg-slate-950/60 px-2 py-1"
          >
            <summary className="cursor-pointer text-xs font-medium text-slate-300 py-1">
              {typeName} ({variants.length})
            </summary>

            <div className="space-y-2 pb-1">
              {variants.map((block) => (
                <BlockVariantButton key={block.blockTypeId} block={block} />
              ))}
            </div>
          </details>
        );
      })}
    </div>
  );
}

function CategoryTreeView({
  node,
  openPaths,
  onTogglePath,
  path = [],
}: {
  node: CategoryTreeNode;
  openPaths: Set<string>;
  onTogglePath: (pathKey: string, open: boolean) => void;
  path?: string[];
}) {
  const childNames = Array.from(node.children.keys()).sort((a, b) => a.localeCompare(b));

  return (
    <div className="space-y-2">
      {childNames.map((name) => {
        const child = node.children.get(name);
        if (!child) {
          return null;
        }

        const childPath = [...path, name];
        const pathKey = childPath.join('/');
        const count = countCategoryNode(child);

        return (
          <details
            key={pathKey}
            className="rounded-md border border-slate-700 bg-slate-900/60 px-2 py-1"
            open={openPaths.has(pathKey)}
            onToggle={(event) => onTogglePath(pathKey, event.currentTarget.open)}
          >
            <summary className="cursor-pointer text-sm font-medium text-slate-200 py-1">
              {name} ({count})
            </summary>

            <div className="space-y-2 pb-1 pl-2">
              <CategoryTreeView
                node={child}
                openPaths={openPaths}
                onTogglePath={onTogglePath}
                path={childPath}
              />
              {child.types.size > 0 && (
                <TypeGroupList types={child.types} pathKey={pathKey} />
              )}
            </div>
          </details>
        );
      })}

      {path.length === 0 && node.types.size > 0 && (
        <TypeGroupList types={node.types} pathKey="root" />
      )}
    </div>
  );
}

export function BlockCatalogPanel({ onCollapse }: { onCollapse?: () => void }) {
  const { data, isPending, isError, error } = useBlockCatalogQuery();
  const [searchQuery, setSearchQuery] = useState('');
  const catalogBlocks = useMemo(
    () => [...getVirtualRoutingCatalogBlocks(), ...(data ?? [])],
    [data],
  );
  const loadingMessage =
    config.backendMode === 'local'
      ? 'Connecting to local gr4cp...'
      : config.backendMode === 'remote'
        ? 'Connecting to remote gr4cp...'
        : 'Connecting to backend...';

  const filteredBlocks = useMemo(() => {
    if (!data) {
      return [];
    }

    const query = searchQuery.trim().toLowerCase();
    if (!query) {
      return catalogBlocks;
    }

    return catalogBlocks.filter((block) => {
      const parsed = parseTypeId(block.blockTypeId);
      const normalizedCategory = normalizeCategoryPath(block);
      return (
        block.blockTypeId.toLowerCase().includes(query) ||
        block.displayName.toLowerCase().includes(query) ||
        normalizedCategory.toLowerCase().includes(query) ||
        parsed.moduleName.toLowerCase().includes(query) ||
        parsed.familyName.toLowerCase().includes(query)
      );
    });
  }, [catalogBlocks, data, searchQuery]);

  const categoryTree = useMemo(() => buildCategoryTree(filteredBlocks), [filteredBlocks]);
  const allCategoryPaths = useMemo(() => collectCategoryPaths(categoryTree), [categoryTree]);
  const [openCategoryPaths, setOpenCategoryPaths] = useState<Set<string>>(new Set());
  const initializedOpenStateRef = useRef(false);
  const allExpanded = allCategoryPaths.length > 0 && openCategoryPaths.size === allCategoryPaths.length;

  useEffect(() => {
    setOpenCategoryPaths((current) => {
      const next = new Set<string>();
      for (const path of allCategoryPaths) {
        if (current.has(path)) {
          next.add(path);
        }
      }

      if (next.size > 0 || allCategoryPaths.length === 0 || initializedOpenStateRef.current) {
        return next;
      }

      initializedOpenStateRef.current = true;
      return new Set(allCategoryPaths.filter((path) => !path.includes('/')));
    });
  }, [allCategoryPaths]);

  function handleToggleCategoryPath(pathKey: string, open: boolean) {
    setOpenCategoryPaths((current) => {
      const next = new Set(current);
      if (open) {
        next.add(pathKey);
      } else {
        next.delete(pathKey);
      }
      return next;
    });
  }

  function handleToggleAllCategories() {
    if (allExpanded) {
      setOpenCategoryPaths(new Set());
      return;
    }

    setOpenCategoryPaths(new Set(allCategoryPaths));
  }

  return (
    <div className="h-full min-h-0 flex flex-col">
      <PanelHeader title="Block Catalog">
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={handleToggleAllCategories}
            disabled={allCategoryPaths.length === 0}
            aria-label={allExpanded ? 'Collapse all categories' : 'Expand all categories'}
            title={allExpanded ? 'Collapse all categories' : 'Expand all categories'}
            className="h-6 w-6 rounded border border-slate-700 bg-slate-900 text-sm font-medium text-slate-300 hover:border-accent hover:text-slate-100 disabled:cursor-not-allowed disabled:opacity-50 transition"
          >
            {allExpanded ? '−' : '+'}
          </button>
          {onCollapse ? (
            <SidePanelToggleButton direction="left" label="Collapse block catalog" onClick={onCollapse} />
          ) : null}
        </div>
      </PanelHeader>

      <div className="min-h-0 flex-1 p-3 overflow-y-auto space-y-2">
        <div className="sticky top-0 z-10 -mx-3 px-3 pb-2 bg-panel">
          <input
            type="text"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder="Search blocks..."
            className="w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
          />
        </div>

        {isPending && <p className="text-sm text-slate-400">{loadingMessage} Loading blocks...</p>}

        {isError && (
          <div className="rounded-md border border-rose-900 bg-rose-950/40 p-3 text-sm text-rose-200">
            Failed to load blocks: {error instanceof Error ? error.message : 'Unknown error'}
            {error instanceof ApiClientError && error.details && (
              <p className="mt-2 text-xs text-rose-300 break-words">{error.details}</p>
            )}
            <p className="mt-2 text-xs text-rose-300/90">
              Catalog loads use the app-owned `app-api` route surface. Check backend reachability and the `/api` proxy path if this persists.
            </p>
          </div>
        )}

        {!isPending && !isError && filteredBlocks.length === 0 && (
          <p className="text-sm text-slate-400">
            No blocks match &quot;{searchQuery.trim()}&quot;.
          </p>
        )}

        {!isPending && !isError && filteredBlocks.length > 0 && (
          <CategoryTreeView
            node={categoryTree}
            openPaths={openCategoryPaths}
            onTogglePath={handleToggleCategoryPath}
          />
        )}
      </div>
    </div>
  );
}
