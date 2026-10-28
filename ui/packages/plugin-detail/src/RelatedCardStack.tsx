/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import * as React from 'react';
import { Badge, RelatedCountStore, cn, useRelatedCount } from '@object-ui/components';
import { SchemaRenderer, toRenderableSchema, useRecordContext } from '@object-ui/react';
import { ChevronRight } from 'lucide-react';
import { RELATED_CARD_DROP_LINE, RelatedCardChromeContext, type RelatedCardChrome } from './relatedListCompact';
import { RelatedCardMenu } from './RelatedCardMenu';
import { relatedCardId, type RelatedArrangement, type RelatedCardId } from './synth/relatedArrangement';
import { useRelatedArrangement } from './useRelatedArrangement';
import { useDetailTranslation } from './useDetailTranslation';

export interface RelatedCardStackProps {
  /**
   * The related-column nodes in the page's (default) order. A
   * `record:related_list` carrying `objectName` + `relationshipField` is an
   * arrangeable card; any other node draws after the cards, unarranged.
   */
  nodes: any[];
  /** The reader's stored arrangement (the host's workspace preference). */
  arrangement?: RelatedArrangement;
  /**
   * Keep a new arrangement. Absent: the stack keeps the reader's choices for
   * this view only (a host without a preference store).
   */
  onArrangementChange?: (next: RelatedArrangement) => void;
  /** Enlarge a card's list in place — the host's `?related=` (Target 9). */
  onEnlarge?: (id: RelatedCardId) => void;
}

type PageNode = Record<string, any>;

const propsOf = (node: PageNode): PageNode =>
  node && typeof node.properties === 'object' && node.properties ? { ...node, ...node.properties } : node;

/** The relationship id of a related-list node, or `null` for a node that is not one. */
function cardIdOf(node: unknown): RelatedCardId | null {
  if (!node || typeof node !== 'object') return null;
  const p = propsOf(node as PageNode);
  if (p.type !== 'record:related_list') return null;
  if (typeof p.objectName !== 'string' || typeof p.relationshipField !== 'string') return null;
  return relatedCardId(p.objectName, p.relationshipField);
}

/**
 * A collapsed card: its title and its count, nothing else (objectstack#27055,
 * Target 7: 「a collapsed card fetches no rows」). The count comes from the
 * shared count store, the same one-row `$count` probe the tab strip's badges
 * ask, so the card reads no rows.
 */
export const CollapsedRelatedCard: React.FC<{ node: PageNode; chrome: RelatedCardChrome; onExpand: () => void }> = ({
  node,
  chrome,
  onExpand,
}) => {
  const p = propsOf(node);
  const ctx = useRecordContext();
  const parentId = ctx?.recordId ?? undefined;
  const dataSource = ctx?.dataSource as any;
  const count = useRelatedCount(p.objectName, p.relationshipField, parentId, p.filter);
  React.useEffect(() => {
    if (!dataSource || !parentId || typeof dataSource.find !== 'function') return;
    void RelatedCountStore.fetch(
      (object: string, query: any) => dataSource.find(object, query),
      p.objectName,
      p.relationshipField,
      parentId,
      p.filter,
    ).catch(() => 0);
  }, [dataSource, parentId, p.objectName, p.relationshipField, p.filter]);
  const title = typeof p.title === 'string' && p.title ? p.title : p.objectName;
  return (
    <section
      className={cn('rounded-[10px] border border-border bg-card', RELATED_CARD_DROP_LINE)}
      data-related-card=""
      data-related-card-id={chrome.id}
      data-related-card-collapsed=""
      aria-label={title}
    >
      <div
        className={cn(
          'flex h-9 items-center gap-1.5 px-3 text-[12.5px] font-semibold',
          chrome.dragHandleProps?.draggable && 'cursor-grab active:cursor-grabbing',
        )}
        {...(chrome.dragHandleProps ?? {})}
      >
        <button
          type="button"
          className="flex min-w-0 items-center gap-1 rounded-sm text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-expanded={false}
          onClick={onExpand}
        >
          <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
          <span className="truncate">{title}</span>
        </button>
        {chrome.fresh && <FreshBadge />}
        {count !== undefined && (
          <span className="inline-flex h-5 shrink-0 items-center rounded bg-muted px-1.5 text-[11.5px] font-normal" data-related-card-count="">
            {count}
          </span>
        )}
        <span className="ml-auto flex shrink-0 items-center">
          <RelatedCardMenu chrome={chrome} title={title} collapsed onExpand={onExpand} />
        </span>
      </div>
    </section>
  );
};

const FreshBadge: React.FC = () => {
  const { t } = useDetailTranslation();
  return (
    <Badge className="h-4 shrink-0 px-1 text-[10px] font-normal" data-related-card-new="">
      {t('detail.relatedCardNew', { defaultValue: 'New' })}
    </Badge>
  );
};

/**
 * The related column's cards in the reader's arrangement (objectstack#27055,
 * Targets 4, 7 and 10).
 *
 * Each `record:related_list` is a card the reader arranges: on desktop its
 * title row is a drag handle (a drop line marks where it lands); its `⋯`
 * menu is the keyboard path — 上移 / 下移 / 折叠 / 隐藏; a collapsed card is
 * its title and count and reads no rows. The order, collapsed and hidden
 * state are the reader's (the host's workspace preference), laid over the
 * default order by `resolveRelatedArrangement`; the column says when the
 * default changed under a dragged order (「默认顺序已更新 · 恢复默认」) and how
 * many cards are hidden (「已隐藏 N 张 · 显示」).
 *
 * ⛔ No wrapper element per card: the lists stay DOM siblings, so the
 * empty-list fold (`RelatedListEmptyFold`, which reads its stack off the
 * shared parent) keeps working; the chrome reaches each card through
 * `RelatedCardChromeContext` and the drop line is an overlay.
 */
export const RelatedCardStack: React.FC<RelatedCardStackProps> = ({
  nodes,
  arrangement,
  onArrangementChange,
  onEnlarge,
}) => {
  const { t } = useDetailTranslation();
  const cards = new Map<RelatedCardId, PageNode>();
  const rest: unknown[] = [];
  for (const node of nodes) {
    const id = cardIdOf(node);
    if (id && !cards.has(id)) cards.set(id, node as PageNode);
    else rest.push(node);
  }
  const [dragId, setDragId] = React.useState<RelatedCardId | null>(null);
  const [drop, setDrop] = React.useState<{ index: number } | null>(null);
  const endDrag = () => {
    setDragId(null);
    setDrop(null);
  };
  const { resolved, edit, chromeOf } = useRelatedArrangement({
    defaultOrder: Array.from(cards.keys()),
    arrangement,
    onArrangementChange,
    onEnlarge,
    draggable: true,
    onDragStart: setDragId,
    onDragEnd: endDrag,
  });

  // ── Drag (desktop) ────────────────────────────────────────────────────
  const anchorRef = React.useRef<HTMLSpanElement>(null);
  const cardElements = (): HTMLElement[] => {
    const parent = anchorRef.current?.parentElement;
    if (!parent) return [];
    return Array.from(parent.querySelectorAll<HTMLElement>('[data-related-card-id]')).filter(
      (el) => el.getBoundingClientRect().height > 0,
    );
  };
  const onDragOver = (event: React.DragEvent) => {
    if (!dragId) return;
    event.preventDefault();
    const els = cardElements();
    let index = els.length;
    for (let i = 0; i < els.length; i += 1) {
      const rect = els[i].getBoundingClientRect();
      if (event.clientY < rect.top + rect.height / 2) {
        index = i;
        break;
      }
    }
    setDrop((prev) => (prev && prev.index === index ? prev : { index }));
  };
  // The drop line: the card the dragged one would land before carries
  // `data-related-drop="before"` (the last card `after` for the column's end),
  // which its own utility classes draw as a primary line — no inline style.
  React.useEffect(() => {
    const els = cardElements();
    for (const el of els) delete el.dataset.relatedDrop;
    if (!drop || !dragId || els.length === 0) return;
    if (drop.index < els.length) els[drop.index].dataset.relatedDrop = 'before';
    else els[els.length - 1].dataset.relatedDrop = 'after';
  });
  const onDrop = (event: React.DragEvent) => {
    if (!dragId || !drop) return endDrag();
    event.preventDefault();
    const from = resolved.order.indexOf(dragId);
    const to = from >= 0 && from < drop.index ? drop.index - 1 : drop.index;
    if (to !== from) edit({ kind: 'move', id: dragId, to });
    endDrag();
  };

  return (
    <>
      {/* The stack's anchor: no box of its own; it names the column the drag
          reads and listens on it (the column's own handlers would need the
          column's code). */}
      <span ref={anchorRef} hidden data-related-card-stack="" />
      <DragListener parentOf={anchorRef} onDragOver={onDragOver} onDrop={onDrop} onLeave={() => setDrop(null)} />
      {resolved.defaultChanged && <RelatedDefaultChangedHint onRestore={() => edit({ kind: 'restore-default-order' })} />}
      {resolved.order.map((id, index) => {
        const node = cards.get(id)!;
        const chrome = chromeOf(id, index);
        return resolved.collapsed.has(id) ? (
          <CollapsedRelatedCard
            key={id}
            node={node}
            chrome={chrome}
            onExpand={() => edit({ kind: 'collapse', id, collapsed: false })}
          />
        ) : (
          <RelatedCardChromeContext.Provider key={id} value={chrome}>
            <SchemaRenderer schema={toRenderableSchema(node)} />
          </RelatedCardChromeContext.Provider>
        );
      })}
      {rest.map((node, index) => (
        <SchemaRenderer key={`rest-${index}`} schema={toRenderableSchema(node)} />
      ))}
      {resolved.hidden.length > 0 && (
        <RelatedHiddenLine count={resolved.hidden.length} onShow={() => edit({ kind: 'show-hidden' })} />
      )}
    </>
  );
};

const LINE_BUTTON =
  'rounded-sm font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

/** 「默认顺序已更新 · 恢复默认」 — the reader's order was laid over an older default (rule 5). */
export const RelatedDefaultChangedHint: React.FC<{ onRestore: () => void }> = ({ onRestore }) => {
  const { t } = useDetailTranslation();
  return (
    <p className="text-xs text-muted-foreground" data-related-default-changed="">
      {t('detail.relatedDefaultChanged', { defaultValue: 'Default order updated' })}
      {' · '}
      <button type="button" className={LINE_BUTTON} onClick={onRestore}>
        {t('detail.relatedRestoreDefault', { defaultValue: 'Restore default' })}
      </button>
    </p>
  );
};

/** 「已隐藏 N 张 · 显示」 — the cards the reader hid, brought back together (rule 6). */
export const RelatedHiddenLine: React.FC<{ count: number; onShow: () => void }> = ({ count, onShow }) => {
  const { t } = useDetailTranslation();
  return (
    <p className="text-xs text-muted-foreground" data-related-hidden-line="">
      {t('detail.relatedHiddenCount', { count, defaultValue: '{{count}} hidden' })}
      {' · '}
      <button type="button" className={LINE_BUTTON} onClick={onShow}>
        {t('detail.relatedShowHidden', { defaultValue: 'Show' })}
      </button>
    </p>
  );
};

/**
 * Listens for the drag on the stack's column (the anchor's parent): the
 * cards are its children, so the column is where `dragover` / `drop` land.
 */
const DragListener: React.FC<{
  parentOf: React.RefObject<HTMLElement | null>;
  onDragOver: (event: React.DragEvent) => void;
  onDrop: (event: React.DragEvent) => void;
  onLeave: () => void;
}> = ({ parentOf, onDragOver, onDrop, onLeave }) => {
  const handlers = React.useRef({ onDragOver, onDrop, onLeave });
  handlers.current = { onDragOver, onDrop, onLeave };
  React.useEffect(() => {
    const parent = parentOf.current?.parentElement;
    if (!parent) return undefined;
    const over = (event: DragEvent) => handlers.current.onDragOver(event as unknown as React.DragEvent);
    const dropped = (event: DragEvent) => handlers.current.onDrop(event as unknown as React.DragEvent);
    const leave = (event: DragEvent) => {
      if (!parent.contains(event.relatedTarget as Node | null)) handlers.current.onLeave();
    };
    parent.addEventListener('dragover', over);
    parent.addEventListener('drop', dropped);
    parent.addEventListener('dragleave', leave);
    return () => {
      parent.removeEventListener('dragover', over);
      parent.removeEventListener('drop', dropped);
      parent.removeEventListener('dragleave', leave);
    };
  }, [parentOf]);
  return null;
};
