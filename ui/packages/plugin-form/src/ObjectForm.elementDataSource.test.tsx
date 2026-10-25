/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * `object-form` consumes `PageComponentSchema.dataSource` (objectstack#6953).
 *
 * `ObjectForm` gates its whole schema fetch on `objectName`, and nothing mapped
 * the spec's `dataSource.object` onto it — so a page authored with the binding
 * the spec documents rendered a field-less shell with no error. That is the
 * silent half of objectstack#6953.
 *
 * ## Scope, stated so the pin is not over-read
 *
 * ⭐ This file is the registered member pin for `object-form.dataSource`
 * (objectui#8071 slice 11). It was promoted after being READ rather than
 * credited on its strings, and GROWN by one row — the precedence of the one
 * member the block maps; see that row's own comment below.
 *
 * `object` is the only key of the binding this block can honour, and the second
 * test says so as a property rather than a comment: a form edits ONE record, so
 * there is no collection query for `filter` / `sort` / `limit` to narrow, and a
 * saved LIST view's columns are not a form layout. Those keys are deliberately
 * left unmapped — writing them onto schema keys `ObjectForm` ignores would
 * reproduce the defect this wiring removes, one layer deeper.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import React from 'react';
import { SchemaRenderer, SchemaRendererProvider } from '@object-ui/react';
import { I18nProvider } from '@object-ui/i18n';
// Registers `object-form` (and the ElementDataSourceGate wiring under test).
import './index';

const HOT_VIEW = {
  name: 'hot',
  label: 'Hot accounts',
  columns: ['name', 'rating'],
  filter: [['rating', '=', 'hot']],
  sort: [{ field: 'name', order: 'desc' }],
  pagination: { pageSize: 7 },
};

function makeAdapter(listViews: Record<string, unknown> = { hot: HOT_VIEW }) {
  return {
    find: vi.fn().mockResolvedValue({ data: [], total: 0 }),
    findOne: vi.fn().mockResolvedValue({ id: 'a1', name: 'Acme' }),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    getObjectSchema: vi.fn().mockResolvedValue({
      name: 'account',
      label: 'Account',
      fields: {
        name: { name: 'name', type: 'text', label: 'Name' },
        rating: { name: 'rating', type: 'text', label: 'Rating' },
      },
      listViews,
    }),
  };
}

const renderBlock = (schema: Record<string, unknown>, adapter: ReturnType<typeof makeAdapter>) =>
  render(
    <SchemaRendererProvider dataSource={adapter as any}>
      <SchemaRenderer schema={schema as any} />
    </SchemaRendererProvider>,
  );

describe('object-form — dataSource: { object } (objectstack#6953)', () => {
  it('fetches the bound object’s schema, so the form has fields at all', async () => {
    const adapter = makeAdapter();
    renderBlock({ type: 'object-form', mode: 'create', dataSource: { object: 'account' } }, adapter);

    // The observable difference: `getObjectSchema('account')` is what produces
    // the form's fields, and it was never called because `objectName` was unset.
    await waitFor(() => expect(adapter.getObjectSchema).toHaveBeenCalledWith('account'));
  });

  it('honours `object` and nothing else the binding may carry', async () => {
    const adapter = makeAdapter();
    const { container } = renderBlock(
      {
        type: 'object-form',
        mode: 'create',
        dataSource: { object: 'account', view: 'hot', limit: 3, sort: [{ field: 'name', order: 'asc' }] },
      },
      adapter,
    );

    await waitFor(() => expect(adapter.getObjectSchema).toHaveBeenCalledWith('account'));
    // A form issues no collection query, so a filter/sort/limit on the binding
    // has nothing to act on — and must not silently become one.
    expect(adapter.find).not.toHaveBeenCalled();
    expect(container.querySelector('[data-testid="object-form-datasource-error"]')).toBeNull();
  });

  it('reports an unresolvable `view` rather than rendering as if it resolved', async () => {
    const adapter = makeAdapter();
    const { container } = renderBlock(
      { type: 'object-form', mode: 'create', dataSource: { object: 'account', view: 'nope' } },
      adapter,
    );

    await waitFor(() =>
      expect(container.querySelector('[data-testid="object-form-datasource-error"]')).not.toBeNull(),
    );
    expect(container.textContent).toContain('hot');
  });

  it('leaves a form with NO dataSource exactly as it was', async () => {
    const adapter = makeAdapter();
    renderBlock({ type: 'object-form', objectName: 'account', mode: 'create' }, adapter);
    await waitFor(() => expect(adapter.getObjectSchema).toHaveBeenCalledWith('account'));
  });

  // ── the MEMBER-PIN row (objectui#8071) ──────────────────────────────────
  //
  // Registered as the member pin for `object-form.dataSource` after the four
  // tests above were read end to end: they already constrain WHICH members this
  // block honours (`object`) and which it deliberately does not (`filter` /
  // `sort` / `limit`, with a resolving `view` contributing nothing and an
  // unresolvable one reporting). What they never stated is the precedence of
  // the one member that IS mapped, and that is the half a plausible
  // "improvement" takes away.
  //
  // `ElementDataSourceGate` spells it `next[objectKey] = composed.object` —
  // unconditional. So the binding's `object` OUTRANKS a flat `objectName`
  // authored on the same node. The friendly-looking spelling is `??=`
  // ("don't clobber what the author wrote explicitly"), and under it a page
  // that rebinds a form to another object through the spec's own binding would
  // silently keep editing the old one: same fields, same labels, same Save
  // button, wrong table. Nothing declared distinguishes the two — the spec's
  // `ElementDataSourceSchema` describes the binding, never its precedence
  // against the block's flat keys.
  it('the `object` member OUTRANKS a flat `objectName` on the same node', async () => {
    const adapter = makeAdapter();
    renderBlock(
      { type: 'object-form', objectName: 'contact', mode: 'create', dataSource: { object: 'account' } },
      adapter,
    );

    await waitFor(() => expect(adapter.getObjectSchema).toHaveBeenCalledWith('account'));
    expect(
      adapter.getObjectSchema.mock.calls.map((call: unknown[]) => call[0]),
      'a `??=` read would fetch `contact` and render the wrong object with no diagnostic',
    ).not.toContain('contact');
  });
});

describe('object-form — the unresolvable-view panel title reads the bundle (objectui#12920)', () => {
  it('under zh-CN the panel is titled in Chinese, not the English literal', async () => {
    const adapter = makeAdapter();
    const { container } = render(
      <I18nProvider persistLanguage={false} config={{ defaultLanguage: 'zh-CN', detectBrowserLanguage: false }}>
        <SchemaRendererProvider dataSource={adapter as any}>
          <SchemaRenderer schema={{ type: 'object-form', mode: 'create', dataSource: { object: 'account', view: 'nope' } } as any} />
        </SchemaRendererProvider>
      </I18nProvider>,
    );

    await waitFor(() =>
      expect(container.querySelector('[data-testid="object-form-datasource-error"]')).not.toBeNull(),
    );
    expect(container.querySelector('[data-testid="object-form-datasource-error"] p.font-medium')?.textContent).toBe(
      '无法解析此表单的数据源',
    );
  });
});
