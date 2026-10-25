/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * `record:related_list` consumes `PageComponentSchema.dataSource`
 * (objectstack#6953).
 *
 * The spec declares the binding on every page component; this block read none of
 * it. Nothing mapped `dataSource.object` onto the `objectName` the renderer
 * requires, so a related list authored with the binding hit the
 * "missing objectName" placeholder instead of listing anything.
 *
 * ## The key that used to be unmapped, and what closed it
 *
 * `filter` was deliberately left out of the mapping when this suite was written:
 * the renderer DECLARED `filter` and nothing read it — `RelatedList` built its
 * query from `{ [referenceField]: parentId }` alone and had no prop for the
 * list's own scope — so writing the composed filter onto `schema.filter` would
 * have handed it to a dead key, which is the defect objectstack#6953 removes
 * rather than spreads. The last test pinned that consequence honestly: a saved
 * view named here contributed its columns / sort / limit while its FILTER was
 * dropped, so the list could be wider than the view it names.
 *
 * objectstack#7118 gave the key a read site, so that test is now the POSITIVE
 * assertion its own comment predicted: the composed filter reaches `RelatedList`
 * and the list can no longer be wider than the view it names.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import * as React from 'react';
import { RecordContextProvider } from '@object-ui/react';
import { I18nProvider } from '@object-ui/i18n';
import { RecordRelatedListRenderer } from '../renderers/record-related-list';

// Capture what the renderer passes down to RelatedList — the question actually
// asked of the list, not merely that a prop was threaded somewhere.
const h = vi.hoisted(() => ({ captured: null as any }));
vi.mock('../RelatedList', () => ({
  RelatedList: (props: any) => {
    h.captured = props;
    return <div data-testid="related-list" />;
  },
}));

const RECENT_VIEW = {
  name: 'recent',
  label: 'Recent contacts',
  columns: ['name', 'email'],
  filter: [['is_active', '=', true]],
  sort: [{ field: 'created', order: 'desc' }],
  pagination: { pageSize: 3 },
};

const makeDataSource = (listViews: Record<string, unknown> = { recent: RECENT_VIEW }) => ({
  find: vi.fn(async () => []),
  getObjectSchema: vi.fn(async (name: string) => ({ name, fields: {}, listViews })),
});

function renderRelated(schema: Record<string, any>, ds = makeDataSource()) {
  const utils = render(
    <RecordContextProvider objectName="account" recordId="ACC-1" dataSource={ds as any}>
      <RecordRelatedListRenderer schema={{ relationshipField: 'account_id', ...schema }} />
    </RecordContextProvider>,
  );
  return { ...utils, ds };
}

beforeEach(() => {
  h.captured = null;
});

describe('record:related_list — dataSource: { object, view } (objectstack#6953)', () => {
  it('maps `object` onto the related objectName it lists', async () => {
    renderRelated({ dataSource: { object: 'contact' } });
    // Before the wiring this rendered the "missing objectName" placeholder.
    await waitFor(() => expect(h.captured).toBeTruthy());
    expect(h.captured.objectName).toBe('contact');
    expect(h.captured.api).toBe('contact');
  });

  it('takes the saved view’s columns, sort and row cap', async () => {
    renderRelated({ dataSource: { object: 'contact', view: 'recent' } });
    await waitFor(() => expect(h.captured).toBeTruthy());
    expect(h.captured.columns).toEqual(['name', 'email']);
    expect(h.captured.defaultSort).toEqual([{ field: 'created', order: 'desc' }]);
    expect(h.captured.pageSize).toBe(3);
  });

  it('lets an authored key win over the same key from the view', async () => {
    renderRelated({
      columns: ['name'],
      limit: 20,
      dataSource: { object: 'contact', view: 'recent' },
    });
    await waitFor(() => expect(h.captured).toBeTruthy());
    expect(h.captured.columns).toEqual(['name']);
    expect(h.captured.pageSize).toBe(20);
  });

  it('reports an unresolvable `view` instead of listing every child row', async () => {
    const { container } = renderRelated({ dataSource: { object: 'contact', view: 'nope' } });
    await waitFor(() =>
      expect(container.querySelector('[data-testid="record-related-list-datasource-error"]')).not.toBeNull(),
    );
    expect(h.captured).toBeNull();
    expect(container.textContent).toContain('recent');
  });

  it('leaves a related list with NO dataSource exactly as it was', async () => {
    renderRelated({ objectName: 'contact', columns: ['name'], limit: 7 });
    await waitFor(() => expect(h.captured).toBeTruthy());
    expect(h.captured.objectName).toBe('contact');
    expect(h.captured.columns).toEqual(['name']);
    expect(h.captured.pageSize).toBe(7);
  });

  it('hands the composed view-AND-binding filter to the list (objectstack#7118)', async () => {
    // The flipped half of this suite. Before objectstack#7118 the assertion here
    // was `h.captured.filter` is `undefined` — an honest pin on a dead declared
    // key, with the note that a read site would invert it. It did, so this now
    // asserts the composition arrives: the view's own filter and the binding's,
    // ANDed, on the prop `RelatedList` reads for the list's own scope.
    renderRelated({ dataSource: { object: 'contact', view: 'recent', filter: [['x', '=', 1]] } });
    await waitFor(() => expect(h.captured).toBeTruthy());
    expect(h.captured.filter).toEqual(['and', [['is_active', '=', true]], [['x', '=', 1]]]);
    // Still not `baseFilter` — that prop is the ADD PICKER's candidate
    // restriction (`add.picker.filter`, #3831). Routing the list's scope there
    // would filter the dialog and leave the list wide.
    expect(h.captured.baseFilter).toBeUndefined();
  });

  it('narrows, never widens: an authored filter survives alongside the view’s', async () => {
    // The binding's contract in one case — "additional filter criteria" means
    // the component's own key and the view's both stay in force. A mapping that
    // let one replace the other would be able to widen a named view, which is
    // the failure class the binding exists to remove.
    renderRelated({
      filter: [{ field: 'stage', operator: 'equals', value: 'won' }],
      dataSource: { object: 'contact', view: 'recent' },
    });
    await waitFor(() => expect(h.captured).toBeTruthy());
    expect(h.captured.filter).toEqual([
      'and',
      [['stage', 'equals', 'won']],
      [['is_active', '=', true]],
    ]);
  });

  it('leaves an unbound list’s authored filter exactly as authored', async () => {
    // No binding: the schema key passes through by reference, in the spec's own
    // vocabulary. `RelatedList` owns the lowering (its own suite pins it), so
    // nothing converts it twice on the way down.
    const authored = [{ field: 'stage', operator: 'equals', value: 'won' }];
    renderRelated({ objectName: 'contact', filter: authored });
    await waitFor(() => expect(h.captured).toBeTruthy());
    expect(h.captured.filter).toBe(authored);
  });
});

describe('record:related_list — the unresolvable-view panel title reads the bundle (objectui#12920)', () => {
  it('under zh-CN the panel is titled in Chinese, not the English literal', async () => {
    const { container } = render(
      <I18nProvider persistLanguage={false} config={{ defaultLanguage: 'zh-CN', detectBrowserLanguage: false }}>
        <RecordContextProvider objectName="account" recordId="ACC-1" dataSource={makeDataSource() as any}>
          <RecordRelatedListRenderer
            schema={{ relationshipField: 'account_id', dataSource: { object: 'contact', view: 'nope' } } as any}
          />
        </RecordContextProvider>
      </I18nProvider>,
    );

    await waitFor(() =>
      expect(container.querySelector('[data-testid="record-related-list-datasource-error"]')).not.toBeNull(),
    );
    expect(
      container.querySelector('[data-testid="record-related-list-datasource-error"] p.font-medium')?.textContent,
    ).toBe('无法解析此相关列表的数据源');
  });
});
