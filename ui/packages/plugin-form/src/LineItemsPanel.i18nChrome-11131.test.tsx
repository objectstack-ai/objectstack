/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The record page's `record:line_items` panel speaks the session locale
 * (objectui#11131).
 *
 * Measured under a `zh` session before this change, the panel rendered its
 * default title `Line Items`, its `Save` / `Saving…` button and its grid's
 * `Add line` in English beside a Chinese page. They now read the catalogue:
 * the title is `form.lineItems.title`, the button reuses `common.save` /
 * `detail.saving`, and the grid's Add button is `fields.grid.addLine`
 * (`GridField`, through the fields package's `useFieldTranslation`). A
 * read-only panel over no rows shows the grid's `fields.grid.noItems`.
 *
 * Only the DEFAULT moves. The `CONTROL` case pins the other half: a `title`
 * the author wrote renders exactly as written under the same zh session.
 *
 * English is held to the old literals by `pnpm check:i18n-keys` (every table
 * row and inline default equals its `en` value) and, provider-less, by the
 * `.no-provider` companion of this file.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import * as React from 'react';
import { render, screen, waitFor, cleanup, fireEvent, act } from '@testing-library/react';
import { I18nProvider } from '@object-ui/i18n';
import { registerAllFields } from '@object-ui/fields';
import { SchemaRendererProvider } from '@object-ui/react';
import { LineItemsPanel } from './LineItemsPanel';

registerAllFields();

afterEach(() => cleanup());

const schema = {
  childObject: 'po_line',
  relationshipField: 'po',
  parentObject: 'po',
  parentId: 'p1',
  columns: [{ name: 'amount', label: 'Amount', type: 'number' }],
};

function inZh(panelSchema: Record<string, unknown>, ds: unknown) {
  return render(
    <I18nProvider config={{ defaultLanguage: 'zh', detectBrowserLanguage: false }}>
      <SchemaRendererProvider dataSource={ds as never}>
        <LineItemsPanel schema={panelSchema as never} />
      </SchemaRendererProvider>
    </I18nProvider>,
  );
}

describe('record:line_items chrome resolves through the i18n catalogue (objectui#11131)', () => {
  it('zh: the default title, the Save / Saving… button and the grid\'s Add button read the zh pack', async () => {
    let land: () => void = () => {};
    const ds = {
      getObjectSchema: vi.fn().mockResolvedValue(null),
      find: vi.fn(async () => ({ data: [{ id: 'l1', amount: 10 }] })),
      batchTransaction: vi.fn(async (ops: Array<{ id?: string; data?: unknown }>) => {
        await new Promise<void>((r) => {
          land = r;
        });
        return { results: ops.map((op) => ({ id: op.id })) };
      }),
    };
    inZh(schema, ds);

    expect(await screen.findByText('明细行')).toBeInTheDocument();
    expect(screen.queryByText('Line Items')).toBeNull();
    expect(await screen.findByRole('button', { name: '添加行' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Add line/ })).toBeNull();

    // Idle: the save button reads the zh `common.save`.
    const save = screen.getByRole('button', { name: '保存' }) as HTMLButtonElement;
    await waitFor(() => expect((screen.getAllByLabelText('Amount')[0] as HTMLInputElement).value).toBe('10'));
    await act(async () => {
      fireEvent.change(screen.getAllByLabelText('Amount')[0], { target: { value: '15' } });
    });
    await waitFor(() => expect(save.disabled).toBe(false));

    // In flight: the same button reads the zh `detail.saving`.
    await act(async () => {
      fireEvent.click(save);
    });
    await waitFor(() => expect(ds.batchTransaction).toHaveBeenCalledTimes(1));
    expect(screen.getByRole('button', { name: '保存中…' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^(Save|Saving…)$/ })).toBeNull();

    await act(async () => {
      land();
    });
  });

  it('zh: a read-only panel over no rows shows the grid\'s zh empty state', async () => {
    const ds = {
      getObjectSchema: vi.fn().mockResolvedValue(null),
      find: vi.fn(async () => ({ data: [] })),
    };
    inZh({ ...schema, readonly: true }, ds);

    expect(await screen.findByText('暂无条目')).toBeInTheDocument();
    expect(screen.queryByText('No items')).toBeNull();
    // Read-only: no Save button at all, as before.
    expect(screen.queryByRole('button', { name: '保存' })).toBeNull();
  });

  it('CONTROL — an authored `title` renders as written under the zh session', async () => {
    const ds = {
      getObjectSchema: vi.fn().mockResolvedValue(null),
      find: vi.fn(async () => ({ data: [] })),
    };
    inZh({ ...schema, title: 'Order lines' }, ds);

    expect(await screen.findByText('Order lines')).toBeInTheDocument();
    expect(screen.queryByText('明细行')).toBeNull();
    // The rest of the chrome is still the pack's.
    expect(await screen.findByRole('button', { name: '添加行' })).toBeInTheDocument();
  });
});
