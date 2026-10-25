/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * `embeddable-form` consumes `PageComponentSchema.dataSource` (objectstack#7121).
 *
 * `EmbeddableForm` reads `config.objectName` twice — to let its inner
 * `ObjectForm` fetch the object's fields, and to `create()` the submission — and
 * nothing mapped the spec's `dataSource.object` onto it. A public form authored
 * with the binding the spec documents therefore rendered a field-less shell that
 * could not submit: no request, no error. Same silent shape `object-form` had
 * before objectstack#6953.
 *
 * `object` is the only mapped key, and the second case pins that as a property: a
 * form that CREATES one record has no collection query for `filter` / `sort` /
 * `limit` to narrow, and `fields` is an ordered layout rather than a projection a
 * list view's columns could fill.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import React from 'react';
import { SchemaRenderer, SchemaRendererProvider } from '@object-ui/react';
import { I18nProvider } from '@object-ui/i18n';
// Registers `embeddable-form` (and the ElementDataSourceGate wiring under test).
import './index';

const HOT_VIEW = {
  name: 'hot',
  label: 'Hot leads',
  columns: ['name', 'email'],
  filter: [['rating', '=', 'hot']],
  sort: [{ field: 'name', order: 'desc' }],
  pagination: { pageSize: 7 },
};

function makeAdapter(listViews: Record<string, unknown> = { hot: HOT_VIEW }) {
  return {
    find: vi.fn().mockResolvedValue({ data: [], total: 0 }),
    findOne: vi.fn(),
    create: vi.fn().mockResolvedValue({ id: 'l1' }),
    update: vi.fn(),
    delete: vi.fn(),
    getObjectSchema: vi.fn().mockResolvedValue({
      name: 'lead',
      label: 'Lead',
      fields: {
        name: { name: 'name', type: 'text', label: 'Name' },
        email: { name: 'email', type: 'text', label: 'Email' },
        rating: { name: 'rating', type: 'text', label: 'Rating' },
      },
      listViews,
    }),
  };
}

/** A public form's declared field list — what makes the inner form fetch at all. */
const FIELDS = ['name', 'email'];

const renderBlock = (schema: Record<string, unknown>, adapter: ReturnType<typeof makeAdapter>) =>
  render(
    <SchemaRendererProvider dataSource={adapter as any}>
      <SchemaRenderer schema={schema as any} />
    </SchemaRendererProvider>,
  );

describe('embeddable-form — dataSource: { object } (objectstack#7121)', () => {
  it('fetches the bound object’s schema, so the form has fields at all', async () => {
    const adapter = makeAdapter();
    renderBlock(
      {
        type: 'embeddable-form',
        formId: 'contact-us',
        fields: FIELDS,
        dataSource: { object: 'lead' },
      },
      adapter,
    );

    await waitFor(() => expect(adapter.getObjectSchema).toHaveBeenCalledWith('lead'));
  });

  it('honours `object` and nothing else the binding may carry', async () => {
    const adapter = makeAdapter();
    const { container } = renderBlock(
      {
        type: 'embeddable-form',
        formId: 'contact-us',
        fields: FIELDS,
        dataSource: {
          object: 'lead',
          view: 'hot',
          filter: [['owner', '=', 'me']],
          sort: [{ field: 'name', order: 'asc' }],
          limit: 3,
        },
      },
      adapter,
    );

    await waitFor(() => expect(adapter.getObjectSchema).toHaveBeenCalledWith('lead'));
    // A submission form issues no collection query, so a filter/sort/limit on the
    // binding has nothing to act on — and must not silently become one.
    expect(adapter.find).not.toHaveBeenCalled();
    expect(container.querySelector('[data-testid="embeddable-form-datasource-error"]')).toBeNull();
  });

  it('reports an unresolvable `view` rather than rendering as if it resolved', async () => {
    const adapter = makeAdapter();
    const { container } = renderBlock(
      {
        type: 'embeddable-form',
        formId: 'contact-us',
        fields: FIELDS,
        dataSource: { object: 'lead', view: 'nope' },
      },
      adapter,
    );

    await waitFor(() =>
      expect(container.querySelector('[data-testid="embeddable-form-datasource-error"]')).not.toBeNull(),
    );
    // The known-view list is what gets the author unstuck.
    expect(container.textContent).toContain('hot');
  });

  it('leaves a form with NO dataSource exactly as it was', async () => {
    const adapter = makeAdapter();
    renderBlock(
      { type: 'embeddable-form', formId: 'contact-us', objectName: 'lead', fields: FIELDS },
      adapter,
    );

    await waitFor(() => expect(adapter.getObjectSchema).toHaveBeenCalledWith('lead'));
  });
});

describe('embeddable-form — the unresolvable-view panel title reads the bundle (objectui#12920)', () => {
  it('under zh-CN the panel is titled in Chinese, not the English literal', async () => {
    const adapter = makeAdapter();
    const { container } = render(
      <I18nProvider persistLanguage={false} config={{ defaultLanguage: 'zh-CN', detectBrowserLanguage: false }}>
        <SchemaRendererProvider dataSource={adapter as any}>
          <SchemaRenderer schema={{ type: 'embeddable-form', formId: 'contact-us', fields: FIELDS, dataSource: { object: 'lead', view: 'nope' } } as any} />
        </SchemaRendererProvider>
      </I18nProvider>,
    );

    await waitFor(() =>
      expect(container.querySelector('[data-testid="embeddable-form-datasource-error"]')).not.toBeNull(),
    );
    expect(container.querySelector('[data-testid="embeddable-form-datasource-error"] p.font-medium')?.textContent).toBe(
      '无法解析此表单的数据源',
    );
  });
});
