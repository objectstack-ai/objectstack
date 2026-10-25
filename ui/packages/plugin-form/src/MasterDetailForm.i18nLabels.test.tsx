/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `object-master-detail-form`'s three `I18nLabel` members — `title`,
 * `submitText` and `cancelText` — resolved before they reach the screen
 * (objectui#10935).
 *
 * `@objectstack/spec` types all three as `I18nLabel` in
 * `ComponentPropsMap['object-master-detail-form']`, and objectui's validator
 * arms the node with that row by reference (objectui#10927). So a per-locale
 * map is a document the validator accepts, and the first row below asserts
 * exactly that for the documents the other rows mount. `MasterDetailForm` used
 * to read the three raw: a map rendered as a Button child threw "Objects are
 * not valid as a React child", and a map `title` toasted "[object Object]
 * saved".
 *
 * Every row mounts the node through the real `SchemaRenderer` and the real
 * registry, in the `{ type, properties }` form the spec row describes, under an
 * `I18nProvider` whose UI language is `zh`. Every map lists `en` FIRST, so a
 * resolver that fell back to `en` or to the first entry would paint English
 * and fail the row: the rows can pass only by following the active language.
 *
 * The plain-string rows and the nothing-authored rows are the controls. A
 * string stays exactly what was authored, and with nothing authored the zh
 * pack's own defaults show: the Save / Create / Cancel labels and the built-in
 * save toast read the i18n catalogue since objectui#11039, so under this `zh`
 * UI they are 保存 / 创建 / 取消 and 已保存, and a `title` is named in the zh
 * pack's `form.savedNamed` ("{{title}}已保存").
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup, act } from '@testing-library/react';

const { toasts, fakeToast } = vi.hoisted(() => {
  const toasts: Array<{ type: string; message: string }> = [];
  const raise =
    (type: string) =>
    (message: unknown): string => {
      toasts.push({ type, message: String(message) });
      return `toast:${toasts.length}`;
    };
  const fakeToast = Object.assign(raise('message'), {
    success: raise('success'),
    error: raise('error'),
    info: raise('info'),
    warning: raise('warning'),
    loading: raise('loading'),
    custom: raise('custom'),
    promise: (p: unknown) => p,
    dismiss: () => undefined,
  });
  return { toasts, fakeToast };
});

vi.mock('@object-ui/components/ui/sonner', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, toast: fakeToast };
});

import { I18nProvider } from '@object-ui/i18n';
import { SchemaRenderer, SchemaRendererProvider } from '@object-ui/react';
import type { DataSource, I18nLabel } from '@object-ui/types';
import { undeclaredNode } from '@object-ui/test-support';
import { safeValidateSchema } from '@object-ui/types/zod';
import { registerAllFields } from '@object-ui/fields';
// Registers `object-master-detail-form` — the block under test.
import './index';
import type { MasterDetailFormSchema } from './MasterDetailForm';

registerAllFields();

/**
 * The type half, checked by this package's `tsconfig.test.json` and erased at
 * runtime: the renderer's own schema type carries the row's `I18nLabel` for all
 * three members, so a host that builds the node in TypeScript can hand over a
 * map too. The tuple fails to compile if any member is narrowed back to
 * `string`, or widened past `I18nLabel`.
 */
type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
type Expect<T extends true> = T;
export type assertionLabelMembersAreI18nLabel = [
  Expect<Equal<MasterDetailFormSchema['title'], I18nLabel | undefined>>,
  Expect<Equal<MasterDetailFormSchema['submitText'], I18nLabel | undefined>>,
  Expect<Equal<MasterDetailFormSchema['cancelText'], I18nLabel | undefined>>,
];

const PO_SCHEMA = { name: 'po', fields: { ref: { type: 'text', label: 'Ref' } } };
const LINE_SCHEMA = {
  name: 'po_line',
  fields: {
    qty: { type: 'number', label: 'Qty' },
    po: { type: 'master_detail', label: 'PO', reference: 'po' },
  },
};

const DETAILS = [
  {
    childObject: 'po_line',
    relationshipField: 'po',
    columns: [{ name: 'qty', label: 'Qty', type: 'number' }],
  },
];

/** `en` first on purpose — see the file header. */
const TITLE_MAP = { en: 'Purchase order', 'zh-CN': '采购单' };
const SUBMIT_MAP = { en: 'Save order', 'zh-CN': '保存订单' };
const CANCEL_MAP = { en: 'Back', 'zh-CN': '返回' };

function makeDataSource() {
  return {
    getObjectSchema: vi.fn(async (o: string) => (o === 'po_line' ? LINE_SCHEMA : PO_SCHEMA)),
    findOne: vi.fn().mockResolvedValue({ id: 'po1', ref: 'PO-1' }),
    find: vi.fn().mockResolvedValue({ data: [] }),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    batchTransaction: vi.fn(async (ops: Array<{ id?: string; data?: Record<string, unknown> }>) => ({
      results: ops.map((op) => ({ id: op.id ?? 'new1', ...op.data })),
    })),
  };
}

/** A JSON document: the node and its `properties` bag, nothing a host adds. */
const doc = (properties: Record<string, unknown>) => ({
  type: 'object-master-detail-form',
  properties: { objectName: 'po', fields: ['ref'], details: DETAILS, ...properties },
});

/**
 * Mount a node through the real `SchemaRenderer` under a `zh` UI. `host` is
 * what a host adds beside the document: `onCancel` is a runtime slot a JSON
 * document cannot author, and the Cancel button renders only when it is set.
 */
function mount(properties: Record<string, unknown>, host: Record<string, unknown> = {}) {
  const ds = makeDataSource();
  const view = render(
    <I18nProvider config={{ defaultLanguage: 'zh', detectBrowserLanguage: false, resources: {} }}>
      <SchemaRendererProvider dataSource={ds as unknown as DataSource}>
        {/* `host` merges runtime slots (`onCancel`, a function) into the node, which
            no node type declares; it crosses through the one test helper for
            undeclared input (objectui#11466). */}
        <SchemaRenderer schema={undeclaredNode({ ...doc(properties), ...host })} />
      </SchemaRendererProvider>
    </I18nProvider>,
  );
  return { ...view, ds };
}

const submitButton = () => screen.findByTestId('md-form-submit');
const cancelButton = () => screen.findByTestId('md-form-cancel');

/** Edit mode: wait for the stored parent, press Save, return the toasts. */
async function saveEdit(container: HTMLElement, ds: ReturnType<typeof makeDataSource>) {
  await waitFor(() => {
    const ref = container.querySelector('input[name="ref"]') as HTMLInputElement | null;
    if (!ref || ref.value !== 'PO-1') throw new Error('parent record not loaded');
  });
  const save = (await submitButton()) as HTMLButtonElement;
  await waitFor(() => expect(save.disabled).toBe(false));
  await act(async () => {
    fireEvent.click(save);
  });
  await waitFor(() => expect(ds.batchTransaction).toHaveBeenCalledTimes(1));
  await waitFor(() => expect(toasts.filter((t) => t.type === 'success')).toHaveLength(1));
  return toasts.filter((t) => t.type === 'success').map((t) => t.message);
}

beforeEach(() => {
  toasts.length = 0;
});

afterEach(() => {
  cleanup();
});

describe('object-master-detail-form — `title` / `submitText` / `cancelText` are I18nLabel (objectui#10935)', () => {
  it('the locale-map documents these rows mount are ones the validator accepts', () => {
    const documents = [
      doc({ submitText: SUBMIT_MAP }),
      doc({ cancelText: CANCEL_MAP }),
      doc({ mode: 'edit', recordId: 'po1', title: TITLE_MAP }),
    ];
    for (const d of documents) {
      expect(safeValidateSchema(d).success, JSON.stringify(d.properties)).toBe(true);
    }
  });

  it('a locale-map `submitText` renders the active locale\'s text on the Save button', async () => {
    const { container } = mount({ submitText: SUBMIT_MAP });

    expect((await submitButton()).textContent).toBe('保存订单');
    expect(container.innerHTML).not.toContain('[object Object]');
  });

  it('a locale-map `cancelText` renders the active locale\'s text on the Cancel button', async () => {
    const onCancel = vi.fn();
    const { container } = mount({ cancelText: CANCEL_MAP }, { onCancel });

    const cancel = await cancelButton();
    expect(cancel.textContent).toBe('返回');
    expect(container.innerHTML).not.toContain('[object Object]');
    // The button is the host's: it still runs the host's handler.
    fireEvent.click(cancel);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('a locale-map `title` reads in the active locale in the edit-save toast', async () => {
    const { container, ds } = mount({ mode: 'edit', recordId: 'po1', title: TITLE_MAP });

    expect(await saveEdit(container, ds)).toEqual(['采购单已保存']);
    expect(container.innerHTML).not.toContain('[object Object]');
  });

  it('CONTROL: plain strings render exactly as authored', async () => {
    const { container, ds } = mount(
      { mode: 'edit', recordId: 'po1', title: 'PO', submitText: 'Save PO', cancelText: 'Discard' },
      { onCancel: vi.fn() },
    );

    expect((await submitButton()).textContent).toBe('Save PO');
    expect((await cancelButton()).textContent).toBe('Discard');
    expect(await saveEdit(container, ds)).toEqual(['PO已保存']);
  });

  it('CONTROL: with nothing authored, the zh pack\'s defaults show (objectui#11039)', async () => {
    const create = mount({}, { onCancel: vi.fn() });
    // `waitFor`, not a bare read: the zh catalogue loads after the first
    // render, and until it lands the fallback language answers.
    await waitFor(async () => expect((await submitButton()).textContent).toBe('创建'));
    expect((await cancelButton()).textContent).toBe('取消');
    create.unmount();

    const { container, ds } = mount({ mode: 'edit', recordId: 'po1' });
    await waitFor(async () => expect((await submitButton()).textContent).toBe('保存'));
    expect(await saveEdit(container, ds)).toEqual(['已保存']);
  });
});
