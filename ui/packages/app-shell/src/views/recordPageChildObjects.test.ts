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
 */

import { describe, it, expect } from 'vitest';
import { recordPageChildObjects } from './recordPageChildObjects';

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
