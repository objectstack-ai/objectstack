/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * `list-view` consumes `PageComponentSchema.dataSource` (objectstack#5576).
 *
 * ## What was wrong, in two halves
 *
 * The spec declares a per-element data binding on every page component —
 * `dataSource: { object, view?, filter?, sort?, limit? }` — and objectui read
 * none of it on this block. `resolveElementDataSource` dropped `view` and had no
 * caller outside its own test, and nothing mapped `object` onto the `objectName`
 * that `ListView` actually reads. So "reference a saved view by name" was
 * published and inert (the objectstack#4413 shape).
 *
 * Worse, writing the binding BROKE the block. `ListView`'s `dataSource` prop is
 * the injected data-source ADAPTER, `SchemaRenderer` spread the schema's
 * `dataSource` METADATA onto it, and the plain `{ object, view }` object won —
 * `dataSource.find is not a function`, surfaced as "Couldn't load records".
 * Three `list-view` components on one home page, the two without `dataSource`
 * rendering real data and the spec-compliant one failing, is the reproduction in
 * the issue; the tests below are that reproduction in both directions.
 *
 * ## Why the not-found case is an error and not an empty table
 *
 * A `view` name that does not resolve renders a configuration error. It must not
 * fall back to the object's default view: that turns a typo into a silently
 * WIDER answer — every record instead of the ones the saved view selects — on a
 * page that still looks like it works. It is the exact failure that hides best in
 * AI-authored metadata, so it fails loudly at the only place that can see it.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { SchemaRenderer, SchemaRendererProvider } from '@object-ui/react';
import { I18nProvider } from '@object-ui/i18n';
// Registers `list-view` (and the ListViewBlock bridge under test).
import '../index';

const HOT_VIEW = {
  name: 'hot',
  label: 'Hot accounts',
  type: 'grid',
  columns: ['name', 'rating'],
  filter: [['rating', '=', 'hot']],
  sort: [{ field: 'name', order: 'desc' }],
};

/** A data source shaped like the console's adapter, with saved views embedded. */
function makeAdapter(listViews: Record<string, unknown> = { hot: HOT_VIEW }) {
  return {
    find: vi.fn().mockResolvedValue({ data: [{ id: '1', name: 'Acme', rating: 'hot' }], total: 1 }),
    findOne: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    getObjectSchema: vi.fn().mockResolvedValue({
      name: 'account',
      fields: [
        { name: 'name', type: 'text' },
        { name: 'rating', type: 'text' },
        { name: 'owner', type: 'text' },
      ],
      listViews,
    }),
  };
}

function renderPageComponent(schema: Record<string, unknown>, adapter: ReturnType<typeof makeAdapter>) {
  return render(
    <SchemaRendererProvider dataSource={adapter as any}>
      <SchemaRenderer schema={schema as any} />
    </SchemaRendererProvider>,
  );
}

const firstQuery = (adapter: ReturnType<typeof makeAdapter>) => adapter.find.mock.calls[0][1] as any;

describe('list-view — dataSource: { object, view } (objectstack#5576)', () => {
  it('renders the saved view’s columns, filter and sort', async () => {
    const adapter = makeAdapter();
    const { container } = renderPageComponent(
      { type: 'list-view', dataSource: { object: 'account', view: 'hot' } },
      adapter,
    );

    await waitFor(() => expect(adapter.find).toHaveBeenCalled());

    const query = firstQuery(adapter);
    // `object` reached the data layer as the queried object — the binding half
    // that nothing used to map.
    expect(adapter.find.mock.calls[0][0]).toBe('account');
    // The view's filter and sort are applied…
    expect(query.$filter).toEqual([['rating', '=', 'hot']]);
    expect(query.$orderby).toEqual([{ field: 'name', order: 'desc' }]);
    // …and its columns drive the projection (`id` is always requested).
    expect(query.$select).toEqual(['id', 'name', 'rating']);
    // The regression face: writing the binding must not break the block.
    expect(container.querySelector('[data-testid="list-error-state"]')).toBeNull();
  });

  it('does NOT report "Couldn’t load records" for a spec-compliant binding', async () => {
    // The literal symptom from the issue. Before the fix the schema's
    // `dataSource` shadowed the adapter and `dataSource.find` was not a
    // function, so this panel was the whole rendered output.
    const adapter = makeAdapter();
    const { container } = renderPageComponent(
      { type: 'list-view', data: { provider: 'object', object: 'account' }, dataSource: { object: 'account', view: 'hot' } },
      adapter,
    );

    await waitFor(() => expect(adapter.find).toHaveBeenCalled());
    const panel = container.querySelector('[data-testid="list-error-state"]');
    expect(panel).toBeNull();
  });

  it('leaves a component with NO dataSource exactly as it was', async () => {
    // The other direction of the single-variable reproduction: the two
    // components on that page that worked must keep working, unchanged.
    const adapter = makeAdapter();
    const { container } = renderPageComponent(
      { type: 'list-view', data: { provider: 'object', object: 'account' }, columns: ['name'] },
      adapter,
    );

    await waitFor(() => expect(adapter.find).toHaveBeenCalled());
    expect(adapter.find.mock.calls[0][0]).toBe('account');
    const query = firstQuery(adapter);
    expect(query.$select).toEqual(['id', 'name']);
    expect(query.$filter).toBeUndefined();
    expect(container.querySelector('[data-testid="list-error-state"]')).toBeNull();
    expect(container.querySelector('[data-testid="list-view-datasource-error"]')).toBeNull();
  });

  it('binds `object` with no `view` — no saved view needed', async () => {
    const adapter = makeAdapter();
    renderPageComponent(
      { type: 'list-view', columns: ['name'], dataSource: { object: 'account', limit: 7 } },
      adapter,
    );

    await waitFor(() => expect(adapter.find).toHaveBeenCalled());
    expect(adapter.find.mock.calls[0][0]).toBe('account');
    expect(firstQuery(adapter).$top).toBe(7);
  });

  it('AND-combines the binding filter with the view’s, never replacing it', async () => {
    const adapter = makeAdapter();
    renderPageComponent(
      {
        type: 'list-view',
        dataSource: { object: 'account', view: 'hot', filter: { owner: 'me' } },
      },
      adapter,
    );

    await waitFor(() => expect(adapter.find).toHaveBeenCalled());
    // The view's own restriction survives — a binding filter narrows, it cannot
    // widen the view back to rows the view excludes.
    expect(firstQuery(adapter).$filter).toEqual([
      'and',
      [['rating', '=', 'hot']],
      ['owner', '=', 'me'],
    ]);
  });

  it('lets the binding’s own sort and limit override the view’s', async () => {
    const adapter = makeAdapter();
    renderPageComponent(
      {
        type: 'list-view',
        dataSource: {
          object: 'account',
          view: 'hot',
          sort: [{ field: 'rating', order: 'asc' }],
          limit: 3,
        },
      },
      adapter,
    );

    await waitFor(() => expect(adapter.find).toHaveBeenCalled());
    const query = firstQuery(adapter);
    expect(query.$orderby).toEqual([{ field: 'rating', order: 'asc' }]);
    expect(query.$top).toBe(3);
  });

  it('lets columns authored on the component win over the view’s', async () => {
    const adapter = makeAdapter();
    renderPageComponent(
      {
        type: 'list-view',
        columns: ['name'],
        dataSource: { object: 'account', view: 'hot' },
      },
      adapter,
    );

    await waitFor(() => expect(adapter.find).toHaveBeenCalled());
    expect(firstQuery(adapter).$select).toEqual(['id', 'name']);
    // The view is still applied for everything the component did not author.
    expect(firstQuery(adapter).$filter).toEqual([['rating', '=', 'hot']]);
  });

  it('reads a view from the metadata overlay (`dataSource.listViews`) too', async () => {
    // Saved views created in the UI live in the overlay, not in the object
    // definition — app-shell's ObjectView reads both, and so must this.
    const adapter = Object.assign(makeAdapter({}), {
      listViews: vi.fn().mockResolvedValue([{ ...HOT_VIEW }]),
    });
    renderPageComponent(
      { type: 'list-view', dataSource: { object: 'account', view: 'hot' } },
      adapter,
    );

    await waitFor(() => expect(adapter.find).toHaveBeenCalled());
    expect(adapter.listViews).toHaveBeenCalledWith('account');
    expect(firstQuery(adapter).$filter).toEqual([['rating', '=', 'hot']]);
  });

  it('accepts the qualified spelling of a bare view key', async () => {
    const adapter = makeAdapter();
    renderPageComponent(
      { type: 'list-view', dataSource: { object: 'account', view: 'account.hot' } },
      adapter,
    );

    await waitFor(() => expect(adapter.find).toHaveBeenCalled());
    expect(firstQuery(adapter).$filter).toEqual([['rating', '=', 'hot']]);
  });
});

describe('list-view — an unresolvable dataSource.view fails loudly', () => {
  it('renders a configuration error naming the view, object and known views', async () => {
    const adapter = makeAdapter();
    const { container } = renderPageComponent(
      { type: 'list-view', dataSource: { object: 'account', view: 'lukewarm' } },
      adapter,
    );

    const panel = await waitFor(() => {
      const el = container.querySelector('[data-testid="list-view-datasource-error"]');
      expect(el).not.toBeNull();
      return el as HTMLElement;
    });

    expect(panel.getAttribute('role')).toBe('alert');
    expect(panel.textContent).toContain('lukewarm');
    expect(panel.textContent).toContain('account');
    // What the object DOES have — the part that gets an author unstuck.
    expect(panel.textContent).toContain('hot');
  });

  it('never falls back to an unfiltered query for the object', async () => {
    const adapter = makeAdapter();
    const { container } = renderPageComponent(
      { type: 'list-view', dataSource: { object: 'account', view: 'lukewarm' } },
      adapter,
    );

    await waitFor(() => {
      expect(container.querySelector('[data-testid="list-view-datasource-error"]')).not.toBeNull();
    });
    // The silent-widening this whole binding exists to remove: a mistyped view
    // name must not become "every record in the object".
    expect(adapter.find).not.toHaveBeenCalled();
  });

  /**
   * objectui#8900 — an empty view list is not evidence that the object has no
   * views. The panel used to say "This object has no saved views."; here the
   * read genuinely succeeded and found none, and even THAT world may not carry
   * the old sentence, because the renderer cannot know which world it is in
   * (see the pair below).
   */
  it('reports it without claiming the object has none, when no views came back', async () => {
    const adapter = makeAdapter({});
    const { container } = renderPageComponent(
      { type: 'list-view', dataSource: { object: 'account', view: 'hot' } },
      adapter,
    );

    const panel = await waitFor(() => {
      const el = container.querySelector('[data-testid="list-view-datasource-error"]');
      expect(el).not.toBeNull();
      return el as HTMLElement;
    });
    // SUBJECT: red before the objectui#8900 fix, green after.
    expect(panel.textContent).not.toContain('has no saved views');
    expect(panel.textContent).toContain('could not be read');
    // CONTROL, green in both worlds: guards the wrong fix of softening the
    // message by softening the FAILURE — a mistyped view name must still refuse
    // to widen into "every record in the object".
    expect(adapter.find).not.toHaveBeenCalled();
  });

  /**
   * objectui#8900, the measurement the copy change rests on.
   *
   * The two worlds the empty branch is reached from, rendered through the real
   * hook and the real gate:
   *
   *  - `readFoundNone` — every metadata read succeeded and the object has no views;
   *  - `readFailed`     — the metadata reads FAILED. The object-def leg rejects,
   *    and the overlay leg reproduces the shipped `ObjectStackAdapter.listViews`
   *    contract, which degrades every failure to `[]` on the RESOLVED path
   *    (deliberate; objectui#8151 keeps it) rather than rejecting.
   *
   * `useElementDataSource` sees a successful empty answer in both, so the panel
   * is BYTE-IDENTICAL in both — which is the whole reason its sentence may not
   * pick one of them. objectstack#13906 decision 1 option A.
   */
  describe('an empty view list arrives from two indistinguishable worlds (objectui#8900)', () => {
    /** Reads succeed; the object genuinely has no saved views. */
    const readFoundNone = () => ({
      find: vi.fn().mockResolvedValue({ data: [], total: 0 }),
      getObjectSchema: vi.fn().mockResolvedValue({ name: 'account', fields: [], listViews: {} }),
      listViews: vi.fn().mockResolvedValue([]),
    });

    /** Both reads fail — the overlay one exactly as the shipped adapter fails. */
    const readFailed = () => ({
      find: vi.fn().mockResolvedValue({ data: [], total: 0 }),
      getObjectSchema: vi.fn().mockRejectedValue(new Error('metadata store unavailable')),
      // ⛔ NOT `mockRejectedValue`: `ObjectStackAdapter.listViews` catches and
      // returns `[]`. Rejecting here would test a shape the contract never
      // produces, and would pass for the wrong reason.
      listViews: vi.fn().mockResolvedValue([]),
    });

    const renderPanel = async (adapter: unknown) => {
      const { container } = renderPageComponent(
        { type: 'list-view', dataSource: { object: 'account', view: 'hot' } },
        adapter as ReturnType<typeof makeAdapter>,
      );
      const panel = await waitFor(() => {
        const el = container.querySelector('[data-testid="list-view-datasource-error"]');
        expect(el).not.toBeNull();
        return el as HTMLElement;
      });
      return panel.textContent ?? '';
    };

    it('renders the same words in both, so the words may not name one world', async () => {
      const found = await renderPanel(readFoundNone());
      const failed = await renderPanel(readFailed());

      // CONTROL, green before and after the fix — the two worlds always rendered
      // identically; that is the defect, not the repair. It guards the wrong fix
      // of GUESSING which world this is (inferring "the read failed" from an
      // empty array, which is what both worlds produce).
      expect(failed).toBe(found);

      // SUBJECT: red before the fix, green after. One sentence, true in both.
      expect(found).not.toContain('has no saved views');
      expect(found).toContain('No saved views are known for this object');
      expect(found).toContain('could not be read');
    });
  });

  it('distinguishes "cannot answer" from "the view does not exist"', async () => {
    // A data source that can read records but cannot list views at all. Saying
    // "this object has no view called hot" would be a claim we cannot make;
    // the two facts get two messages.
    const adapter = { find: vi.fn().mockResolvedValue({ data: [], total: 0 }) } as any;
    const { container } = renderPageComponent(
      { type: 'list-view', dataSource: { object: 'account', view: 'hot' } },
      adapter,
    );

    const panel = await waitFor(() => {
      const el = container.querySelector('[data-testid="list-view-datasource-error"]');
      expect(el).not.toBeNull();
      return el as HTMLElement;
    });
    expect(panel.textContent).toContain('cannot list the saved views');
    expect(adapter.find).not.toHaveBeenCalled();
  });
});

describe('list-view — the unresolvable-view panel title reads the bundle (objectui#12920)', () => {
  it('under zh-CN the panel is titled in Chinese, not the English literal', async () => {
    const adapter = makeAdapter();
    const { container } = render(
      <I18nProvider persistLanguage={false} config={{ defaultLanguage: 'zh-CN', detectBrowserLanguage: false }}>
        <SchemaRendererProvider dataSource={adapter as any}>
          <SchemaRenderer schema={{ type: 'list-view', dataSource: { object: 'account', view: 'lukewarm' } } as any} />
        </SchemaRendererProvider>
      </I18nProvider>,
    );

    await waitFor(() =>
      expect(container.querySelector('[data-testid="list-view-datasource-error"]')).not.toBeNull(),
    );
    expect(container.querySelector('[data-testid="list-view-datasource-error"] p.font-medium')?.textContent).toBe(
      '无法解析此列表视图的数据源',
    );
  });
});
