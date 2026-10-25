// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * AppNavCanvas — form-canvas-style editor for an App's top-level
 * navigation tree. Each nav entry becomes a 32 px card with a drag handle,
 * an inline-rename label, a kind chip and a remove control that is always
 * drawn; the metadata record it targets is the card's `title`, so the row
 * fits the Studio's 240 px rail (objectui#12519). Drag-drop reorders within
 * the root list.
 *
 * Kind and target are read from the spec's discriminated union — `type`
 * plus that branch's own target key — never inferred from off-spec keys
 * (objectui#3275).
 *
 * Nested children are rendered indented; cross-level moves and
 * adding child items are still handled by AppNavInspector (the
 * canvas keeps DnD focused on the root list to avoid surprising
 * cross-tree reorders).
 *
 * A nav item's `label` is `I18nLabel`: a plain string or an inline locale
 * map. The card shows it resolved in the designer locale through the spec's
 * `resolveI18nLabel`, and an inline rename of a map edits the designer
 * locale's entry only, never the whole map (objectui#11128). Both halves
 * live in `./navItemLabel.ts`, which the Studio's nav-item inspector imports
 * too, so the two editors of one label cannot disagree (objectui#11148).
 *
 * An entry with NO label shows the text it inherits (objectui#11196): the
 * runtime's rule, asked of the console's own target resolver, so the card
 * names the entry as the console's sidebar does. The inline rename shows that
 * text as the input's PLACEHOLDER, never as its value: an untouched entry
 * stays label-less, and only typing writes an author label.
 *
 * Selection IDs match AppNavInspector:
 *   { kind: 'nav', id: `${rootKey}[${i}]` }
 *   { kind: 'nav', id: `${rootKey}[${i}].children[${j}]` }
 */

import * as React from 'react';
import { GripVertical, Plus, Trash2 } from 'lucide-react';
import type { I18nLabel } from '@objectstack/spec/ui';
import { Badge, cn } from '@object-ui/components';
import type { NavTargetLabelResolver } from '@object-ui/layout';
import { useNavTargetLabel } from '../../../hooks/useNavTargetLabel.js';
import { appendArray, moveArray, spliceArray } from '../inspectors/_shared.js';
import { t, tFormat, useMetadataLocale } from '../i18n.js';
import { navEntryLabelText, navItemLabelText, renamedLabel } from './navItemLabel.js';

const DND_MIME = 'text/x-objectui-nav';

interface RawNav {
  id?: string;
  type?: string;
  label?: I18nLabel;
  objectName?: string;
  pageName?: string;
  dashboardName?: string;
  reportName?: string;
  url?: string;
  componentRef?: string;
  book?: string;
  doc?: string;
  actionDef?: { actionName?: string };
  children?: RawNav[];
  [k: string]: unknown;
}

/**
 * The nav item's kind IS its `type` discriminator (objectui#3275).
 *
 * This used to infer one from `it.object` / `it.dashboard` / a
 * `path ?? href ?? route ?? url` chain and fall back to `'item'`. Since
 * every branch of `AppSchema.navigation` is `.strict()`, none of those
 * keys can appear on a saveable draft — so the inference only ever fired
 * for metadata the spec rejects, and a spec-VALID app had every entry
 * badged the meaningless `item`. Reading `type` is both simpler and the
 * only reading that can be right.
 */
function navKind(it: RawNav): string {
  return typeof it.type === 'string' && it.type ? it.type : 'untyped';
}

/**
 * Per-kind color tone — keeps nav kinds scannable at a glance and
 * mirrors the field-type category tinting used elsewhere in Studio.
 * Class strings are written out in full so Tailwind's JIT emits them.
 */
interface KindTone {
  badge: string;
}

const KIND_TONE: Record<string, KindTone> = {
  object: {
    badge: 'border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-900 dark:bg-blue-950/40 dark:text-blue-300',
  },
  page: {
    badge: 'border-violet-200 bg-violet-50 text-violet-700 dark:border-violet-900 dark:bg-violet-950/40 dark:text-violet-300',
  },
  dashboard: {
    badge: 'border-teal-200 bg-teal-50 text-teal-700 dark:border-teal-900 dark:bg-teal-950/40 dark:text-teal-300',
  },
  report: {
    badge: 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300',
  },
  url: {
    badge: 'border-indigo-200 bg-indigo-50 text-indigo-700 dark:border-indigo-900 dark:bg-indigo-950/40 dark:text-indigo-300',
  },
  group: {
    badge: 'border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-800 dark:bg-slate-900/40 dark:text-slate-300',
  },
  action: {
    badge: 'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300',
  },
  component: {
    badge: 'border-cyan-200 bg-cyan-50 text-cyan-700 dark:border-cyan-900 dark:bg-cyan-950/40 dark:text-cyan-300',
  },
  /**
   * A documentation entry (objectui#11197). Without its own tone a spec-valid
   * `doc` entry fell to `untyped`'s amber — the "AppSchema will reject this"
   * warning — below.
   */
  doc: {
    badge: 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300',
  },
  separator: {
    badge: 'border-zinc-200 bg-zinc-50 text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900/40 dark:text-zinc-400',
  },
  /**
   * No `type` at all. Amber, not a neutral zinc: an untyped entry is not a
   * benign "generic item", it is a draft `AppSchema` will reject for a
   * missing discriminator, and the badge should read that way.
   */
  untyped: {
    badge: 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300',
  },
};

/**
 * A nested entry's indent, 16 px a level (objectui#12519: classes, not an
 * inline style). The spec nests one level under a `group`; deeper trees take
 * the last step.
 */
const DEPTH_INDENT = ['', 'pl-4', 'pl-8'] as const;

function kindTone(kind: string): KindTone {
  return KIND_TONE[kind] ?? KIND_TONE.untyped;
}

/**
 * The text a card shows for its entry, in the designer `locale`.
 *
 * `label` only — `title` / `name` / `path` are not nav-item keys. The label is
 * `I18nLabel`, so a locale map resolves through the spec's own resolver
 * (`navItemLabelText`, shared with the Studio's nav-item inspector), never a
 * `typeof === 'string'` test that reads a map as no label (objectui#11128).
 * An ABSENT label shows the inherited text (`navEntryLabelText`, the runtime's
 * rule — objectui#11196). The positional `engine.appNav.item` row is left for
 * what that rule cannot name: a separator, a label that is present but
 * resolves to nothing, and an entry with no target and no `id`.
 *
 * objectui#11862 — and for an entry with no label that names no target yet
 * (*Add nav item* not bound, or an unbind): the rule's last rung would name it
 * by the `nav_item_N` id this canvas minted, so the card reads the positional
 * wording instead, as the Studio's nav rail does. "Names no target" is the
 * save's own rule ({@link namesNoTarget}). Display only: the id is minted as
 * before and no label is written.
 */
function navLabel(it: RawNav, i: number, locale: string, targetLabel: NavTargetLabelResolver): string {
  if (it.label === undefined && namesNoTarget(it)) return tFormat('engine.appNav.item', locale, { n: i + 1 });
  const l = navEntryLabelText(it, locale, targetLabel).trim();
  if (l) return l;
  return tFormat('engine.appNav.item', locale, { n: i + 1 });
}

/**
 * Where each target-bearing branch of the spec's `NavigationItemSchema` names
 * its target: the branch's own key, or keys in the order they are read.
 * `group` and `separator` declare none — they open nothing, so neither is
 * ever unbound. One table, two readers: what a card shows (`navTarget`) and
 * what a save leaves out (`navPayloadOf`), so the two cannot disagree about
 * which key is the target.
 */
const NAV_TARGET_READS = new Map<string, ReadonlyArray<(it: RawNav) => unknown>>([
  ['object', [(it) => it.objectName]],
  ['page', [(it) => it.pageName]],
  ['dashboard', [(it) => it.dashboardName]],
  ['report', [(it) => it.reportName]],
  ['url', [(it) => it.url]],
  ['component', [(it) => it.componentRef]],
  ['action', [(it) => it.actionDef?.actionName]],
  // The page it opens, else the book (objectui#11197).
  ['doc', [(it) => it.doc, (it) => it.book]],
]);

/**
 * The metadata record this entry names, read from the key its own branch
 * declares. Replaces a `path ?? href ?? route ?? url` chain in which only
 * `url` was ever a real key — and only on `type: 'url'`.
 */
function navTarget(it: RawNav): string | undefined {
  const reads = typeof it.type === 'string' ? NAV_TARGET_READS.get(it.type) : undefined;
  for (const read of reads ?? []) {
    const v = read(it);
    if (typeof v === 'string' && v) return v;
  }
  return undefined;
}

/**
 * Whether a save leaves this entry out (objectui#11776): it has no `type` (the
 * placeholder an unbind leaves behind), or its `type` is a target-bearing
 * branch and none of that branch's target keys holds a string — the entry the
 * spec refuses for want of a target ("navigation.N.objectName — expected
 * string, received undefined"). A key that holds a string is a target the
 * spec takes, so the save sends it and the server judges it.
 */
function namesNoTarget(it: RawNav): boolean {
  if (typeof it.type !== 'string') return true;
  const reads = NAV_TARGET_READS.get(it.type);
  return !!reads && !reads.some((read) => typeof read(it) === 'string');
}

/**
 * The navigation a save sends (objectui#11776): the editor's entries, in their
 * order, less every entry that names no target for its `type`, at every depth.
 * A `group` is kept whatever its children are.
 *
 * *Add nav item* births an entry before its target is picked, and the editor
 * keeps showing it so that it can be bound where it was added; only what is
 * sent leaves it out. An entry that is kept, and a `children` list that loses
 * nothing, is returned as the same object, so a caller can tell by reference
 * whether anything was left out.
 *
 * Exported for the Studio nav save (`StudioDesignSurface`'s `doNavSave`) and
 * its pins: it lives here so that it reads the card's own target table. It is
 * a pure function, not a component, and it never reaches the package entry
 * (`index.ts` re-exports a named list, and `package.json` exports only `.`).
 */
// eslint-disable-next-line react-refresh/only-export-components -- see above
export function navPayloadOf(entries: readonly unknown[]): Array<Record<string, unknown>> {
  const sent: Array<Record<string, unknown>> = [];
  for (const entry of entries) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
    const it = entry as RawNav;
    if (namesNoTarget(it)) continue;
    const kids = it.children;
    if (!Array.isArray(kids)) {
      sent.push(it);
      continue;
    }
    const children = navPayloadOf(kids);
    const kept = children.length === kids.length && children.every((c, i) => c === kids[i]);
    sent.push(kept ? it : { ...it, children });
  }
  return sent;
}

export interface AppNavCanvasProps {
  draft: Record<string, unknown>;
  rootKey: string;
  onPatch?: (patch: Record<string, unknown>) => void;
  selection: { kind: string; id: string } | null;
  onSelectionChange?: (sel: { kind: string; id: string; label?: string } | null) => void;
}

export function AppNavCanvas({
  draft,
  rootKey,
  onPatch,
  selection,
  onSelectionChange,
}: AppNavCanvasProps) {
  const locale = useMetadataLocale();
  const targetLabel = useNavTargetLabel();
  const items: RawNav[] = React.useMemo(() => {
    const v = (draft as any)[rootKey];
    return Array.isArray(v) ? (v as RawNav[]) : [];
  }, [draft, rootKey]);

  const selectedId = selection && selection.kind === 'nav' ? selection.id : null;
  const [dragIndex, setDragIndex] = React.useState<number | null>(null);

  const setItems = React.useCallback(
    (next: RawNav[]) => {
      if (!onPatch) return;
      onPatch({ [rootKey]: next });
    },
    [onPatch, rootKey],
  );

  const addItem = React.useCallback(() => {
    if (!onPatch) return;
    // Spec invariants from birth (#2245): a snake_case `id` and a `type`
    // (object is the 80% case per the app-composition guide) — never the
    // old `{label, path:''}` placeholder that failed save validation. The
    // item completes once the inspector's object picker fills `objectName`,
    // or once the inspector changes its type and picks that type's target
    // (the Studio's nav editor offers every type the spec declares,
    // objectui#11790).
    //
    // Born with NO `label` (objectui#11196). An absent label inherits, so the
    // card shows the entry's `id` until a target is bound and then that
    // target's current label, as the console draws it. It used to be born
    // with a localized "New item" label: a placeholder STORED as the author's
    // label, which a present label renders verbatim, so an entry bound to an
    // object kept saying "New item" wherever the pickers did not recognise the
    // sentinel. A producer does not write a placeholder as a label.
    const taken = new Set(items.map((it) => (typeof it.id === 'string' ? it.id : '')).filter(Boolean));
    let navId = `nav_item_${items.length + 1}`;
    for (let n = items.length + 2; taken.has(navId); n++) navId = `nav_item_${n}`;
    const newItem: RawNav = { id: navId, type: 'object' };
    const next = appendArray(items, newItem);
    setItems(next);
    onSelectionChange?.({
      kind: 'nav',
      id: `${rootKey}[${next.length - 1}]`,
      label: navLabel(newItem, next.length - 1, locale, targetLabel),
    });
  }, [onPatch, items, setItems, rootKey, onSelectionChange, locale, targetLabel]);

  const removeItem = React.useCallback(
    (index: number) => {
      if (!onPatch) return;
      const next = spliceArray(items, index, null);
      setItems(next);
      if (selectedId === `${rootKey}[${index}]`) onSelectionChange?.(null);
    },
    [onPatch, items, setItems, rootKey, selectedId, onSelectionChange],
  );

  const renameItem = React.useCallback(
    (index: number, nextLabel: string) => {
      if (!onPatch) return;
      const cur = items[index] ?? {};
      const updated = { ...cur, label: renamedLabel(cur.label, nextLabel, locale) };
      const next = spliceArray(items, index, updated);
      setItems(next);
      if (selectedId === `${rootKey}[${index}]`) {
        onSelectionChange?.({ kind: 'nav', id: `${rootKey}[${index}]`, label: nextLabel });
      }
    },
    [onPatch, items, setItems, rootKey, selectedId, onSelectionChange, locale],
  );

  const moveItem = React.useCallback(
    (from: number, before: number) => {
      if (!onPatch) return;
      let to = before;
      if (from < before) to = before - 1;
      if (to === from) return;
      const next = moveArray(items, from, to);
      setItems(next);
      onSelectionChange?.({
        kind: 'nav',
        id: `${rootKey}[${to}]`,
        label: navLabel(next[to] ?? {}, to, locale, targetLabel),
      });
    },
    [onPatch, items, setItems, rootKey, onSelectionChange, locale, targetLabel],
  );

  return (
    <div className="rounded-md border bg-card/40">
      {/* objectui#12519 — in the Studio's 240 px rail the add button takes a
          line of its own rather than folding its words. */}
      <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1.5 border-b px-3 py-2">
        <div className="flex items-center gap-2 text-xs">
          <span className="font-medium uppercase tracking-wide text-muted-foreground">
            {t('engine.appNav.heading', locale)}
          </span>
          <Badge variant="outline" className="text-[10px]">
            {items.length} {items.length === 1 ? t('engine.appNav.itemOne', locale) : t('engine.appNav.itemOther', locale)}
          </Badge>
        </div>
        {onPatch && (
          <button
            type="button"
            className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded border border-dashed px-2 py-1 text-[11px] text-muted-foreground hover:bg-muted/30 hover:text-foreground"
            onClick={addItem}
          >
            <Plus className="h-3 w-3" /> {t('engine.appNav.addItem', locale)}
          </button>
        )}
      </div>
      <div
        className="space-y-1.5 p-2"
        onDragOver={(e) => {
          if (!onPatch) return;
          if (!e.dataTransfer.types.includes(DND_MIME)) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = 'move';
        }}
        onDrop={(e) => {
          if (!onPatch) return;
          if (!e.dataTransfer.types.includes(DND_MIME)) return;
          e.preventDefault();
          if (dragIndex == null) return;
          moveItem(dragIndex, items.length);
          setDragIndex(null);
        }}
      >
        {items.length === 0 ? (
          <div className="rounded border border-dashed px-3 py-4 text-center text-[11px] text-muted-foreground">
            {onPatch
              ? t('engine.appNav.empty', locale)
              : t('engine.appNav.emptyReadonly', locale)}
          </div>
        ) : (
          items.map((it, i) => (
            <NavCardTree
              key={i}
              item={it}
              index={i}
              depth={0}
              path={`${rootKey}[${i}]`}
              locale={locale}
              targetLabel={targetLabel}
              selectedId={selectedId}
              canEdit={!!onPatch}
              onClick={(p, lbl) => onSelectionChange?.({ kind: 'nav', id: p, label: lbl })}
              onRename={(lbl) => renameItem(i, lbl)}
              onRemove={() => removeItem(i)}
              onDragStart={() => setDragIndex(i)}
              onDragEnd={() => setDragIndex(null)}
              onDropBefore={() => {
                if (dragIndex == null) return;
                moveItem(dragIndex, i);
                setDragIndex(null);
              }}
            />
          ))
        )}
      </div>
    </div>
  );
}

function NavCardTree({
  item,
  index,
  depth,
  path,
  locale,
  targetLabel,
  selectedId,
  canEdit,
  onClick,
  onRename,
  onRemove,
  onDragStart,
  onDragEnd,
  onDropBefore,
}: {
  item: RawNav;
  index: number;
  depth: number;
  path: string;
  locale: string;
  targetLabel: NavTargetLabelResolver;
  selectedId: string | null;
  canEdit: boolean;
  onClick: (path: string, label: string) => void;
  onRename: (label: string) => void;
  onRemove: () => void;
  onDragStart: () => void;
  onDragEnd: () => void;
  onDropBefore: () => void;
}) {
  return (
    <>
      <NavCard
        item={item}
        index={index}
        depth={depth}
        path={path}
        locale={locale}
        targetLabel={targetLabel}
        isSelected={selectedId === path}
        canEdit={canEdit && depth === 0}
        onClick={() => onClick(path, navLabel(item, index, locale, targetLabel))}
        onRename={onRename}
        onRemove={onRemove}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        onDropBefore={onDropBefore}
      />
      {Array.isArray(item.children) &&
        item.children.map((c, j) => {
          const childPath = `${path}.children[${j}]`;
          return (
            <NavCardTree
              key={j}
              item={c}
              index={j}
              depth={depth + 1}
              path={childPath}
              locale={locale}
              targetLabel={targetLabel}
              selectedId={selectedId}
              canEdit={canEdit}
              onClick={onClick}
              onRename={() => undefined}
              onRemove={() => undefined}
              onDragStart={() => undefined}
              onDragEnd={() => undefined}
              onDropBefore={() => undefined}
            />
          );
        })}
    </>
  );
}

function NavCard({
  item,
  index,
  depth,
  path,
  locale,
  targetLabel,
  isSelected,
  canEdit,
  onClick,
  onRename,
  onRemove,
  onDragStart,
  onDragEnd,
  onDropBefore,
}: {
  item: RawNav;
  index: number;
  depth: number;
  path: string;
  locale: string;
  targetLabel: NavTargetLabelResolver;
  isSelected: boolean;
  canEdit: boolean;
  onClick: () => void;
  onRename: (label: string) => void;
  onRemove: () => void;
  onDragStart: () => void;
  onDragEnd: () => void;
  onDropBefore: () => void;
}) {
  const kind = navKind(item);
  const tone = kindTone(kind);
  const target = navTarget(item);
  const label = navLabel(item, index, locale, targetLabel);
  // The rename edits the AUTHORED label: `''` for an entry that has none, whose
  // inherited text (the card's `label`) is the input's placeholder instead.
  const authored = navItemLabelText(item.label, locale).trim();
  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState(authored);
  const [dropPos, setDropPos] = React.useState<'before' | null>(null);

  React.useEffect(() => {
    if (!editing) setDraft(authored);
  }, [authored, editing]);

  return (
    <div className={cn('relative', DEPTH_INDENT[Math.min(depth, DEPTH_INDENT.length - 1)])}>
      {dropPos === 'before' && (
        <div className="pointer-events-none absolute inset-x-0 -top-0.5 h-0.5 rounded bg-primary" />
      )}
      <button
        type="button"
        draggable={canEdit && !editing}
        onDragStart={(e) => {
          if (!canEdit) return;
          e.dataTransfer.effectAllowed = 'move';
          e.dataTransfer.setData(DND_MIME, path);
          onDragStart();
        }}
        onDragEnd={onDragEnd}
        onDragOver={(e) => {
          if (!canEdit) return;
          if (!e.dataTransfer.types.includes(DND_MIME)) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = 'move';
          setDropPos('before');
        }}
        onDragLeave={() => setDropPos(null)}
        onDrop={(e) => {
          if (!canEdit) return;
          if (!e.dataTransfer.types.includes(DND_MIME)) return;
          e.preventDefault();
          e.stopPropagation();
          setDropPos(null);
          onDropBefore();
        }}
        onClick={onClick}
        aria-pressed={isSelected}
        // objectui#12519 — the api name lives here, not in the row: the row
        // keeps the handle, the label, the kind chip and the trash, which fit
        // the Studio's 240 px rail.
        title={target ? `${label} · ${target}` : label}
        className={`group flex h-8 w-full items-center gap-1.5 rounded-md border bg-card px-1.5 text-left text-xs transition-colors hover:border-primary/40 ${
          isSelected ? 'border-primary ring-1 ring-primary' : 'border-border'
        } ${canEdit && !editing ? 'cursor-grab active:cursor-grabbing' : ''}`}
      >
        {canEdit ? (
          <GripVertical className="h-4 w-4 shrink-0 text-muted-foreground/50 group-hover:text-muted-foreground" />
        ) : (
          <span className="w-4 shrink-0" />
        )}
        {editing ? (
          <input
            autoFocus
            value={draft}
            placeholder={label}
            onChange={(e) => setDraft(e.target.value)}
            onClick={(e) => e.stopPropagation()}
            onBlur={() => {
              setEditing(false);
              const v = draft.trim();
              if (v && v !== authored) onRename(v);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                (e.target as HTMLInputElement).blur();
              } else if (e.key === 'Escape') {
                e.preventDefault();
                setDraft(authored);
                setEditing(false);
              }
            }}
            className="flex-1 min-w-0 rounded border border-input bg-background px-1.5 py-0.5 text-xs outline-none focus:border-primary"
          />
        ) : (
          <span
            className="flex-1 min-w-0 truncate font-medium"
            onDoubleClick={(e) => {
              // A separator declares no `label` (the spec's separator member is
              // `type` / `id` / `order`), so it has none to rename: a label
              // written here is refused at save (objectui#11790, which lets the
              // Studio's nav editor make separators).
              if (!canEdit || kind === 'separator') return;
              e.stopPropagation();
              setEditing(true);
            }}
          >
            {label}
          </span>
        )}
        <Badge variant="outline" className={cn('h-5 shrink-0 px-1.5 py-0 text-[10px] font-medium', tone.badge)}>
          {kind}
        </Badge>
        {/* objectui#11776 — always in the tab order (it was mounted only while
            a mouse hovered the card, so no keyboard path could reach it).
            objectui#12519 — and always drawn: a fixed 24 px at reduced
            opacity, full on the card's hover, the card's keyboard focus or
            its own, so showing it never moves the label. */}
        {canEdit && !editing && (
          <span
            role="button"
            tabIndex={0}
            onClick={(e) => {
              e.stopPropagation();
              onRemove();
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                e.stopPropagation();
                onRemove();
              }
            }}
            className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded text-muted-foreground opacity-50 transition-opacity hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100 group-focus-visible:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            aria-label={t('engine.appNav.removeItem', locale)}
          >
            <Trash2 className="h-3 w-3" />
          </span>
        )}
      </button>
    </div>
  );
}
