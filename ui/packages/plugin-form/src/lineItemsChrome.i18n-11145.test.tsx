/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The rest of the line-items chrome speaks the session locale (objectui#11145).
 *
 * objectui#11131 moved the record page's `record:line_items` panel's title and
 * Save button onto the packs. Measured under a `zh` session after it, three
 * sites still rendered English beside a Chinese page:
 *
 *   - a panel with no parent record bound: `Save the record first to add line
 *     items.`;
 *   - a panel with a `totalField`: its grid's footer `Total`;
 *   - `MasterDetailForm`, a collection that authors no `title`: its heading
 *     `Line Items`.
 *
 * Those three are pinned here, with the panel's other states from the same
 * card: its loading line, the rows held for another parent, the fallbacks for
 * a failed load or save (a message the server sent still wins), and the config
 * hint for a panel with no `childObject` (the property name stays code).
 *
 * Only the DEFAULTS move. The `CONTROL` cases pin the other half: a collection
 * `title` the author wrote renders exactly as written under the same zh
 * session, and so does a failure message the server wrote.
 *
 * The provider-less English is the `.no-provider` companion of this file. The
 * grid's own chrome (row actions, column chooser, computed cell) is
 * `GridField.i18nChrome-11145.test.tsx` in `@object-ui/fields`.
 */

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import * as React from 'react';
import { render, screen, waitFor, cleanup, fireEvent, act } from '@testing-library/react';
import { I18nProvider } from '@object-ui/i18n';
import { registerAllFields } from '@object-ui/fields';
import { SchemaRendererProvider } from '@object-ui/react';
import { LineItemsPanel } from './LineItemsPanel';
import { MasterDetailForm } from './MasterDetailForm';

registerAllFields();

beforeEach(() => {
  // The failure cases below are logged by the panel; keep the run readable.
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
  cleanup();
});

const PANEL = {
  childObject: 'po_line',
  relationshipField: 'po',
  parentObject: 'po',
  parentId: 'p1',
  columns: [{ name: 'amount', label: 'Amount', type: 'number' }],
};

function panelTree(panelSchema: Record<string, unknown>, ds: unknown) {
  return (
    <I18nProvider config={{ defaultLanguage: 'zh', detectBrowserLanguage: false }}>
      <SchemaRendererProvider dataSource={ds as never}>
        <LineItemsPanel schema={panelSchema as never} />
      </SchemaRendererProvider>
    </I18nProvider>
  );
}

function panelInZh(panelSchema: Record<string, unknown>, ds: unknown) {
  const view = render(panelTree(panelSchema, ds));
  return { ...view, rerenderPanel: (next: Record<string, unknown>) => view.rerender(panelTree(next, ds)) };
}

/** The banner above the grid: the first destructive paragraph. */
const banner = () => document.body.querySelector('p.text-destructive');

describe('record:line_items states and errors resolve through the i18n catalogue (objectui#11145)', () => {
  it('zh: a panel with no parent record bound reads 保存记录后才能添加明细行。', async () => {
    const ds = { getObjectSchema: vi.fn().mockResolvedValue(null), find: vi.fn() };
    panelInZh({ ...PANEL, parentId: undefined }, ds);

    expect(await screen.findByText('保存记录后才能添加明细行。')).toBeInTheDocument();
    expect(document.body.textContent).not.toContain('Save the record first');
    expect(ds.find).not.toHaveBeenCalled();
  });

  it('zh: the footer of a panel with a `totalField` reads 合计', async () => {
    const ds = {
      getObjectSchema: vi.fn().mockResolvedValue(null),
      find: vi.fn(async () => ({ data: [{ id: 'l1', amount: 10 }, { id: 'l2', amount: 5 }] })),
    };
    panelInZh({ ...PANEL, totalField: 'total', amountField: 'amount' }, ds);

    const total = await screen.findByTestId('line-items-total');
    await waitFor(() => expect(total.textContent).toBe('15'));
    expect(await screen.findByText('合计')).toBeInTheDocument();
    expect(screen.queryByText('Total')).toBeNull();
  });

  it('zh: the loading line reads the shared 加载中…', async () => {
    const ds = { getObjectSchema: vi.fn().mockResolvedValue(null), find: vi.fn(() => new Promise(() => {})) };
    panelInZh(PANEL, ds);

    expect(await screen.findByText('加载中…')).toBeInTheDocument();
    expect(document.body.textContent).not.toContain('Loading');
  });

  it('zh: a failed load the server did not describe reads 明细行加载失败', async () => {
    const ds = { getObjectSchema: vi.fn().mockResolvedValue(null), find: vi.fn().mockRejectedValue({}) };
    panelInZh(PANEL, ds);

    await waitFor(() => expect(banner()?.textContent).toBe('明细行加载失败'));
    expect(document.body.textContent).not.toContain('Failed to load');
  });

  it('CONTROL zh: a failed load the server described reads the server\'s words', async () => {
    const ds = {
      getObjectSchema: vi.fn().mockResolvedValue(null),
      find: vi.fn().mockRejectedValue(new Error('po_line is not readable')),
    };
    panelInZh(PANEL, ds);

    await waitFor(() => expect(banner()?.textContent).toBe('po_line is not readable'));
    expect(document.body.textContent).not.toContain('明细行加载失败');
  });

  it('zh: a failed save the server did not describe reads 明细行保存失败', async () => {
    const ds = {
      getObjectSchema: vi.fn().mockResolvedValue(null),
      find: vi.fn(async () => ({ data: [{ id: 'l1', amount: 10 }] })),
      batchTransaction: vi.fn().mockRejectedValue({}),
    };
    panelInZh(PANEL, ds);

    await waitFor(() => expect((screen.getAllByLabelText('Amount')[0] as HTMLInputElement).value).toBe('10'));
    await act(async () => {
      fireEvent.change(screen.getAllByLabelText('Amount')[0], { target: { value: '15' } });
    });
    const save = screen.getByRole('button', { name: '保存' }) as HTMLButtonElement;
    await waitFor(() => expect(save.disabled).toBe(false));
    await act(async () => {
      fireEvent.click(save);
    });

    await waitFor(() => expect(banner()?.textContent).toBe('明细行保存失败'));
    expect(ds.batchTransaction).toHaveBeenCalledTimes(1);
    expect(document.body.textContent).not.toContain('Failed to save');
  });

  it('zh: rows held for another parent read 此记录的明细行尚未加载。', async () => {
    let failSecond: (e: unknown) => void = () => {};
    const ds = {
      getObjectSchema: vi.fn().mockResolvedValue(null),
      find: vi
        .fn()
        .mockResolvedValueOnce({ data: [{ id: 'l1', amount: 10 }] })
        .mockImplementationOnce(
          () =>
            new Promise((_resolve, reject) => {
              failSecond = reject;
            }),
        ),
    };
    const view = panelInZh(PANEL, ds);

    // p1's line lands and is edited, so the panel holds it for p1.
    await waitFor(() => expect((screen.getAllByLabelText('Amount')[0] as HTMLInputElement).value).toBe('10'));
    await act(async () => {
      fireEvent.change(screen.getAllByLabelText('Amount')[0], { target: { value: '15' } });
    });

    // The panel moves to p2, whose load fails without a message.
    view.rerenderPanel({ ...PANEL, parentId: 'p2' });
    await waitFor(() => expect(ds.find).toHaveBeenCalledTimes(2));
    await act(async () => {
      failSecond({});
    });

    const held = await screen.findByTestId('line-items-held-for-another-parent');
    await waitFor(() => expect(held.textContent).toBe('此记录的明细行尚未加载。'));
    expect(banner()?.textContent).toBe('明细行加载失败');
    expect(document.body.textContent).not.toContain('have not been loaded');
  });

  it('zh: a panel with no `childObject` reads the zh hint, with the property name kept as code', async () => {
    const ds = { getObjectSchema: vi.fn().mockResolvedValue(null), find: vi.fn() };
    panelInZh({ ...PANEL, childObject: undefined }, ds);

    const hint = await screen.findByTestId('line-items-no-child-object');
    await waitFor(() =>
      expect(hint.textContent).toBe('此面板未配置子对象：请将 childObject 设为其所列行所属的对象。'),
    );
    // The property name is the one untranslated part, and it is still code.
    expect(hint.querySelector('code')?.textContent).toBe('childObject');
    expect(hint.textContent).not.toContain('{{property}}');
    expect(ds.find).not.toHaveBeenCalled();
  });
});

describe('MasterDetailForm: a collection with no `title` is headed in the session language (objectui#11145)', () => {
  const PARENT = 'po';
  const DETAIL = {
    childObject: 'po_line',
    relationshipField: 'po',
    columns: [{ name: 'line_total', label: 'Line Total', type: 'number' }],
  };

  function masterDetailInZh(details: unknown[]) {
    const ds = {
      getObjectSchema: vi.fn(async (o: string) =>
        o === 'po_line'
          ? {
              name: 'po_line',
              fields: {
                line_total: { type: 'number', label: 'Line Total' },
                po: { type: 'master_detail', label: 'PO', reference: PARENT },
              },
            }
          : { name: PARENT, fields: { ref: { type: 'text', label: 'Ref' } } },
      ),
      find: vi.fn().mockResolvedValue({ data: [] }),
      create: vi.fn(),
      update: vi.fn(),
      batchTransaction: vi.fn(),
    };
    return render(
      <I18nProvider config={{ defaultLanguage: 'zh', detectBrowserLanguage: false }}>
        <MasterDetailForm
          schema={{ objectName: PARENT, mode: 'create', fields: ['ref'], details } as never}
          dataSource={ds as never}
        />
      </I18nProvider>,
    );
  }

  const headings = () => Array.from(document.body.querySelectorAll('section > h3')).map((h) => h.textContent);

  it('zh: the heading of an untitled collection reads 明细行', async () => {
    masterDetailInZh([DETAIL]);

    await waitFor(() => expect(headings()).toEqual(['明细行']));
    expect(document.body.textContent).not.toContain('Line Items');
  });

  it('CONTROL zh: an authored collection `title` renders as written', async () => {
    masterDetailInZh([{ ...DETAIL, title: 'Order lines' }]);

    await waitFor(() => expect(headings()).toEqual(['Order lines']));
    expect(document.body.textContent).not.toContain('明细行');
  });
});
