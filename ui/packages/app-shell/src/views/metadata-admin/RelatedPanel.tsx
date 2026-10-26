// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * RelatedPanel — lists metadata items anchored to the current parent.
 *
 * Driven by the anchor registry (see `anchors.ts` / `registry.ts`). For
 * each child type that declares it anchors at `parentType`, we issue
 * one `client.list(childType)` call in parallel, filter the result with
 * the anchor's match predicate, and render the survivors in collapsible
 * groups.
 *
 * Why client-side filter? Anchoring lives in metadata bodies that are
 * not indexed on the server today, and adding a parameterised list API
 * for every potential anchor field would balloon the surface area. The
 * Related tab is opened by humans on a specific object, so the cost of
 * pulling 100-or-so items per child type is negligible — far cheaper
 * than a network round-trip per row would have been.
 *
 * Visual model:
 *   - One <details> per group (default open if non-empty).
 *   - Rows are kebab-y: name, optional label, optional badge.
 *   - Click → call `onOpen({ type, name })`; parent owns the drawer.
 *   - A search input filters across all groups by name/label substring.
 */

import * as React from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader2, Search, Plus, ChevronRight, ExternalLink } from 'lucide-react';
import {
  Badge,
  Button,
  Input,
  Empty,
  EmptyTitle,
  EmptyDescription,
  cn,
} from '@object-ui/components';
import { useMetadataClient } from './useMetadata.js';
import { listAnchorsFor, type MetadataAnchor } from './registry.js';

export interface RelatedPanelProps {
  /** Parent metadata type, e.g. `object`. */
  type: string;
  /** Parent item name (e.g. `sys_user`). */
  name: string;
  /**
   * Effective parent body — used to feed `source: 'embedded'` anchors
   * (e.g. `object.fields[]`). Optional: if absent, embedded groups are
   * skipped.
   */
  parentItem?: Record<string, unknown> | null;
  /** Invoked when the user clicks a row. Parent should open a drawer. */
  onOpen: (target: RelatedTarget) => void;
}

/**
 * Target opened from a Related row. For first-class metadata items
 * `kind: 'metadata'` carries the addressable (type, name). For embedded
 * items we hand back the raw object plus the path it came from so the
 * parent can render a focused detail view.
 */
export type RelatedTarget =
  | { kind: 'metadata'; type: string; name: string }
  | {
      kind: 'embedded';
      parentType: string;
      parentName: string;
      groupLabel: string;
      itemName: string;
      raw: Record<string, unknown>;
      /** Metadata type whose schema drives the editor (e.g. 'field'). */
      editAs?: string;
      /** Dotted path inside parent where this collection lives (e.g. 'fields'). */
      embeddedPath?: string;
    };

interface ChildItem {
  name: string;
  label?: string;
  description?: string;
  raw: Record<string, unknown>;
}

interface GroupState {
  childType: string;
  anchor: MetadataAnchor;
  loading: boolean;
  error: string | null;
  items: ChildItem[];
}

export function RelatedPanel({
  type,
  name,
  parentItem,
  onOpen,
}: RelatedPanelProps) {
  const client = useMetadataClient();
  const navigate = useNavigate();
  const anchors = React.useMemo(() => listAnchorsFor(type), [type]);
  const [groups, setGroups] = React.useState<GroupState[]>([]);
  const [search, setSearch] = React.useState('');
  const [collapsed, setCollapsed] = React.useState<Record<string, boolean>>({});

  React.useEffect(() => {
    if (anchors.length === 0) {
      setGroups([]);
      return;
    }
    let cancelled = false;
    // Seed groups in loading state, ordered by registry order. Embedded
    // groups resolve synchronously from `parentItem`; list groups dispatch
    // a `client.list(childType)` and filter.
    const initial: GroupState[] = [...anchors]
      .sort((a, b) => (a.anchor.order ?? 999) - (b.anchor.order ?? 999))
      .map((entry) => {
        const isEmbedded = entry.anchor.source === 'embedded';
        if (isEmbedded) {
          const raw = entry.anchor.extract && parentItem
            ? entry.anchor.extract(parentItem)
            : [];
          return {
            childType: entry.type,
            anchor: entry.anchor,
            loading: false,
            error: null,
            items: raw.map(normaliseItem),
          };
        }
        return {
          childType: entry.type,
          anchor: entry.anchor,
          loading: true,
          error: null,
          items: [],
        };
      });
    setGroups(initial);

    void Promise.all(
      initial.map(async (g) => {
        if (g.anchor.source === 'embedded') return g;
        try {
          const list = (await client.list(g.childType)) as Array<Record<string, unknown>>;
          if (cancelled) return g;
          const matchFn = g.anchor.match ?? (() => false);
          const filtered = list
            .filter((item) => matchFn(item, name))
            .map((item) => normaliseItem(item));
          return { ...g, loading: false, items: filtered };
        } catch (err: unknown) {
          if (cancelled) return g;
          return {
            ...g,
            loading: false,
            error: err instanceof Error ? err.message : String(err),
          };
        }
      }),
    ).then((finished) => {
      if (cancelled) return;
      setGroups(finished);
    });

    return () => {
      cancelled = true;
    };
  }, [client, type, name, anchors, parentItem]);

  if (anchors.length === 0) {
    return (
      <Empty>
        <EmptyTitle>No related metadata</EmptyTitle>
        <EmptyDescription>
          No metadata types are configured to anchor at <code>{type}</code>.
          You can register one via{' '}
          <code className="font-mono">registerMetadataResource</code>.
        </EmptyDescription>
      </Empty>
    );
  }

  const totalCount = groups.reduce((sum, g) => sum + g.items.length, 0);
  const anyLoading = groups.some((g) => g.loading);
  const q = search.trim().toLowerCase();

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search related…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8 h-8 text-sm"
          />
        </div>
        <div className="text-xs text-muted-foreground">
          {anyLoading
            ? 'Scanning…'
            : `${totalCount} item${totalCount === 1 ? '' : 's'}`}
        </div>
      </div>

      {groups.map((g) => {
        const matches = q
          ? g.items.filter(
              (it) =>
                it.name.toLowerCase().includes(q) ||
                (it.label ?? '').toLowerCase().includes(q),
            )
          : g.items;
        const isCollapsed = collapsed[g.childType] ?? false;
        const visible = !q || matches.length > 0;
        if (!visible && !g.loading) return null;
        return (
          <div key={g.childType} className="border rounded-lg overflow-hidden">
            <div className="w-full flex items-center gap-2 px-3 py-2 bg-muted/40">
              <button
                type="button"
                className="flex items-center gap-2 flex-1 text-left hover:opacity-80"
                onClick={() =>
                  setCollapsed((s) => ({ ...s, [g.childType]: !isCollapsed }))
                }
              >
                <ChevronRight
                  className={cn(
                    'h-4 w-4 text-muted-foreground transition-transform',
                    !isCollapsed && 'rotate-90',
                  )}
                />
                <div className="text-sm font-medium">
                  {g.anchor.groupLabel ?? g.childType}
                </div>
                <Badge variant="outline" className="text-[10px]">
                  {g.loading ? '…' : matches.length}
                </Badge>
              </button>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2"
                onClick={() => {
                  if (g.anchor.source === 'embedded') {
                    // Embedded items are edited inside the parent's Form
                    // tab; jump there rather than to a nonexistent route.
                    if (typeof window !== 'undefined') {
                      const url = new URL(window.location.href);
                      url.searchParams.set('tab', 'form');
                      url.searchParams.delete('open');
                      window.location.assign(url.toString());
                    }
                    return;
                  }
                  navigate(
                    `../../${encodeURIComponent(g.childType)}/_new?anchor=${encodeURIComponent(
                      `${type}:${name}`,
                    )}`,
                  );
                }}
                title={
                  g.anchor.source === 'embedded'
                    ? `Edit in Form tab`
                    : `New ${g.childType}`
                }
              >
                <Plus className="h-3.5 w-3.5" />
              </Button>
            </div>

            {!isCollapsed && (
              <div>
                {g.loading && (
                  <div className="px-3 py-3 text-xs text-muted-foreground flex items-center gap-2">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    Loading {g.childType}…
                  </div>
                )}
                {!g.loading && g.error && (
                  <div className="px-3 py-3 text-xs text-destructive">
                    Failed: {g.error}
                  </div>
                )}
                {!g.loading && !g.error && matches.length === 0 && (
                  <div className="px-3 py-3 text-xs text-muted-foreground">
                    {q ? 'No matches.' : 'Nothing here yet.'}
                  </div>
                )}
                {!g.loading && !g.error && matches.length > 0 && (
                  <table className="w-full text-sm border-t">
                    <thead>
                      <tr className="bg-muted/30 text-[10px] uppercase tracking-wider text-muted-foreground">
                        <th className="text-left font-medium px-3 py-1.5 w-[45%]">
                          Name
                        </th>
                        <th className="text-left font-medium px-3 py-1.5">
                          Label
                        </th>
                        <th className="w-8" />
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {matches.map((it, idx) => (
                        <tr
                          key={`${it.name}-${idx}`}
                          role="button"
                          tabIndex={0}
                          onClick={() =>
                            onOpen(
                              g.anchor.source === 'embedded'
                                ? {
                                    kind: 'embedded',
                                    parentType: type,
                                    parentName: name,
                                    groupLabel:
                                      g.anchor.groupLabel ?? g.childType,
                                    itemName: it.name,
                                    raw: it.raw,
                                    editAs: g.anchor.editAs,
                                    embeddedPath: g.anchor.embeddedPath,
                                  }
                                : {
                                    kind: 'metadata',
                                    type: g.childType,
                                    name: it.name,
                                  },
                            )
                          }
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              (e.currentTarget as HTMLElement).click();
                            }
                          }}
                          className="hover:bg-accent/50 cursor-pointer"
                        >
                          <td className="px-3 py-1.5 font-mono text-xs truncate max-w-0">
                            {it.name}
                          </td>
                          <td className="px-3 py-1.5 text-xs text-muted-foreground truncate max-w-0">
                            {it.label && it.label !== it.name ? it.label : ''}
                          </td>
                          <td className="px-3 py-1.5 text-right">
                            <ExternalLink className="h-3.5 w-3.5 text-muted-foreground inline" />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function normaliseItem(raw: Record<string, unknown>): ChildItem {
  const nameVal = pickString(raw, ['name', 'id', 'key']) ?? '(unnamed)';
  const labelVal = pickString(raw, ['label', 'title', 'displayName']);
  const descVal = pickString(raw, ['description', 'summary']);
  return {
    name: nameVal,
    label: labelVal,
    description: descVal,
    raw,
  };
}

function pickString(
  obj: Record<string, unknown>,
  keys: string[],
): string | undefined {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === 'string' && v.length > 0) return v;
  }
  return undefined;
}
