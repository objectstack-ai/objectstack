// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Generic metadata list page — used by every top-level nav area
 * (Objects, Forms, Views & Apps, Automations, AI, Security, APIs).
 *
 * Behavior:
 *   • Loads items for each provided `types[]` from the metadata service.
 *   • Renders a single search box + type-filter chips + result grid.
 *   • Empty / loading / error states.
 *   • Row click routes to the correct viewer:
 *       - `object` → /pkg/objects/$name (Object Hub)
 *       - everything else → /pkg/metadata/$type/$name (PluginHost)
 *
 * This component intentionally replaces the old sidebar tree as the
 * primary "find a metadata item" UX — scaling to thousands of items
 * with search + filter rather than a deep collapsible tree.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { Eye, Search } from 'lucide-react';
import { useClient, useMetadataSubscriptionCallback } from '@objectstack/client-react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { MetadataPreview } from './MetadataPreview';
import { navItemForType, typeLabel } from './studio-nav';
import type { LucideIcon } from 'lucide-react';

/** Metadata types we can render a live preview for via @object-ui. */
const PREVIEWABLE_TYPES = new Set(['object', 'view', 'dashboard']);

export interface MetadataListPageProps {
  /** Display title (e.g. "Objects", "Forms"). */
  title: string;
  /** Short subtitle / job description. */
  subtitle: string;
  /** Metadata types to surface (e.g. ['view', 'app', 'dashboard']). */
  types: string[];
  /** Package id (URL parameter). Empty / 'all' / falsy → query all packages. */
  packageId: string | null | undefined;
  /** Optional client-side filter — used by Forms to keep only `viewType === 'form'`. */
  filterItem?: (item: any, type: string) => boolean;
  /** Optional extra header content (e.g. publish button). */
  rightSlot?: React.ReactNode;
  /** Optional empty-state CTA. */
  emptyCta?: React.ReactNode;
  /** Optional icon override per row. */
  iconForType?: (type: string) => LucideIcon | undefined;
}

interface Row {
  type: string;
  name: string;
  label: string;
  updatedAt?: string;
  raw: any;
}

function resolveLabel(val: unknown): string {
  if (typeof val === 'string') return val;
  if (val && typeof val === 'object' && 'defaultValue' in val) return String((val as any).defaultValue);
  if (val && typeof val === 'object' && 'key' in val) return String((val as any).key);
  return '';
}

export function MetadataListPage({
  title,
  subtitle,
  types,
  packageId,
  filterItem,
  rightSlot,
  emptyCta,
  iconForType,
}: MetadataListPageProps) {
  const client = useClient();
  const navigate = useNavigate();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [previewRow, setPreviewRow] = useState<Row | null>(null);
  const [activeTypes, setActiveTypes] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const all: Row[] = [];
      // 'all' (no-filter sentinel) and falsy → query without package filter.
      const opts = packageId && packageId !== 'all' ? { packageId } : undefined;
      for (const type of types) {
        try {
          const res = await client.meta.getItems(type, opts);
          const items: any[] = res?.items || (Array.isArray(res) ? res : []);
          for (const item of items) {
            if (filterItem && !filterItem(item, type)) continue;
            all.push({
              type,
              name: item.name || item.id || 'unknown',
              label: resolveLabel(item.label) || item.name || 'Untitled',
              updatedAt: item.updatedAt || item._updatedAt,
              raw: item,
            });
          }
        } catch (e) {
          // tolerate single-type failures
          console.warn(`[MetadataListPage] failed to load ${type}`, e);
        }
      }
      setRows(all);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [client, packageId, types, filterItem]);

  useEffect(() => {
    load();
  }, [load]);

  useMetadataSubscriptionCallback('object', load);
  useMetadataSubscriptionCallback('view', load);
  useMetadataSubscriptionCallback('flow', load);
  useMetadataSubscriptionCallback('agent', load);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((r) => {
      if (activeTypes.size > 0 && !activeTypes.has(r.type)) return false;
      if (!q) return true;
      return (
        r.label.toLowerCase().includes(q) ||
        r.name.toLowerCase().includes(q) ||
        r.type.toLowerCase().includes(q)
      );
    });
  }, [rows, query, activeTypes]);

  const typeCounts = useMemo(() => {
    const m: Record<string, number> = {};
    for (const r of rows) m[r.type] = (m[r.type] ?? 0) + 1;
    return m;
  }, [rows]);

  const toggleType = (t: string) => {
    setActiveTypes((prev) => {
      const next = new Set(prev);
      if (next.has(t)) next.delete(t);
      else next.add(t);
      return next;
    });
  };

  const openRow = (row: Row) => {
    const pkg = packageId || 'all';
    if (row.type === 'object') {
      navigate({ to: `/${pkg}/objects/${row.name}` });
    } else {
      navigate({ to: `/${pkg}/metadata/${row.type}/${row.name}` });
    }
  };

  return (
    <div className="flex h-full flex-1 flex-col overflow-hidden">
      <div className="border-b px-6 py-4">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
            <p className="text-sm text-muted-foreground">{subtitle}</p>
          </div>
          <div className="flex items-center gap-2">{rightSlot}</div>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <div className="relative max-w-md flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={`Search ${title}…`}
              className="pl-9"
              autoFocus
            />
          </div>
          {types.length > 1 && (
            <div className="flex flex-wrap items-center gap-1.5">
              {types.map((t) => {
                const count = typeCounts[t] ?? 0;
                if (count === 0) return null;
                const active = activeTypes.has(t);
                const label = typeLabel(t);
                return (
                  <Button
                    key={t}
                    variant={active ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => toggleType(t)}
                    className="h-7 gap-1.5 text-xs"
                  >
                    {label} <span className="opacity-60">{count}</span>
                  </Button>
                );
              })}
            </div>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        {loading ? (
          <div className="py-12 text-center text-sm text-muted-foreground">Loading…</div>
        ) : error ? (
          <div className="py-12 text-center text-sm text-destructive">Failed: {error}</div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
            <p className="text-sm font-medium">
              {rows.length === 0
                ? packageId && packageId !== 'all'
                  ? `Nothing in ${title} for this package yet.`
                  : `Nothing in ${title} yet.`
                : 'No matches.'}
            </p>
            {rows.length === 0 && (
              <p className="max-w-md text-xs text-muted-foreground">{subtitle}</p>
            )}
            {emptyCta}
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {filtered.map((row) => {
              const Icon = iconForType?.(row.type) ?? navItemForType(row.type)?.icon;
              const canPreview = PREVIEWABLE_TYPES.has(row.type);
              return (
                <Card
                  key={`${row.type}:${row.name}`}
                  className="group cursor-pointer transition hover:border-primary hover:shadow-sm"
                  onClick={() => openRow(row)}
                >
                  <CardContent className="flex flex-col gap-2 p-4">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex min-w-0 items-center gap-2">
                        {Icon && <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />}
                        <span className="truncate font-medium">{row.label}</span>
                      </div>
                      <Badge variant="secondary" className="shrink-0 text-[10px]">
                        {row.type}
                      </Badge>
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <code className="truncate text-xs text-muted-foreground">{row.name}</code>
                      {canPreview && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 gap-1 px-1.5 text-[11px]"
                          onClick={(e) => {
                            e.stopPropagation();
                            setPreviewRow(row);
                          }}
                        >
                          <Eye className="h-3 w-3" /> Preview
                        </Button>
                      )}
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>

      <Dialog open={!!previewRow} onOpenChange={(o) => !o && setPreviewRow(null)}>
        <DialogContent className="max-w-5xl">
          <DialogHeader>
            <DialogTitle>{previewRow?.label ?? previewRow?.name}</DialogTitle>
            <DialogDescription>
              Live preview rendered with @object-ui against the configured backend.
            </DialogDescription>
          </DialogHeader>
          {previewRow && (
            <div className="h-[70vh] overflow-hidden">
              <MetadataPreview
                type={previewRow.type}
                name={previewRow.name}
                spec={previewRow.raw?.spec ?? previewRow.raw}
              />
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
