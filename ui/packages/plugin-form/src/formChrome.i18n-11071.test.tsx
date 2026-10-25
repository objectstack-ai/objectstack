/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The master-detail form's chrome, its modal host's accessible description and
 * the locked-field hint speak the session locale (objectui#11071).
 *
 * `objectui#11039` moved the form family's feedback chrome onto the pack keys
 * and named this half in its acceptance notes as read from source but not
 * measured. Measured under a `zh` session on the parent commit, every one of
 * these rendered English inside a Chinese UI:
 *
 *   - `MasterDetailForm`: `Loading columns…`, the `Subtotal` / `Tax (N%)` /
 *     `Total` stack, the row editor's `Line item — row N` title, its `Apply`
 *     and `Close`, the in-form collection's `Add`, and the Save button's
 *     in-flight `Saving…`;
 *   - `ModalForm`: the sr-only description of a master-detail dialog;
 *   - `ObjectForm`: the hint under a field the caller may read but not write.
 *
 * They now read the catalogue. Only the DEFAULTS move — each `CONTROL` case
 * pins the other half: a value the author wrote (a collection `title`, an
 * `addLabel`, a dialog `description`, a field `description`) renders exactly as
 * written under the same zh session.
 *
 * The provider-less path (English from the defaults tables) is exercised by the
 * other `MasterDetailForm.*.test.tsx` files, which render without a provider
 * and find these controls by their English names.
 *
 * A string is not asserted where it was ALREADY localised, and none of these
 * were: the `Save` / `Cancel` labels around them came from the catalogue since
 * objectui#11039 and are not touched here.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import * as React from 'react';
import { render, screen, waitFor, cleanup, fireEvent, within, act } from '@testing-library/react';
import { I18nProvider } from '@object-ui/i18n';
import { registerAllFields } from '@object-ui/fields';

// `ObjectForm`'s field gate reads the caller's field permissions. A stable
// stub (the real hook memoises for the same reason — `perms` sits in dependency
// arrays): `salary` is readable but not writable, every other field is open.
const { permsStub } = vi.hoisted(() => ({
  permsStub: {
    isLoaded: true,
    // Readable but not writable: an explicit field-level `editable: false`
    // refuses the insert question (`create`) and the update one (`write`)
    // alike (objectui#12082).
    checkField: (_object: string, field: string, op: string) => !(field === 'salary' && op !== 'read'),
    can: () => true,
    getObjectApiOperations: () => undefined,
  },
}));
vi.mock('@object-ui/permissions', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@object-ui/permissions')>();
  return { ...actual, usePermissions: () => permsStub };
});

import { MasterDetailForm } from './MasterDetailForm';
import { ModalForm } from './ModalForm';
import { ObjectForm } from './ObjectForm';

registerAllFields();

afterEach(() => cleanup());

const PARENT = 'po';
const parentSchema = {
  name: PARENT,
  fields: {
    ref: { type: 'text', label: 'Ref' },
    // Present so the Subtotal / Tax / Total stack renders.
    tax_rate: { type: 'number', label: 'Tax Rate' },
  },
};
const childSchema = {
  name: 'po_line',
  fields: {
    line_total: { type: 'number', label: 'Line Total' },
    memo: { type: 'text', label: 'Memo' },
    po: { type: 'master_detail', label: 'PO', reference: PARENT },
  },
};

/** A fully authored collection: nothing about it is derived or pending. */
const DETAIL = {
  childObject: 'po_line',
  relationshipField: 'po',
  amountField: 'line_total',
  columns: [{ name: 'line_total', label: 'Line Total', type: 'number' }],
};

/** In-form editing: the grid becomes a list, "Add" opens the row editor. */
const FORM_DETAIL = {
  childObject: 'po_line',
  relationshipField: 'po',
  inlineMode: 'form',
  columns: [{ name: 'line_total', label: 'Line Total', type: 'number' }],
  formFields: ['line_total', 'memo'],
};

function makeDataSource(overrides: Record<string, unknown> = {}) {
  return {
    getObjectSchema: vi.fn(async (o: string) => (o === 'po_line' ? childSchema : parentSchema)),
    findOne: vi.fn().mockResolvedValue({ id: 'po1', ref: 'PO-1' }),
    find: vi.fn().mockResolvedValue({ data: [] }),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    bulk: vi.fn(),
    batchTransaction: vi.fn(),
    ...overrides,
  } as never;
}

function inZh(node: React.ReactNode) {
  return render(
    <I18nProvider config={{ defaultLanguage: 'zh', detectBrowserLanguage: false }}>{node}</I18nProvider>,
  );
}

function masterDetail(details: unknown[], extra: Record<string, unknown> = {}, ds = makeDataSource()) {
  return inZh(
    <MasterDetailForm
      schema={{ objectName: PARENT, mode: 'create', fields: ['ref', 'tax_rate'], details, ...extra } as never}
      dataSource={ds}
    />,
  );
}

describe('MasterDetailForm chrome resolves through the i18n catalogue (objectui#11071)', () => {
  it('zh: the document totals stack reads 小计 / 税额 / 合计', async () => {
    masterDetail([DETAIL]);

    const totals = await screen.findByTestId('md-totals');
    expect(within(totals).getByText('小计')).toBeInTheDocument();
    expect(within(totals).getByText(/^税额/)).toBeInTheDocument();
    expect(within(totals).getByText('合计')).toBeInTheDocument();
    // The rate is the record's, spliced into the pack's frame.
    expect(totals.textContent).toContain('0%');
    for (const english of ['Subtotal', 'Tax', 'Total']) expect(totals.textContent).not.toContain(english);
  });

  it('zh: a collection whose columns are still resolving reads 正在加载列…', async () => {
    // The child schema never arrives, so the entry stays in its pending state:
    // the message is TRUE here (the columns are loading), which is why it is a
    // catalogue string and not something to delete.
    const ds = makeDataSource({
      getObjectSchema: vi.fn(async (o: string) => (o === PARENT ? parentSchema : new Promise(() => {}))),
    });
    masterDetail([{ childObject: 'po_line', title: 'PO lines' }], {}, ds);

    expect(await screen.findByText('正在加载列…')).toBeInTheDocument();
    expect(document.body.textContent).not.toContain('Loading columns');
  });

  it('zh: the in-form collection offers 添加, and its row editor reads 明细行 — 第 1 行 / 应用 / 关闭', async () => {
    masterDetail([FORM_DETAIL]);

    const add = await screen.findByRole('button', { name: /^添加$/ });
    fireEvent.click(add);

    const editor = await screen.findByTestId('md-row-form');
    expect(editor.textContent).toContain('明细行');
    expect(editor.textContent).toContain('第 1 行');
    // The row form inside the editor loads its own schema first.
    expect(await within(editor).findByRole('button', { name: '应用' })).toBeInTheDocument();
    expect(within(editor).getByRole('button', { name: '关闭' })).toBeInTheDocument();
    for (const english of ['Line item', 'row 1', 'Apply', 'Close']) expect(editor.textContent).not.toContain(english);
    expect(screen.queryByRole('button', { name: 'Add' })).toBeNull();
  });

  it('CONTROL zh: an authored `title` and `addLabel` render as authored', async () => {
    masterDetail([{ ...FORM_DETAIL, title: 'Order lines', addLabel: 'New line' }]);

    fireEvent.click(await screen.findByRole('button', { name: 'New line' }));

    const editor = await screen.findByTestId('md-row-form');
    // The authored title stays; only the row-number frame around it is the pack's.
    expect(editor.textContent).toContain('Order lines');
    expect(editor.textContent).toContain('第 1 行');
    expect(editor.textContent).not.toContain('明细行');
    expect(screen.queryByRole('button', { name: /^添加$/ })).toBeNull();
  });

  it('zh: the Save button reads 保存中… while the save is in flight', async () => {
    // A batch that never settles: the button stays in its in-flight state.
    const batchTransaction = vi.fn(() => new Promise(() => {}));
    const ds = makeDataSource({ batchTransaction });
    const { container } = masterDetail([DETAIL], { mode: 'edit', recordId: 'po1' }, ds);

    // The header record has loaded and a line has been typed, so the save has
    // something to send.
    await waitFor(() => expect((container.querySelector('input[name="ref"]') as HTMLInputElement)?.value).toBe('PO-1'));
    const cell = (await screen.findAllByLabelText('Line Total'))[0];
    fireEvent.change(cell, { target: { value: '5' } });
    await waitFor(() => expect(screen.getByTestId('md-form-submit')).not.toBeDisabled());
    await act(async () => {
      fireEvent.click(screen.getByTestId('md-form-submit'));
    });

    await waitFor(() => expect(batchTransaction).toHaveBeenCalledTimes(1));
    expect(screen.getByTestId('md-form-submit').textContent).toBe('保存中…');
    expect(document.body.textContent).not.toContain('Saving');
  });
});

describe('ModalForm: a master-detail dialog is described in the session language (objectui#11071)', () => {
  const dialog = (extra: Record<string, unknown> = {}) =>
    inZh(
      <ModalForm
        schema={
          {
            objectName: PARENT,
            mode: 'create',
            title: 'New order',
            open: true,
            onOpenChange: vi.fn(),
            subforms: [DETAIL],
            ...extra,
          } as never
        }
        dataSource={makeDataSource()}
      />,
    );

  it('zh: the sr-only description is the pack sentence', async () => {
    dialog();

    const modal = await screen.findByRole('dialog');
    await waitFor(() => expect(modal).toHaveAccessibleDescription('填写记录及其明细行，然后保存。'));
    expect(modal.textContent).not.toContain('Enter the record');
  });

  it('CONTROL zh: an authored `description` is what the dialog is described by', async () => {
    dialog({ description: 'Raise a purchase order' });

    const modal = await screen.findByRole('dialog');
    await waitFor(() => expect(modal).toHaveAccessibleDescription('Raise a purchase order'));
  });
});

describe('ObjectForm: the hint under a read-only field is in the session language (objectui#11071)', () => {
  const salaryForm = (fieldDescription?: string) =>
    inZh(
      <ObjectForm
        schema={
          {
            type: 'object-form',
            objectName: 'hr_person',
            mode: 'edit',
            recordId: 'p1',
          } as never
        }
        dataSource={
          {
            getObjectSchema: vi.fn().mockResolvedValue({
              name: 'hr_person',
              fields: {
                salary: { type: 'number', label: 'Salary', ...(fieldDescription ? { description: fieldDescription } : {}) },
              },
            }),
            findOne: vi.fn().mockResolvedValue({ id: 'p1', salary: 100 }),
            update: vi.fn(),
          } as never
        }
      />,
    );

  it('zh: a field the caller may read but not write says so in Chinese', async () => {
    salaryForm();

    expect(await screen.findByText('您没有此字段的编辑权限。')).toBeInTheDocument();
    expect(document.body.textContent).not.toContain('edit access');
  });

  it('CONTROL zh: a description the field metadata declares is what the field shows', async () => {
    salaryForm('Set by finance');

    expect(await screen.findByText('Set by finance')).toBeInTheDocument();
    expect(document.body.textContent).not.toContain('您没有此字段的编辑权限');
  });
});
