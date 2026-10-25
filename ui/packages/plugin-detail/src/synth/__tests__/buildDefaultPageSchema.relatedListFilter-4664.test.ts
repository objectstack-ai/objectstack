/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#4664 — the synthesizer's hop: a host-supplied related-list `filter`
 * reaches the `record:related_list` node's OWN `filter` key.
 *
 * That key is not new here — `record:related_list.filter` has had a read site
 * since objectstack#7118, where `RelatedList` ANDs it with
 * `{ [relationshipField]: parentId }`. Landing the derived filter on the SAME
 * key is the whole "no new dialect" requirement of this card: the
 * component-level authored filter and the FK-derived one become one value at
 * one read site, lowered once.
 *
 * The end-to-end subject (the composed `$filter` on the wire, and the badge
 * agreeing with the rows) is
 * `app-shell/src/views/RecordDetailView.relatedListFilter-4664.test.tsx`.
 */

import { describe, it, expect } from 'vitest';
import { buildDefaultTabs, type ObjectDefLike } from '../buildDefaultPageSchema';

const props = (node: any): Record<string, any> => node?.properties ?? {};
const tabItems = (tabs: any): any[] => props(tabs).items ?? [];

const def: ObjectDefLike = {
  name: 'task_version',
  label: 'Task Version',
  fields: { id: { type: 'text' }, name: { type: 'text' } },
};

const relatedNodeOf = (rel: Record<string, any>) => {
  const tabs = buildDefaultTabs(def, { related: [rel as any] });
  const relatedTab = tabItems(tabs).find((t: any) => t.label === 'Related');
  return relatedTab.children[0];
};

const BASE = { objectName: 'check_item', relationshipField: 'task_version', title: 'Checks' };

describe('buildDefaultTabs — related list filter (objectui#4664)', () => {
  it('forwards a supplied filter onto the record:related_list node', () => {
    const declared = { status: { $ne: 'archived' } };
    const node = relatedNodeOf({ ...BASE, filter: declared });
    expect(node.type).toBe('record:related_list');
    // Verbatim: the synthesizer neither derives nor merges it. Composition
    // with the parent scope happens exactly once, at the single filter→wire
    // sink `RelatedList` already routes this key through.
    expect(props(node).filter).toEqual(declared);
  });

  it('COUNTER-PROBE — no filter supplied leaves the key OFF the node', () => {
    const node = relatedNodeOf(BASE);
    // Absent, not `filter: undefined`. Same rule its `sort` sibling follows,
    // and for the same reason: a key written with an undefined value is a
    // different fact from the author having said nothing, and it is the one a
    // liveness audit would read.
    expect('filter' in props(node)).toBe(false);
  });

  it('the filter travels on an isPrimary list too — its own tab, same key', () => {
    const declared = { status: { $ne: 'archived' } };
    const tabs = buildDefaultTabs(def, {
      related: [{ ...BASE, isPrimary: true, filter: declared } as any],
    });
    const ownTab = tabItems(tabs).find((t: any) => t.label === 'Checks');
    expect(props(ownTab.children[0]).filter).toEqual(declared);
  });

  it('the filter rides alongside sort/columns/limit rather than displacing them', () => {
    const node = relatedNodeOf({
      ...BASE,
      filter: { status: { $ne: 'archived' } },
      sort: [{ field: 'seq_no', order: 'asc' }],
      columns: ['name', 'status'],
      limit: 10,
    });
    expect(props(node)).toMatchObject({
      objectName: 'check_item',
      relationshipField: 'task_version',
      filter: { status: { $ne: 'archived' } },
      sort: [{ field: 'seq_no', order: 'asc' }],
      columns: ['name', 'status'],
      limit: 10,
    });
  });
});
