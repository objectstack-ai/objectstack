/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * `object-master-detail-form` consumes `PageComponentSchema.dataSource`
 * (objectstack#7121).
 *
 * `schema.objectName` is the PARENT object here, and everything downstream is
 * gated on it: the parent `ObjectForm` fetches its fields through it and
 * `deriveDetail` needs it to find each child's relationship field back to the
 * parent. Nothing mapped the spec's `dataSource.object` onto it, so a
 * master-detail form authored the way the spec documents rendered a parent shell
 * whose details could not resolve their own FK — no request, no error.
 *
 * `object` is the only mapped key: the parent is ONE record (no collection query
 * for `filter` / `sort` / `limit` to narrow) and the child collections are fetched
 * by FK from `schema.details` at a fixed `$top: 500`, not from anything the
 * binding carries.
 *
 * ## Scope, stated so the pin is not over-read
 *
 * ⭐ This file is the registered member pin for
 * `object-master-detail-form.dataSource` (objectui#8071 slice 18). It was
 * promoted after the four tests above were read end to end, and GROWN by five
 * rows, four facts and one control (see the `MEMBER-PIN rows` block at the
 * bottom). The four tests were
 * already sound. What they never stated is where the one mapped member goes
 * once it wins, and which of the unmapped members are still READ:
 *
 *   - `object` OUTRANKS a flat `objectName` on the same node. The gate writes
 *     `next[objectKey] = composed.object` unconditionally, and a `??=` spelling
 *     would keep a rebound form on the old object with no diagnostic. This is
 *     the same row `object-form.dataSource` carries, for the same reason.
 *   - ⭐ The row only this block can make: the bound object reaches the DETAIL
 *     half. `deriveDetail` picks each child's FK by the PARENT object's name,
 *     and the atomic batch names the parent object on its first leg. Both read
 *     the bound name, measured on one child object that has a lookup to BOTH
 *     candidate parents.
 *   - `filter` / `sort` / `limit` never reach the CHILD collection read either:
 *     in `edit` mode each line read is scoped by FK and capped at 500,
 *     whatever the binding carries.
 *   - ⚠️ Unmapped does not mean unread. Beside a named `view` the gate MERGES
 *     the binding's `filter` with the view's, so a malformed one withholds the
 *     whole form behind the malformed-filter notice, even though no filter
 *     narrows anything on this block.
 *
 * `dataSource` is absent from `ComponentPropsMap['object-master-detail-form']`.
 * It is the injected `ELEMENT_DATA_SOURCE_INPUT` (the spec's
 * `PageComponentSchema.dataSource`), and nothing declared states its precedence
 * against the block's flat keys. The new rows spell the binding's `filter` in the
 * `ViewFilterRule` array form. That is the form `@objectstack/spec` 17.5.0
 * declares for it; 17.4.0 declared a MongoDB-style record. No row parses the
 * binding against the spec, because this block never reads that member's
 * declared shape.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import React from 'react';
import { SchemaRenderer, SchemaRendererProvider } from '@object-ui/react';
import { I18nProvider } from '@object-ui/i18n';
// Registers `object-master-detail-form` (and the gate wiring under test).
import './index';

const HOT_VIEW = {
  name: 'hot',
  label: 'Open invoices',
  columns: ['number', 'status'],
  filter: [['status', '=', 'open']],
  sort: [{ field: 'number', order: 'desc' }],
  pagination: { pageSize: 7 },
};

/**
 * Fully configured details (FK + typed columns) so `needsDerive` is false and the
 * section header renders on the first pass — the marker below reads it to prove
 * the block itself mounted, not merely that the gate resolved.
 */
const DETAILS = [
  {
    childObject: 'invoice_line',
    relationshipField: 'invoice',
    title: 'Invoice lines',
    columns: [{ name: 'qty', type: 'number' as const }],
  },
];

function makeAdapter(listViews: Record<string, unknown> = { hot: HOT_VIEW }) {
  return {
    find: vi.fn().mockResolvedValue({ data: [], total: 0 }),
    findOne: vi.fn().mockResolvedValue({ id: 'i1' }),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    getObjectSchema: vi.fn().mockResolvedValue({
      name: 'invoice',
      label: 'Invoice',
      fields: {
        number: { name: 'number', type: 'text', label: 'Number' },
        status: { name: 'status', type: 'text', label: 'Status' },
      },
      listViews,
    }),
  };
}

const QTY = { name: 'qty', label: 'Qty', type: 'number' as const };

/**
 * For the member-pin rows: every object answered by NAME, so the child
 * collection has a schema of its own. `invoice_line` carries a lookup to BOTH
 * candidate parents, so which FK is derived says which parent name reached the
 * derive.
 */
const OBJECTS: Record<string, { name: string; label?: string; fields: Record<string, unknown>; listViews?: unknown }> = {
  invoice: {
    name: 'invoice',
    label: 'Invoice',
    fields: { number: { name: 'number', type: 'text', label: 'Number' } },
    listViews: { hot: HOT_VIEW },
  },
  order: { name: 'order', label: 'Order', fields: { code: { name: 'code', type: 'text', label: 'Code' } } },
  invoice_line: {
    name: 'invoice_line',
    fields: {
      order: { type: 'lookup', reference: 'order', label: 'Order' },
      invoice: { type: 'master_detail', reference: 'invoice', label: 'Invoice' },
      qty: { type: 'number', label: 'Qty' },
    },
  },
};

function makeObjectsAdapter() {
  return {
    find: vi.fn().mockResolvedValue({ data: [], total: 0 }),
    findOne: vi.fn().mockResolvedValue({ id: 'i1', number: 'INV-1' }),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    batchTransaction: vi.fn().mockResolvedValue({ results: [{ id: 'i1' }] }),
    getObjectSchema: vi.fn(async (name: string) => OBJECTS[name] ?? { name, fields: {} }),
  };
}

const renderBlock = (
  schema: Record<string, unknown>,
  adapter: ReturnType<typeof makeAdapter> | ReturnType<typeof makeObjectsAdapter>,
) =>
  render(
    <SchemaRendererProvider dataSource={adapter as any}>
      <SchemaRenderer schema={schema as any} />
    </SchemaRendererProvider>,
  );

describe('object-master-detail-form — dataSource: { object } (objectstack#7121)', () => {
  it('fetches the bound PARENT object’s schema, so the header form has fields', async () => {
    const adapter = makeAdapter();
    renderBlock(
      {
        type: 'object-master-detail-form',
        mode: 'create',
        details: DETAILS,
        dataSource: { object: 'invoice' },
      },
      adapter,
    );

    // No `view` in this binding, so the gate itself never reads the object
    // definition — this call can only be the parent form's.
    await waitFor(() => expect(adapter.getObjectSchema).toHaveBeenCalledWith('invoice'));
  });

  it('honours `object` and nothing else the binding may carry', async () => {
    const adapter = makeAdapter();
    const { container } = renderBlock(
      {
        type: 'object-master-detail-form',
        mode: 'create',
        details: DETAILS,
        dataSource: {
          object: 'invoice',
          view: 'hot',
          filter: [['owner', '=', 'me']],
          sort: [{ field: 'number', order: 'asc' }],
          limit: 3,
        },
      },
      adapter,
    );

    // The block mounted (its own section header is on screen) …
    await waitFor(() => expect(container.textContent).toContain('Invoice lines'));
    // … and the resolvable view contributed nothing: a create-mode master-detail
    // form issues no parent collection query for a filter/sort/limit to reach.
    expect(adapter.find.mock.calls.filter(([object]) => object === 'invoice')).toHaveLength(0);
    expect(
      container.querySelector('[data-testid="object-master-detail-form-datasource-error"]'),
    ).toBeNull();
  });

  it('reports an unresolvable `view` rather than rendering as if it resolved', async () => {
    const adapter = makeAdapter();
    const { container } = renderBlock(
      {
        type: 'object-master-detail-form',
        mode: 'create',
        details: DETAILS,
        dataSource: { object: 'invoice', view: 'nope' },
      },
      adapter,
    );

    await waitFor(() =>
      expect(
        container.querySelector('[data-testid="object-master-detail-form-datasource-error"]'),
      ).not.toBeNull(),
    );
    // The block is not mounted behind the error — no half-resolved header form.
    expect(container.textContent).not.toContain('Invoice lines');
    expect(container.textContent).toContain('hot');
  });

  it('leaves a master-detail form with NO dataSource exactly as it was', async () => {
    const adapter = makeAdapter();
    const { container } = renderBlock(
      {
        type: 'object-master-detail-form',
        objectName: 'invoice',
        mode: 'create',
        details: DETAILS,
      },
      adapter,
    );

    await waitFor(() => expect(adapter.getObjectSchema).toHaveBeenCalledWith('invoice'));
    expect(container.textContent).toContain('Invoice lines');
  });

  // ── the MEMBER-PIN rows (objectui#8071 slice 18) ─────────────────────────
  //
  // Registered as the member pin for `object-master-detail-form.dataSource`
  // after the four tests above were read end to end. They constrain WHICH
  // members this block honours. The rows below state where the honoured one
  // goes and what the others still do. See the docblock for the reasons.

  it('the `object` member OUTRANKS a flat `objectName` on the same node', async () => {
    const adapter = makeAdapter();
    renderBlock(
      {
        type: 'object-master-detail-form',
        objectName: 'order',
        mode: 'create',
        details: DETAILS,
        dataSource: { object: 'invoice' },
      },
      adapter,
    );

    await waitFor(() => expect(adapter.getObjectSchema).toHaveBeenCalledWith('invoice'));
    expect(
      adapter.getObjectSchema.mock.calls.map((call: unknown[]) => call[0]),
      'a `??=` read would fetch `order` and render the wrong parent with no diagnostic',
    ).not.toContain('order');
  });

  it('the bound object reaches the DETAIL half: the derived child FK and the batch’s parent leg both read it', async () => {
    const adapter = makeObjectsAdapter();
    const { container } = renderBlock(
      {
        type: 'object-master-detail-form',
        objectName: 'order',
        mode: 'create',
        // No `relationshipField`: the FK is derived from the child object, by
        // the PARENT object's name.
        details: [{ childObject: 'invoice_line', title: 'Invoice lines', columns: [QTY] }],
        dataSource: { object: 'invoice' },
      },
      adapter,
    );

    await waitFor(() => expect(container.textContent).toContain('Invoice lines'));
    // The parent form is the BOUND object's: its one field is `invoice.number`.
    const number = await waitFor(() => {
      const el = container.querySelector('input[name="number"]') as HTMLInputElement | null;
      if (!el) throw new Error('parent form not ready');
      return el;
    });
    fireEvent.change(number, { target: { value: 'INV-9' } });
    const qty = await waitFor(() => screen.getAllByLabelText('Qty')[0] as HTMLInputElement);
    fireEvent.change(qty, { target: { value: '5' } });
    fireEvent.click(screen.getByRole('button', { name: /^create$/i }));

    await waitFor(() => expect(adapter.batchTransaction).toHaveBeenCalledTimes(1));
    const ops = adapter.batchTransaction.mock.calls[0][0] as Array<Record<string, any>>;
    expect(ops[0], 'the parent leg writes the BOUND object').toEqual({
      object: 'invoice',
      action: 'create',
      data: { number: 'INV-9' },
    });
    expect(
      ops[1],
      '`invoice_line` has a lookup to both parents; the FK is the one to the bound object',
    ).toEqual({ object: 'invoice_line', action: 'create', data: { qty: 5, invoice: { $ref: 0 } } });
  });

  it('`filter` / `sort` / `limit` never reach the CHILD read: each line read is scoped by FK and capped at 500', async () => {
    const adapter = makeObjectsAdapter();
    renderBlock(
      {
        type: 'object-master-detail-form',
        mode: 'edit',
        recordId: 'i1',
        details: DETAILS,
        dataSource: {
          object: 'invoice',
          filter: [{ field: 'status', operator: 'equals', value: 'open' }],
          sort: [{ field: 'number', order: 'desc' }],
          limit: 3,
        },
      },
      adapter,
    );

    await waitFor(() => expect(adapter.find).toHaveBeenCalled());
    // Compared as a SET of distinct calls: the load re-runs once the entries
    // resolve, and the claim is what each read asks for.
    const distinct = () => [...new Set(adapter.find.mock.calls.map((call) => JSON.stringify(call)))];
    await waitFor(() =>
      expect(distinct()).toEqual([JSON.stringify(['invoice_line', { $filter: { invoice: 'i1' }, $top: 500 }])]),
    );
    expect(
      adapter.find.mock.calls.filter(([object]) => object === 'invoice'),
      'the parent is ONE record, read by id, so no collection query names it',
    ).toHaveLength(0);
    expect(adapter.findOne).toHaveBeenCalledWith('invoice', 'i1');
  });

  it('beside a named `view`, a malformed binding `filter` WITHHOLDS the form — unmapped is not unread', async () => {
    const adapter = makeAdapter();
    const { container } = renderBlock(
      {
        type: 'object-master-detail-form',
        mode: 'create',
        details: DETAILS,
        dataSource: {
          object: 'invoice',
          view: 'hot',
          // An array on a one-value operator: refused by the lowering the
          // view merge runs (objectui#8557).
          filter: [{ field: 'status', operator: 'equals', value: ['open'] }],
        },
      },
      adapter,
    );

    await waitFor(() =>
      expect(
        container.querySelector('[data-testid="object-master-detail-form-malformed-filter"]'),
      ).not.toBeNull(),
    );
    expect(container.textContent, 'the form is not mounted behind the notice').not.toContain('Invoice lines');
    expect(
      container.querySelector('[data-testid="object-master-detail-form-datasource-error"]'),
      'a refused filter is not an unresolvable view',
    ).toBeNull();
  });

  it('control: the same binding with a well-formed `filter` beside the view mounts the form', async () => {
    const adapter = makeAdapter();
    const { container } = renderBlock(
      {
        type: 'object-master-detail-form',
        mode: 'create',
        details: DETAILS,
        dataSource: {
          object: 'invoice',
          view: 'hot',
          filter: [{ field: 'status', operator: 'equals', value: 'open' }],
        },
      },
      adapter,
    );

    await waitFor(() => expect(container.textContent).toContain('Invoice lines'));
    expect(
      container.querySelector('[data-testid="object-master-detail-form-malformed-filter"]'),
    ).toBeNull();
  });
});

describe('object-master-detail-form — the unresolvable-view panel title reads the bundle (objectui#12920)', () => {
  it('under zh-CN the panel is titled in Chinese, not the English literal', async () => {
    const adapter = makeAdapter();
    const { container } = render(
      <I18nProvider persistLanguage={false} config={{ defaultLanguage: 'zh-CN', detectBrowserLanguage: false }}>
        <SchemaRendererProvider dataSource={adapter as any}>
          <SchemaRenderer schema={{ type: 'object-master-detail-form', mode: 'create', details: DETAILS, dataSource: { object: 'invoice', view: 'nope' } } as any} />
        </SchemaRendererProvider>
      </I18nProvider>,
    );

    await waitFor(() =>
      expect(container.querySelector('[data-testid="object-master-detail-form-datasource-error"]')).not.toBeNull(),
    );
    expect(container.querySelector('[data-testid="object-master-detail-form-datasource-error"] p.font-medium')?.textContent).toBe(
      '无法解析此表单的数据源',
    );
  });
});
