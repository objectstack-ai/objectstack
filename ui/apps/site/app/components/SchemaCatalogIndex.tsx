'use client';

/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import React, {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react';
import {
  allExamples,
  type Example,
} from '@object-ui/example-schema-catalog';
import type { SchemaNode } from '@object-ui/core';
import { SchemaThumbnail } from './SchemaThumbnail';
import { InteractiveDemo } from './InteractiveDemo';

/** Top-level taxonomy bucket derived from the category slug. */
interface Group {
  /** Slug, e.g. `components`, `auth`. */
  key: string;
  /** Display label. */
  label: string;
  entries: Example[];
}

const GROUP_LABELS: Record<string, string> = {
  actions: 'Actions',
  app: 'App Shell',
  auth: 'Auth',
  block: 'Block Schema',
  blocks: 'Blocks Gallery',
  components: 'Components',
  core: 'Core',
  dashboard: 'Dashboard',
  ecommerce: 'E-commerce',
  fields: 'Fields',
  layout: 'Layout',
  plugins: 'Plugins',
  utilities: 'Utilities',
};

/** Best-effort label for an unknown group key. */
function fallbackLabel(key: string): string {
  return key
    .split('-')
    .map((s) => (s.length === 0 ? s : s[0].toUpperCase() + s.slice(1)))
    .join(' ');
}

/** "components-basic-button-group" → "components". */
function groupKey(category: string): string {
  return category.split('-')[0] || category;
}

/** "components-basic-button-group" → "basic / button-group". */
function subLabel(category: string): string {
  const parts = category.split('-');
  if (parts.length <= 1) return '';
  return parts.slice(1).join(' / ');
}

function buildGroups(entries: Example[]): Group[] {
  const map = new Map<string, Example[]>();
  for (const e of entries) {
    const k = groupKey(e.meta.category);
    const list = map.get(k) ?? [];
    list.push(e);
    map.set(k, list);
  }
  return Array.from(map.entries())
    .map(([key, list]) => ({
      key,
      label: GROUP_LABELS[key] ?? fallbackLabel(key),
      entries: list,
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

function matches(e: Example, q: string): boolean {
  if (!q) return true;
  const haystack = (
    e.id +
    ' ' +
    e.meta.title +
    ' ' +
    (e.meta.description ?? '') +
    ' ' +
    (e.meta.tags?.join(' ') ?? '')
  ).toLowerCase();
  return haystack.includes(q);
}

interface CardProps {
  entry: Example;
  onOpen: (e: Example) => void;
}

/**
 * One gallery card.
 *
 * The shell is deliberately NON-interactive and the click target is an overlay
 * sibling, never an ancestor of the thumbnail (objectui#3903). `SchemaThumbnail`
 * renders the example itself through a real `SchemaRenderer`, and 85 of the 423
 * catalog examples contain `"type": "button"` nodes — with a `button` shell those
 * cards shipped `button` inside `button`, which React classifies as a hydration
 * error (the HTML parser hoists the inner button out of the outer one, so the
 * server HTML and the client tree disagree) on top of being an accessibility
 * defect in its own right. A `div role="button"` shell would keep both problems;
 * an absolutely positioned overlay removes them without giving up a real,
 * natively focusable control.
 */
const GalleryCard = React.memo(function GalleryCard({
  entry,
  onOpen,
}: CardProps) {
  return (
    <div className="group relative flex flex-col gap-2 rounded-lg border border-fd-border bg-fd-card p-3 text-left transition hover:border-fd-primary hover:shadow-sm">
      <SchemaThumbnail schema={entry.schema as SchemaNode} />
      <div className="flex flex-col gap-0.5">
        <div className="line-clamp-1 text-sm font-medium text-fd-foreground">
          {entry.meta.title}
        </div>
        <code className="line-clamp-1 break-all text-[11px] text-fd-muted-foreground">
          {entry.id}
        </code>
      </div>
      {/*
        The card's only focusable node: it covers the whole card (`inset-0`
        resolves against the shell's padding box), so the focus ring still reads
        as "the card is focused", and its accessible name carries both labels the
        card shows — title and id — which keeps WCAG 2.5.3 (label in name)
        satisfied. The `button` role itself announces what activation does.
      */}
      <button
        type="button"
        onClick={() => onOpen(entry)}
        aria-label={`Open ${entry.meta.title} (${entry.id})`}
        className="absolute inset-0 cursor-pointer rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-fd-ring"
      />
    </div>
  );
});

interface DetailDialogProps {
  entry: Example;
  onClose: () => void;
}

function DetailDialog({ entry, onClose }: DetailDialogProps) {
  const [copied, setCopied] = useState<'id' | 'snippet' | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [onClose]);

  const snippet = `<SchemaExample id="${entry.id}" />`;

  const copy = async (text: string, kind: 'id' | 'snippet') => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(kind);
      setTimeout(() => setCopied((c) => (c === kind ? null : c)), 1200);
    } catch {
      // best-effort
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={entry.meta.title}
      className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-8"
    >
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
      />
      <div className="not-prose relative z-10 flex max-h-[90vh] w-full max-w-5xl flex-col overflow-hidden rounded-xl border border-fd-border bg-fd-background shadow-xl">
        <header className="flex items-start justify-between gap-4 border-b border-fd-border px-5 py-3">
          <div className="min-w-0 flex-1">
            <h3 className="truncate text-base font-semibold text-fd-foreground">
              {entry.meta.title}
            </h3>
            <code className="block truncate text-xs text-fd-muted-foreground">
              {entry.id}
            </code>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={() => copy(entry.id, 'id')}
              className="rounded border border-fd-border px-2 py-1 font-mono text-xs text-fd-muted-foreground hover:bg-fd-accent hover:text-fd-accent-foreground"
              title="Copy catalog id"
            >
              {copied === 'id' ? '✓ id' : 'copy id'}
            </button>
            <button
              type="button"
              onClick={() => copy(snippet, 'snippet')}
              className="rounded border border-fd-border px-2 py-1 font-mono text-xs text-fd-muted-foreground hover:bg-fd-accent hover:text-fd-accent-foreground"
              title="Copy MDX snippet"
            >
              {copied === 'snippet' ? '✓ snippet' : 'copy <SchemaExample>'}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="rounded border border-fd-border px-2 py-1 text-xs text-fd-muted-foreground hover:bg-fd-accent hover:text-fd-accent-foreground"
              aria-label="Close"
            >
              ✕
            </button>
          </div>
        </header>
        <div className="min-h-0 flex-1 overflow-auto p-5">
          <InteractiveDemo
            schema={entry.schema as SchemaNode}
            description={entry.meta.description}
          />
        </div>
      </div>
    </div>
  );
}

interface SidebarProps {
  groups: Group[];
  activeKey: string | null;
  onSelect: (key: string | null) => void;
  totalAll: number;
  totalFiltered: number;
  isFiltered: boolean;
}

function CategorySidebar({
  groups,
  activeKey,
  onSelect,
  totalAll,
  totalFiltered,
  isFiltered,
}: SidebarProps) {
  return (
    <nav
      aria-label="Schema categories"
      className="flex flex-col gap-1 text-sm"
    >
      <button
        type="button"
        onClick={() => onSelect(null)}
        className={
          'flex items-center justify-between rounded-md px-2 py-1.5 text-left transition ' +
          (activeKey === null
            ? 'bg-fd-accent text-fd-accent-foreground'
            : 'hover:bg-fd-accent/60')
        }
      >
        <span className="font-medium">All</span>
        <span className="text-xs text-fd-muted-foreground">
          {isFiltered ? `${totalFiltered}/${totalAll}` : totalAll}
        </span>
      </button>
      {groups.map((g) => (
        <button
          key={g.key}
          type="button"
          onClick={() => onSelect(g.key)}
          className={
            'flex items-center justify-between rounded-md px-2 py-1.5 text-left transition ' +
            (activeKey === g.key
              ? 'bg-fd-accent text-fd-accent-foreground'
              : 'hover:bg-fd-accent/60')
          }
        >
          <span>{g.label}</span>
          <span className="text-xs text-fd-muted-foreground">
            {g.entries.length}
          </span>
        </button>
      ))}
    </nav>
  );
}

/**
 * Visual gallery of every schema in `@object-ui/example-schema-catalog`.
 *
 * - Sticky category sidebar (top-level taxonomy).
 * - Searchable across id / title / description / tags.
 * - Lazy-mounted scaled thumbnails so 400+ previews stay performant.
 * - Click any card → modal with full-size interactive preview, JSON tab,
 *   and a one-click copy of the `<SchemaExample id="…">` snippet.
 */
export function SchemaCatalogIndex() {
  const all = useMemo(() => allExamples(), []);
  const [query, setQuery] = useState('');
  const [activeGroup, setActiveGroup] = useState<string | null>(null);
  const [openEntry, setOpenEntry] = useState<Example | null>(null);

  const q = query.trim().toLowerCase();

  const filtered = useMemo(
    () => (q ? all.filter((e) => matches(e, q)) : all),
    [all, q],
  );

  const allGroups = useMemo(() => buildGroups(all), [all]);
  const filteredGroups = useMemo(() => buildGroups(filtered), [filtered]);

  const visibleGroups = useMemo(() => {
    if (activeGroup === null) return filteredGroups;
    return filteredGroups.filter((g) => g.key === activeGroup);
  }, [filteredGroups, activeGroup]);

  const handleOpen = useCallback((e: Example) => setOpenEntry(e), []);
  const handleClose = useCallback(() => setOpenEntry(null), []);

  const totalVisible = visibleGroups.reduce(
    (acc, g) => acc + g.entries.length,
    0,
  );

  return (
    <div className="not-prose flex flex-col gap-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filter by id, title, description, tag…"
          className="w-full rounded-md border border-fd-border bg-fd-background px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-fd-ring sm:max-w-md"
          aria-label="Filter schema catalog"
        />
        <span className="text-xs text-fd-muted-foreground">
          {q
            ? `${totalVisible} match${totalVisible === 1 ? '' : 'es'}`
            : `${all.length} examples · ${allGroups.length} groups`}
        </span>
      </div>

      <div className="grid gap-4 md:grid-cols-[200px_1fr]">
        <aside className="md:sticky md:top-20 md:self-start">
          <CategorySidebar
            groups={allGroups}
            activeKey={activeGroup}
            onSelect={setActiveGroup}
            totalAll={all.length}
            totalFiltered={filtered.length}
            isFiltered={q.length > 0}
          />
        </aside>

        <div className="flex flex-col gap-6">
          {visibleGroups.length === 0 && (
            <div className="rounded-md border border-dashed border-fd-border p-6 text-center text-sm text-fd-muted-foreground">
              No examples match <code className="font-mono">{query}</code>.
            </div>
          )}
          {visibleGroups.map((g) => (
            <section
              key={g.key}
              id={`group-${g.key}`}
              className="flex flex-col gap-3"
            >
              <header className="flex items-baseline justify-between border-b border-fd-border pb-1">
                <h3 className="text-sm font-semibold text-fd-foreground">
                  {g.label}
                </h3>
                <span className="text-xs text-fd-muted-foreground">
                  {g.entries.length}
                </span>
              </header>
              <GroupGrid entries={g.entries} onOpen={handleOpen} />
            </section>
          ))}
        </div>
      </div>

      {openEntry && (
        <DetailDialog entry={openEntry} onClose={handleClose} />
      )}
    </div>
  );
}

interface GroupGridProps {
  entries: Example[];
  onOpen: (e: Example) => void;
}

/**
 * Sub-grouping: cards inside a top-level group are visually sub-grouped by
 * their full category slug so neighbours stay together.
 */
function GroupGrid({ entries, onOpen }: GroupGridProps) {
  const byCategory = useMemo(() => {
    const map = new Map<string, Example[]>();
    for (const e of entries) {
      const list = map.get(e.meta.category) ?? [];
      list.push(e);
      map.set(e.meta.category, list);
    }
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [entries]);

  return (
    <div className="flex flex-col gap-5">
      {byCategory.map(([category, items]) => {
        const sub = subLabel(category);
        return (
          <div key={category} className="flex flex-col gap-2">
            {sub && (
              <div className="text-xs font-medium uppercase tracking-wide text-fd-muted-foreground">
                {sub}
              </div>
            )}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {items.map((e) => (
                <GalleryCard key={e.id} entry={e} onOpen={onOpen} />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
