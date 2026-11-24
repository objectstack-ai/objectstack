/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#36149 — the related tab in a side preview (its header bar says
 * `preview`) hands the grid `cardFace`: one row per record, its title and one
 * summary line, rather than a table cut off at the preview's 460 px edge.
 *
 * Controls: the same tab under a page's bar, or under no bar, hands no
 * `cardFace` (the table, as before); a related list that is not the tab hands
 * none even inside a preview.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { cleanup, render, waitFor } from '@testing-library/react';
import * as React from 'react';
import { RecordHeaderBarContext, type RecordHeaderBar } from '@object-ui/components';
import { RelatedList } from '../RelatedList';
import { RelatedListEnlargedContext } from '../relatedListCompact';

/** Capture what `RelatedList` hands to `SchemaRenderer`. */
const h = vi.hoisted(() => ({ props: null as any }));
vi.mock('@object-ui/react', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    SchemaRenderer: (props: any) => {
      h.props = props;
      return null;
    },
  };
});

afterEach(() => {
  cleanup();
  h.props = null;
});

const ROWS = [
  { id: 'a1', name: 'Call Ada', subject: 'Renewal', account: 'ACC-1' },
  { id: 'a2', name: 'Email Alan', subject: 'Pricing', account: 'ACC-1' },
];

const bar = (preview: boolean): RecordHeaderBar => ({
  titleSlot: null,
  actionSlot: null,
  claim: () => {},
  ...(preview ? { preview: true } : {}),
});

function renderList({ enlarged, headerBar }: { enlarged: boolean; headerBar: RecordHeaderBar | null }) {
  const dataSource = {
    find: vi.fn(async () => ({ data: ROWS, total: ROWS.length })),
    getObjectSchema: vi.fn(async () => ({
      name: 'activity',
      fields: {
        name: { type: 'text', label: 'Name' },
        subject: { type: 'text', label: 'Subject' },
        account: { type: 'lookup', reference: 'account', label: 'Account' },
      },
    })),
  };
  return render(
    <RecordHeaderBarContext.Provider value={headerBar}>
      <RelatedListEnlargedContext.Provider value={enlarged}>
        <RelatedList
          title="Activities"
          type="table"
          api="activity"
          objectName="activity"
          referenceField="account"
          parentId="ACC-1"
          pageSize={25}
          columns={[{ field: 'name', label: 'Name' }, { field: 'subject', label: 'Subject' }]}
          dataSource={dataSource as never}
        />
      </RelatedListEnlargedContext.Provider>
    </RecordHeaderBarContext.Provider>,
  );
}

describe('the related tab in a side preview draws one card row per record (objectstack#36149)', () => {
  it('a preview bar: the grid is handed cardFace', async () => {
    renderList({ enlarged: true, headerBar: bar(true) });
    await waitFor(() => expect(h.props?.schema?.data?.items).toHaveLength(2));
    expect(h.props.schema.type).toBe('object-grid');
    expect(h.props.cardFace).toBe(true);
  });

  it('CONTROL: a page bar hands no cardFace', async () => {
    renderList({ enlarged: true, headerBar: bar(false) });
    await waitFor(() => expect(h.props?.schema?.data?.items).toHaveLength(2));
    expect(h.props.schema.type).toBe('object-grid');
    expect(h.props.cardFace).toBeUndefined();
  });

  it('CONTROL: no bar hands no cardFace', async () => {
    renderList({ enlarged: true, headerBar: null });
    await waitFor(() => expect(h.props?.schema?.data?.items).toHaveLength(2));
    expect(h.props.cardFace).toBeUndefined();
  });

  it('CONTROL: a related list that is not the tab hands no cardFace inside a preview', async () => {
    renderList({ enlarged: false, headerBar: bar(true) });
    await waitFor(() => expect(h.props?.schema?.data).toBeDefined());
    expect(h.props.schema.type).not.toBe('object-grid');
    expect(h.props.cardFace).toBeUndefined();
  });
});
