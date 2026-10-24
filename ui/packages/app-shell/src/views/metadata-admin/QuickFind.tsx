// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * MetadataQuickFind — Cmd+K palette that searches across all
 * metadata types (Phase 3c).
 *
 * Behaviour:
 *   • Mounted as a side-effect via `<MetadataQuickFindMount />`.
 *   • Listens for Cmd+K / Ctrl+K globally; opens a dialog with a
 *     search input.
 *   • Free-text search hits two pools:
 *       (a) Metadata types from `/meta/types` (jump to directory entry).
 *       (b) Items of any type — lazy-fetched the first time the palette
 *           opens, cached for the session.
 *   • Selecting a result navigates to the appropriate route.
 *
 * Trade-offs: For the MVP we eagerly fetch the item index on first
 * open (one `/meta/:type` per writable type). For most workspaces
 * that's a few hundred items total — well within a fast modal load.
 * If usage grows we'll switch to server-side search.
 */

import * as React from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@object-ui/components';
import { Input } from '@object-ui/components';
import { Badge } from '@object-ui/components';
import { Kbd } from '@object-ui/components';
import { Search, Loader2, Lock } from 'lucide-react';
import {
  useMetadataClient,
  useMetadataTypes,
  type RichMetadataTypeEntry,
} from './useMetadata.js';
import { useMetadataLocale, t as tr, translateMetadataType } from './i18n.js';

type ItemResult = {
  kind: 'item';
  type: string;
  name: string;
  label?: string;
  description?: string;
  /** Lock state from `_lock` envelope (`none` / `no-overlay` / `no-delete` / `full`). */
  lock?: string;
  /** Reason shown in the lock icon tooltip. */
  lockReason?: string;
};

type TypeResult = {
  kind: 'type';
  entry: RichMetadataTypeEntry;
};

type Result = ItemResult | TypeResult;

export interface MetadataQuickFindProps {
  /** Optional app slug for routing; defaults to "setup" if unknown. */
  appSlug?: string;
}

export function MetadataQuickFind({ appSlug }: MetadataQuickFindProps = {}) {
  const navigate = useNavigate();
  const client = useMetadataClient();
  const { entries: typeEntries } = useMetadataTypes(client);

  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState('');
  const [items, setItems] = React.useState<ItemResult[] | null>(null);
  const [itemsLoading, setItemsLoading] = React.useState(false);
  const [activeIdx, setActiveIdx] = React.useState(0);
  const locale = useMetadataLocale();

  // Global Cmd+Shift+M listener (avoids clashing with the existing
  // CommandPalette which owns Cmd+K).
  React.useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'm') {
        e.preventDefault();
        setOpen((v) => !v);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Lazy-fetch item index when palette first opens.
  React.useEffect(() => {
    if (!open || items != null || itemsLoading || typeEntries.length === 0) return;
    setItemsLoading(true);
    let cancelled = false;
    (async () => {
      try {
        // Index *all* types (read-only ones are fine — we just won't
        // offer create/edit for them; users may still want to find code
        // artifacts to inspect).
        const all: ItemResult[] = [];
        await Promise.all(
          typeEntries.map(async (t) => {
            try {
              const list = await client.list<any>(t.type);
              for (const raw of list ?? []) {
                const item = (raw && typeof raw === 'object' && 'item' in raw ? raw.item : raw) ?? {};
                const name = item?.name;
                if (!name) continue;
                all.push({
                  kind: 'item',
                  type: t.type,
                  name: String(name),
                  label: item?.label,
                  description: item?.description,
                  lock: typeof item?._lock === 'string' ? item._lock : undefined,
                  lockReason: typeof item?._lockReason === 'string' ? item._lockReason : undefined,
                });
              }
            } catch {
              /* skip types that error */
            }
          }),
        );
        if (!cancelled) setItems(all);
      } finally {
        if (!cancelled) setItemsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, items, itemsLoading, typeEntries, client]);

  // Compose results: typed matches first, then item matches.
  const results: Result[] = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) {
      // Empty query → show the type directory only.
      return typeEntries.slice(0, 20).map((entry) => ({ kind: 'type', entry } as TypeResult));
    }
    const typeHits: TypeResult[] = typeEntries
      .filter(
        (e) =>
          e.type.toLowerCase().includes(q) ||
          (e.label ?? '').toLowerCase().includes(q) ||
          translateMetadataType(e.type, locale, e.label).toLowerCase().includes(q) ||
          (e.description ?? '').toLowerCase().includes(q),
      )
      .slice(0, 8)
      .map((entry) => ({ kind: 'type', entry }));
    const itemHits: ItemResult[] = (items ?? [])
      .filter(
        (i) =>
          i.name.toLowerCase().includes(q) ||
          (i.label ?? '').toLowerCase().includes(q) ||
          (i.description ?? '').toLowerCase().includes(q) ||
          i.type.toLowerCase().includes(q),
      )
      .slice(0, 40);
    return [...typeHits, ...itemHits];
  }, [query, typeEntries, items]);

  React.useEffect(() => {
    setActiveIdx(0);
  }, [query, open]);

  function navigateTo(r: Result) {
    setOpen(false);
    const base = appSlug ? `/apps/${appSlug}` : '..';
    if (r.kind === 'type') {
      navigate(`${base}/metadata/${encodeURIComponent(r.entry.type)}`);
    } else {
      navigate(
        `${base}/metadata/${encodeURIComponent(r.type)}/${encodeURIComponent(r.name)}`,
      );
    }
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIdx((i) => Math.min(i + 1, results.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      if (results[activeIdx]) {
        e.preventDefault();
        navigateTo(results[activeIdx]);
      }
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-2xl p-0 overflow-hidden">
        <DialogHeader className="sr-only">
          <DialogTitle>{tr('engine.quickfind.title', locale)}</DialogTitle>
        </DialogHeader>
        <div className="border-b px-3 py-2 flex items-center gap-2">
          <Search className="h-4 w-4 text-muted-foreground" />
          <Input
            autoFocus
            placeholder={tr('engine.quickfind.placeholder', locale)}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            className="border-0 shadow-none focus-visible:ring-0 px-0"
          />
          <Kbd>esc</Kbd>
        </div>
        <div className="max-h-[440px] overflow-auto">
          {itemsLoading && (
            <div className="px-3 py-4 text-xs text-muted-foreground flex items-center gap-2">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              {tr('engine.quickfind.indexing', locale)} {typeEntries.length}…
            </div>
          )}
          {!itemsLoading && results.length === 0 && (
            <div className="px-3 py-6 text-xs text-muted-foreground text-center">
              {tr('engine.quickfind.noMatches', locale)}
            </div>
          )}
          <ul role="listbox">
            {results.map((r, i) => (
              <li
                key={
                  r.kind === 'type'
                    ? `t:${r.entry.type}`
                    : `i:${r.type}:${r.name}`
                }
              >
                <button
                  type="button"
                  onClick={() => navigateTo(r)}
                  onMouseEnter={() => setActiveIdx(i)}
                  className={
                    'w-full text-left px-3 py-2 flex items-center gap-3 hover:bg-accent ' +
                    (i === activeIdx ? 'bg-accent' : '')
                  }
                >
                  <Badge
                    variant="outline"
                    className="text-[10px] font-mono shrink-0"
                  >
                    {r.kind === 'type' ? 'type' : r.type}
                  </Badge>
                  <div className="min-w-0 flex-1">
                    {r.kind === 'type' ? (
                      <>
                        <div className="text-sm font-medium truncate">
                          {translateMetadataType(r.entry.type, locale, r.entry.label)}
                        </div>
                        {r.entry.description && (
                          <div className="text-xs text-muted-foreground truncate">
                            {r.entry.description}
                          </div>
                        )}
                      </>
                    ) : (
                      <>
                        <div className="text-sm font-mono truncate flex items-center gap-1.5">
                          {r.lock && r.lock !== 'none' && (
                            <span
                              className="text-amber-600 dark:text-amber-400 shrink-0"
                              title={r.lockReason ?? `_lock=${r.lock}`}
                              aria-label="locked"
                            >
                              <Lock className="h-3 w-3" />
                            </span>
                          )}
                          {r.name}
                          {r.label && (
                            <span className="text-muted-foreground font-sans ml-2">
                              {r.label}
                            </span>
                          )}
                        </div>
                        {r.description && (
                          <div className="text-xs text-muted-foreground truncate">
                            {r.description}
                          </div>
                        )}
                      </>
                    )}
                  </div>
                </button>
              </li>
            ))}
          </ul>
        </div>
        <div className="border-t px-3 py-1.5 flex items-center gap-3 text-[10px] text-muted-foreground">
          <span>
            <Kbd>↑</Kbd> <Kbd>↓</Kbd> navigate
          </span>
          <span>
            <Kbd>↵</Kbd> open
          </span>
          <span className="ml-auto">
            <Kbd>⌘</Kbd>
            <Kbd>⇧</Kbd>
            <Kbd>M</Kbd> toggle
          </span>
        </div>
      </DialogContent>
    </Dialog>
  );
}
