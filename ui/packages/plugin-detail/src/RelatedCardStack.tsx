/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import * as React from 'react';
import { Skeleton } from '@object-ui/components';
import type { FieldContainerLike } from '@object-ui/core';
import { SchemaRenderer, toRenderableSchema, useRecordContext } from '@object-ui/react';
import { RelatedCardChromeContext, RelatedCardCountContext, type RelatedCardChrome } from './relatedListCompact';
import { relatedCardId, type RelatedArrangement, type RelatedCardId } from './synth/relatedArrangement';
import { useRelatedArrangement } from './useRelatedArrangement';
import { useDetailTranslation } from './useDetailTranslation';
import { relatedCountTargetOf, useRelatedCounts, type RelatedCountTarget, type RelatedCounts } from './useRelatedCounts';

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
  /**
   * The child objects' field definitions the host already holds (its
   * metadata), so the up-front counts ask the relationship's arity without a
   * schema read first (`useRelatedCounts`). Absent: the counts read it.
   */
  fieldsOf?: (objectName: string) => FieldContainerLike;
  /**
   * The panels' counts when the host asks them itself — the record page,
   * whose tab row reads the same set (objectstack#27524, Target 8). Absent:
   * the stack counts the panels it shows.
   */
  counts?: RelatedCounts;
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
 * A card whose count is still out (objectstack#27056, Target 3): its title and
 * a placeholder where the count goes, the height of a folded card, so the
 * column holds its shape while the counts land and the details beside it are
 * already drawn.
 */
const PendingRelatedCard: React.FC<{ node: PageNode; chrome: RelatedCardChrome }> = ({ node, chrome }) => {
  const p = propsOf(node);
  const title = typeof p.title === 'string' && p.title ? p.title : p.objectName;
  return (
    <section
      className="rounded-[10px] border border-border bg-card"
      data-related-card=""
      data-related-card-id={chrome.id}
      data-related-card-pending=""
      aria-label={title}
      aria-busy="true"
    >
      <div className="flex h-9 items-center gap-1.5 px-3 text-[12.5px] font-semibold">
        <span className="truncate">{title}</span>
        <Skeleton className="h-4 w-6 shrink-0 rounded" />
      </div>
    </section>
  );
};

/**
 * The related column's panels in the reader's arrangement (objectstack#27055,
 * Targets 4, 7 and 10; objectstack#27524, Targets 1–3 and 10).
 *
 * Each `record:related_list` is a panel the reader arranges: on desktop its
 * ⠿ handle drags it (a drop line marks where it lands), and focused, ⌥↑ /
 * ⌥↓ move it; its `⋯` menu hides it. A panel never collapses — its header
 * opens its whole list. The order and the hidden set are the reader's (the
 * host's workspace preference), laid over the default order by
 * `resolveRelatedArrangement`; the column says when the default changed
 * under a dragged order (「默认顺序已更新 · 恢复默认」), and its foot says how
 * many panels are hidden (「已隐藏 N 张 · 显示」) and, once the reader has moved
 * or hidden any, offers 「恢复默认顺序」, which restores the order and the
 * hidden set (objectstack#27241). Panels at 0 rows fold into one line
 * (`RelatedListEmptyFold`'s panel line, 「还有 N 个空关联 · … · 展开」).
 *
 * The panels' counts are asked up front, together (objectstack#27056,
 * `useRelatedCounts`): until they answer each panel is a placeholder, then
 * its header draws from its count, a panel at 0 reads no rows, and a panel
 * above 0 reads its first rows once it is in view (`RelatedList`'s compact
 * face).
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
  fieldsOf,
  counts: hostCounts,
}) => {
  const { t } = useDetailTranslation();
  const ctx = useRecordContext();
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
  // The panels the reader sees are counted in one set; a hidden panel is not
  // drawn, so not asked. A host that counts them itself asks nothing here.
  const countTargets: RelatedCountTarget[] = [];
  if (!hostCounts) {
    for (const id of resolved.order) {
      const target = relatedCountTargetOf(cards.get(id));
      if (target) countTargets.push(target);
    }
  }
  const ownCounts = useRelatedCounts(countTargets, { parentId: ctx?.recordId, dataSource: ctx?.dataSource, fieldsOf });
  const counts = hostCounts ?? ownCounts;

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
        const state = counts.stateOf(id);
        if (state.kind === 'pending') return <PendingRelatedCard key={id} node={node} chrome={chrome} />;
        const count = state.kind === 'counted' ? state.count : null;
        return (
          <RelatedCardChromeContext.Provider key={id} value={chrome}>
            <RelatedCardCountContext.Provider value={count}>
              <SchemaRenderer schema={toRenderableSchema(node as any)} />
            </RelatedCardCountContext.Provider>
          </RelatedCardChromeContext.Provider>
        );
      })}
      {rest.map((node, index) => (
        <SchemaRenderer key={`rest-${index}`} schema={toRenderableSchema(node as any)} />
      ))}
      <RelatedFootLine
        hiddenCount={resolved.hidden.length}
        onShowHidden={() => edit({ kind: 'show-hidden' })}
        rearranged={resolved.rearranged}
        onRestoreDefault={() => edit({ kind: 'restore-default-arrangement' })}
      />
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

/**
 * The related column's foot line (objectstack#27055 rule 6, objectstack#27241):
 * 「已隐藏 N 张 · 显示」 — the cards the reader hid, brought back together — and,
 * on the same line, 「恢复默认顺序」 whenever the column is not the default one
 * (the reader moved or hid a card). Restoring lays the default order back and
 * shows every card; it is always there, not only when the author's default
 * changed (that is {@link RelatedDefaultChangedHint}). Draws nothing for a
 * column in its default arrangement.
 */
export const RelatedFootLine: React.FC<{
  hiddenCount: number;
  onShowHidden: () => void;
  rearranged: boolean;
  onRestoreDefault: () => void;
}> = ({ hiddenCount, onShowHidden, rearranged, onRestoreDefault }) => {
  const { t } = useDetailTranslation();
  if (hiddenCount === 0 && !rearranged) return null;
  return (
    <p className="text-xs text-muted-foreground" data-related-foot-line="">
      {hiddenCount > 0 && (
        <span data-related-hidden-line="">
          {t('detail.relatedHiddenCount', { count: hiddenCount, defaultValue: '{{count}} hidden' })}
          {' · '}
          <button type="button" className={LINE_BUTTON} onClick={onShowHidden}>
            {t('detail.relatedShowHidden', { defaultValue: 'Show' })}
          </button>
        </span>
      )}
      {hiddenCount > 0 && rearranged && ' · '}
      {rearranged && (
        <button type="button" className={LINE_BUTTON} onClick={onRestoreDefault} data-related-restore-default-order="">
          {t('detail.relatedRestoreDefaultOrder', { defaultValue: 'Restore default order' })}
        </button>
      )}
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
