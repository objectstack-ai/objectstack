/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#26890 — which child objects an authored record page lists. The
 * page-level behaviour (a write to one re-reads the parent) is pinned in
 * `RecordDetailView.authoredChildWriteRefreshesParent-26890.test.tsx`; this
 * file pins the arms the walk reads and the ones it must not.
 *
 * objectstack#26988 — the same arms leave out the lists of an object the
 * install does not hold. The page-level behaviour (not drawn, never asked) is
 * pinned in `RecordDetailView.unregisteredObjectLists-26988.test.tsx`; this
 * file pins what is left out, what is kept, and the deferral.
 */

import { describe, it, expect } from 'vitest';
import { pruneUnregisteredRecordPageObjects, recordPageChildObjects } from './recordPageChildObjects';

describe('recordPageChildObjects (objectstack#26890)', () => {
  it('names every related list and rail entry at any depth, sorted and once', () => {
    const page = {
      type: 'record',
      object: 'quote',
      regions: [
        {
          name: 'main',
          components: [
            {
              type: 'page:tabs',
              properties: {
                items: [
                  {
                    value: 'related',
                    children: [
                      { type: 'record:related_list', properties: { objectName: 'quote_line', relationshipField: 'quote' } },
                      // The element data-source binding the block's gate maps onto `objectName`.
                      { type: 'record:related_list', dataSource: { object: 'quote_term' }, properties: { relationshipField: 'quote' } },
                    ],
                  },
                ],
              },
            },
          ],
        },
        {
          name: 'aside',
          components: [
            {
              type: 'record:reference_rail',
              properties: {
                entries: [
                  { objectName: 'quote_note', relationshipField: 'quote' },
                  { objectName: 'quote_line', relationshipField: 'quote' },
                ],
              },
            },
          ],
        },
      ],
    };

    expect(recordPageChildObjects(page)).toEqual(['quote_line', 'quote_note', 'quote_term']);
  });

  it('does not name the objects other blocks bind, or a non-string value', () => {
    const page = {
      type: 'record',
      object: 'quote',
      regions: [
        {
          name: 'main',
          components: [
            { type: 'element:chart', dataSource: { object: 'opportunity' } },
            { type: 'record:line_items', properties: { childObject: 'quote_line', parentObject: 'quote' } },
            { type: 'record:related_list', properties: { objectName: { $expr: 'child' } } },
            { type: 'record:reference_rail', properties: { entries: [{ objectName: 7 }] } },
          ],
        },
      ],
    };

    expect(recordPageChildObjects(page)).toEqual([]);
    expect(recordPageChildObjects(null)).toEqual([]);
  });
});

describe('pruneUnregisteredRecordPageObjects (objectstack#26988)', () => {
  const page = () => ({
    type: 'record',
    object: 'opportunity',
    regions: [
      {
        name: 'main',
        components: [
          { type: 'page:header', properties: { title: '{name}' } },
          {
            type: 'page:tabs',
            properties: {
              items: [
                {
                  value: 'related',
                  children: [
                    { type: 'record:related_list', properties: { objectName: 'contact', relationshipField: 'opportunity' } },
                    { type: 'record:related_list', properties: { objectName: 'crm_quote', relationshipField: 'opportunity' } },
                    { type: 'record:related_list', dataSource: { object: 'crm_line_item' }, properties: { relationshipField: 'opportunity' } },
                  ],
                },
              ],
            },
          },
        ],
      },
      {
        name: 'aside',
        components: [
          {
            type: 'record:reference_rail',
            properties: {
              entries: [
                { objectName: 'contact', relationshipField: 'opportunity' },
                { objectName: 'crm_product', relationshipField: 'opportunity' },
              ],
            },
          },
          { type: 'record:reference_rail', properties: { entries: [{ objectName: 'crm_quote', relationshipField: 'opportunity' }] } },
        ],
      },
    ],
  });

  it('leaves out every list and rail entry naming an unregistered object, and a rail left with none', () => {
    const pruned = pruneUnregisteredRecordPageObjects(page(), new Set(['opportunity', 'contact']));

    expect(recordPageChildObjects(pruned)).toEqual(['contact']);
    const [main, aside] = pruned.regions;
    expect((main.components[1] as any).properties.items[0].children).toEqual([
      { type: 'record:related_list', properties: { objectName: 'contact', relationshipField: 'opportunity' } },
    ]);
    expect(aside.components).toEqual([
      { type: 'record:reference_rail', properties: { entries: [{ objectName: 'contact', relationshipField: 'opportunity' }] } },
    ]);
    // The rest of the page is the authored one, block for block.
    expect(main.components[0]).toEqual({ type: 'page:header', properties: { title: '{name}' } });
  });

  it('returns the page itself when every object it names is registered, and keeps untouched subtrees', () => {
    const authored = page();
    const all = new Set(['opportunity', 'contact', 'crm_quote', 'crm_line_item', 'crm_product']);
    expect(pruneUnregisteredRecordPageObjects(authored, all)).toBe(authored);

    const pruned = pruneUnregisteredRecordPageObjects(authored, new Set(['opportunity', 'contact']));
    expect(pruned).not.toBe(authored);
    expect(pruned.regions[0].components[0]).toBe(authored.regions[0].components[0]);
    // The authored page is never written to.
    expect(authored).toEqual(page());
  });

  it('prunes nothing while the registered list is empty — it has not loaded yet', () => {
    const authored = page();
    expect(pruneUnregisteredRecordPageObjects(authored, new Set())).toBe(authored);
  });

  it('keeps a block that names its object some other way than a string, and passes non-pages through', () => {
    const odd = {
      regions: [
        {
          components: [
            { type: 'record:related_list', properties: { objectName: { $expr: 'child' } } },
            { type: 'record:reference_rail', properties: { entries: [{ objectName: 7 }] } },
            { type: 'element:chart', dataSource: { object: 'crm_quote' } },
          ],
        },
      ],
    };
    const registered = new Set(['opportunity']);
    expect(pruneUnregisteredRecordPageObjects(odd, registered)).toBe(odd);
    expect(pruneUnregisteredRecordPageObjects(null, registered)).toBeNull();
    expect(pruneUnregisteredRecordPageObjects(undefined, registered)).toBeUndefined();
  });
});
