/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import * as React from 'react';
import type { RelatedCardChrome } from './relatedListCompact';
import { relatedListIdsIn } from './synth/recordPageColumns';
import type { RelatedArrangement, RelatedCardId } from './synth/relatedArrangement';
import { useRelatedArrangement } from './useRelatedArrangement';

/**
 * The reader's arrangement as the tabbed tier's 关联 tab reads it
 * (objectstack#27055, Target 7: 「The same order and collapsed state apply in
 * the tabbed tier's 关联 tab」). Read by the `record:related_list` renderer: a
 * collapsed list draws as its title + count (no rows read), every other list
 * gets its chrome (the ⋯ menu), and the tab's LAST list draws the column's
 * two lines after itself — the changed-default hint and the foot line
 * (「已隐藏 N 张 · 显示」 · 「恢复默认顺序」).
 */
export interface RelatedArrangementScope {
  chromeOf: (id: RelatedCardId) => RelatedCardChrome | null;
  isCollapsed: (id: RelatedCardId) => boolean;
  expand: (id: RelatedCardId) => void;
  /** The list that draws the tab's closing lines. */
  lastId: RelatedCardId | null;
  hiddenCount: number;
  showHidden: () => void;
  defaultChanged: boolean;
  restoreDefault: () => void;
  /** The reader moved or hid a card: the foot offers 「恢复默认顺序」 (objectstack#27241). */
  rearranged: boolean;
  restoreDefaultArrangement: () => void;
}

export const RelatedArrangementScopeContext = React.createContext<RelatedArrangementScope | null>(null);

type Node = Record<string, any>;
const asNode = (value: unknown): Node | null =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Node) : null;

/** The `related` tab item of a synthesized page's strip, with its path. */
function findRelatedTab(page: unknown): { regionIndex: number; componentIndex: number; itemIndex: number; item: Node } | null {
  const regions = Array.isArray(asNode(page)?.regions) ? (asNode(page)!.regions as unknown[]) : [];
  for (let r = 0; r < regions.length; r += 1) {
    const components = asNode(regions[r])?.components;
    if (!Array.isArray(components)) continue;
    for (let c = 0; c < components.length; c += 1) {
      const tabs = asNode(components[c]);
      if (tabs?.type !== 'page:tabs' || !Array.isArray(tabs.properties?.items)) continue;
      const items = tabs.properties.items as unknown[];
      for (let i = 0; i < items.length; i += 1) {
        const item = asNode(items[i]);
        if (item?.value === 'related') return { regionIndex: r, componentIndex: c, itemIndex: i, item };
      }
    }
  }
  return null;
}

const relatedListIdOf = (node: unknown): RelatedCardId | null => relatedListIdsIn([node])[0] ?? null;

/**
 * Lays the reader's arrangement over a synthesized page's 关联 tab
 * (objectstack#27055): its lists in the reader's order, hidden lists left out,
 * any other child (the attachments) after them; and the scope the
 * `record:related_list` renderer reads for the collapsed state, the chrome and
 * the closing lines. A page with no 关联 tab is handed through unchanged.
 */
export const ArrangedRelatedTab: React.FC<{
  page: unknown;
  arrangement?: RelatedArrangement;
  onArrangementChange?: (next: RelatedArrangement) => void;
  children: (page: unknown) => React.ReactNode;
}> = ({ page, arrangement, onArrangementChange, children }) => {
  const found = findRelatedTab(page);
  const tabChildren: unknown[] = Array.isArray(found?.item.children) ? (found!.item.children as unknown[]) : [];
  const lists = tabChildren.filter((node) => relatedListIdOf(node) !== null);
  const others = tabChildren.filter((node) => relatedListIdOf(node) === null);
  const defaultOrder = lists.map((node) => relatedListIdOf(node)!);
  const { resolved, edit, chromeOf } = useRelatedArrangement({ defaultOrder, arrangement, onArrangementChange });

  const arrangedPage = React.useMemo(() => {
    if (!found) return page;
    const byId = new Map(lists.map((node) => [relatedListIdOf(node)!, node]));
    const nextChildren = [...resolved.order.map((id) => byId.get(id)!), ...others];
    const source = page as Node;
    const regions = [...source.regions];
    const region = { ...regions[found.regionIndex] };
    const components = [...region.components];
    const tabs = { ...components[found.componentIndex] };
    const items = [...tabs.properties.items];
    items[found.itemIndex] = { ...found.item, children: nextChildren };
    tabs.properties = { ...tabs.properties, items };
    components[found.componentIndex] = tabs;
    region.components = components;
    regions[found.regionIndex] = region;
    return { ...source, regions };
    // The arranged order is the input that moves; the page is the other.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, resolved.order.join('|')]);

  const scope: RelatedArrangementScope = {
    chromeOf: (id) => {
      const index = resolved.order.indexOf(id);
      return index >= 0 ? chromeOf(id, index) : null;
    },
    isCollapsed: (id) => resolved.collapsed.has(id),
    expand: (id) => edit({ kind: 'collapse', id, collapsed: false }),
    lastId: resolved.order.length > 0 ? resolved.order[resolved.order.length - 1] : null,
    hiddenCount: resolved.hidden.length,
    showHidden: () => edit({ kind: 'show-hidden' }),
    defaultChanged: resolved.defaultChanged,
    restoreDefault: () => edit({ kind: 'restore-default-order' }),
    rearranged: resolved.rearranged,
    restoreDefaultArrangement: () => edit({ kind: 'restore-default-arrangement' }),
  };
  return (
    <RelatedArrangementScopeContext.Provider value={scope}>{children(arrangedPage)}</RelatedArrangementScopeContext.Provider>
  );
};
