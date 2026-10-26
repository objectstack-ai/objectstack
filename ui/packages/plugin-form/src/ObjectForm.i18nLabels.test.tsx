/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `object-form`'s seven `I18nLabel` members — `title`, `description`,
 * `submitText`, `cancelText`, `nextText`, `prevText` and `successMessage` —
 * resolved before any presentation reads them (objectui#10993).
 *
 * `@objectstack/spec` types all seven as `I18nLabel` in
 * `ComponentPropsMap['object-form']`: a plain string or an inline per-locale
 * map. `ObjectForm` used to hand them raw to whichever presentation its
 * `formType` picked, and every presentation that renders one did so as a React
 * child, so a map threw "Objects are not valid as a React child" and the node
 * rendered `Component "form" failed to render` instead of a form. `ObjectForm`
 * now resolves all seven with `pickLocalized` against the active UI language,
 * once, above its `formType` fork.
 *
 * Every row mounts the node through the real `SchemaRenderer` and the real
 * registry, in the `{ type, properties }` form the spec row describes, under an
 * `I18nProvider` whose UI language is `zh`. Every map lists `en` FIRST, so a
 * resolver that fell back to `en` or to the first entry would paint English
 * and fail the row: the rows can pass only by following the active language.
 * Each member is read in at least one presentation that displays it: the
 * simple form's buttons and success toast, the wizard's step buttons, the
 * tabbed and split forms' Save button, and the drawer and modal headings and
 * footers.
 *
 * The plain-string rows and the nothing-authored row are the controls. A
 * string stays exactly what was authored, and with nothing authored the simple
 * form shows the zh pack's own defaults: its default Save label and success
 * toast read the i18n catalogue since objectui#11039, as the wizard's have
 * since objectui#10999 (`formChrome.i18n-11039.test.tsx` and
 * `WizardForm.i18nChrome-10999.test.tsx` pin those). Every map below has a
 * `zh` entry that differs from the zh pack's default for the same slot, so a
 * map that was dropped instead of resolved cannot pass.
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
import type { DataSource, ObjectFormBlockNode } from '@object-ui/types';
import { registerAllFields } from '@object-ui/fields';
// Registers `object-form` — the block under test.
import './index';

registerAllFields();

const ORDER_SCHEMA = {
  name: 'order',
  fields: {
    ref: { type: 'text', label: 'Ref' },
    note: { type: 'text', label: 'Note' },
  },
};

/** `en` first on purpose — see the file header. */
const TITLE_MAP = { en: 'New order', 'zh-CN': '新建订单' };
const DESCRIPTION_MAP = { en: 'Enter the order details', 'zh-CN': '填写订单信息' };
const SUBMIT_MAP = { en: 'Save order', 'zh-CN': '保存订单' };
const CANCEL_MAP = { en: 'Back', 'zh-CN': '放弃编辑' };
const NEXT_MAP = { en: 'Continue', 'zh-CN': '继续' };
// Not '上一步': that is the zh pack's own `wizard.back`, the wizard's default
// (objectui#10999), so a map dropped rather than resolved would still pass.
const PREV_MAP = { en: 'Previous', 'zh-CN': '回到上一步' };
const SUCCESS_MAP = { en: 'Order saved', 'zh-CN': '订单已保存' };

/** Two wizard steps, one field each, neither required. */
const STEPS = [
  { name: 'one', label: 'One', fields: ['ref'] },
  { name: 'two', label: 'Two', fields: ['note'] },
];

function makeDataSource() {
  return {
    getObjectSchema: vi.fn(async () => ORDER_SCHEMA),
    findOne: vi.fn().mockResolvedValue(null),
    find: vi.fn().mockResolvedValue({ data: [] }),
    create: vi.fn(async (_o: string, data: Record<string, unknown>) => ({ id: 'o1', ...data })),
    update: vi.fn(),
    delete: vi.fn(),
  };
}

/** A JSON document: the node and its `properties` bag, nothing a host adds. */
type FormBag = NonNullable<ObjectFormBlockNode['properties']>;

const doc = (properties: Partial<FormBag>): ObjectFormBlockNode => ({
  type: 'object-form',
  properties: { objectName: 'order', mode: 'create', ...properties },
});

/**
 * Mount a node through the real `SchemaRenderer` under a `zh` UI.
 *
 * The render and the adapter's first answers land inside one `act` scope, so
 * the schema read the form starts on mount has committed before the row reads
 * the DOM.
 */
async function mount(properties: Partial<FormBag>) {
  const ds = makeDataSource();
  let view!: ReturnType<typeof render>;
  await act(async () => {
    view = render(
      <I18nProvider config={{ defaultLanguage: 'zh', detectBrowserLanguage: false, resources: {} }}>
        <SchemaRendererProvider dataSource={ds as unknown as DataSource}>
          <SchemaRenderer schema={doc(properties)} />
        </SchemaRendererProvider>
      </I18nProvider>,
    );
  });
  return { ...view, ds };
}

/** The node's own failure card, which is what a raw map rendered before. */
const failureCard = () => screen.queryByText(/failed to render/);

/** The text of every button currently in the document, in DOM order. */
const buttonTexts = () =>
  screen.queryAllByRole('button', { hidden: true }).map((b) => (b.textContent ?? '').trim());

/** Wait for a button with exactly this text. */
const button = (name: string) => screen.findByRole('button', { name, hidden: true });

beforeEach(() => {
  toasts.length = 0;
});

afterEach(() => {
  cleanup();
});

describe('object-form — the seven I18nLabel members resolve against the UI language (objectui#10993)', () => {
  it('simple: a locale-map `submitText` and `cancelText` label the form buttons', async () => {
    const { container } = await mount({ submitText: SUBMIT_MAP, cancelText: CANCEL_MAP });

    expect(await button('保存订单')).toBeTruthy();
    expect(await button('放弃编辑')).toBeTruthy();
    expect(failureCard()).toBeNull();
    expect(container.innerHTML).not.toContain('[object Object]');
  });

  it('simple: a locale-map `successMessage` is the create toast', async () => {
    const { ds } = await mount({ successMessage: SUCCESS_MAP });

    const save = (await button('创建')) as HTMLButtonElement;
    await act(async () => {
      fireEvent.click(save);
    });
    await waitFor(() => expect(ds.create).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(toasts.filter((t) => t.type === 'success')).toHaveLength(1));
    expect(toasts.filter((t) => t.type === 'success').map((t) => t.message)).toEqual(['订单已保存']);
  });

  it('wizard: a locale-map `nextText` and `prevText` label the step buttons', async () => {
    const { container } = await mount({
      formType: 'wizard',
      sections: STEPS,
      nextText: NEXT_MAP,
      prevText: PREV_MAP,
    });

    const next = await button('继续');
    await act(async () => {
      fireEvent.click(next);
    });
    expect(await button('回到上一步')).toBeTruthy();
    expect(failureCard()).toBeNull();
    expect(container.innerHTML).not.toContain('[object Object]');
  });

  it.each(['tabbed', 'split'] as const)(
    '%s: a locale-map `submitText` labels the Save button',
    async (formType) => {
      const { container } = await mount({ formType, sections: STEPS, submitText: SUBMIT_MAP });

      expect(await button('保存订单')).toBeTruthy();
      expect(failureCard()).toBeNull();
      expect(container.innerHTML).not.toContain('[object Object]');
    },
  );

  it.each(['drawer', 'modal'] as const)(
    '%s: a locale-map `title` and `description` head the presentation, and the footer labels resolve',
    async (formType) => {
      await mount({
        formType,
        title: TITLE_MAP,
        description: DESCRIPTION_MAP,
        submitText: SUBMIT_MAP,
        cancelText: CANCEL_MAP,
      });

      const dialog = await screen.findByRole('dialog');
      await waitFor(() => expect(dialog.textContent).toContain('新建订单'));
      expect(dialog.textContent).toContain('填写订单信息');
      expect(await button('保存订单')).toBeTruthy();
      expect(await button('放弃编辑')).toBeTruthy();
      expect(failureCard()).toBeNull();
      expect(document.body.innerHTML).not.toContain('[object Object]');
    },
  );

  it('CONTROL: plain strings render exactly as authored (simple)', async () => {
    await mount({ submitText: 'Save PO', cancelText: 'Discard' });

    expect(await button('Save PO')).toBeTruthy();
    expect(await button('Discard')).toBeTruthy();
  });

  it('CONTROL: plain strings render exactly as authored (wizard)', async () => {
    await mount({ formType: 'wizard', sections: STEPS, nextText: 'Onward', prevText: 'Go back' });

    await act(async () => {
      fireEvent.click(await button('Onward'));
    });
    expect(await button('Go back')).toBeTruthy();
  });

  it('CONTROL: plain strings render exactly as authored (drawer)', async () => {
    await mount({ formType: 'drawer', title: 'New PO', description: 'PO details' });

    const dialog = await screen.findByRole('dialog');
    await waitFor(() => expect(dialog.textContent).toContain('New PO'));
    expect(dialog.textContent).toContain('PO details');
  });

  it('CONTROL: with nothing authored, the simple form shows the zh pack\'s defaults (objectui#11039)', async () => {
    const { ds } = await mount({});

    await act(async () => {
      fireEvent.click(await button('创建'));
    });
    await waitFor(() => expect(ds.create).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(toasts.filter((t) => t.type === 'success')).toHaveLength(1));
    expect(toasts.filter((t) => t.type === 'success').map((t) => t.message)).toEqual(['已创建']);
    expect(buttonTexts()).not.toContain('[object Object]');
  });
});
