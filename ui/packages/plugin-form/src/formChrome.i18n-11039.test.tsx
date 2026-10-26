/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The form family's feedback chrome speaks the session locale (objectui#11039).
 *
 * The success toast (`Created` / `Saved`), the note it carries when a declared
 * `navigateOnSuccess` was refused, the thank-you heading, the loading line, the
 * load-failure heading and the default submit and cancel labels were English
 * literals in every presentation `object-form` routes to, so a zh session saw
 * `Loading form...`, `Created` and `Error loading form` beside a Chinese UI.
 * They now resolve through the i18n catalogue: `formChrome.ts` for the simple,
 * tabbed and split forms, and the tables `WizardForm`, `DrawerForm` and
 * `ModalForm` already had. The master-detail form's defaults are pinned in
 * `MasterDetailForm.i18nLabels.test.tsx`, the console form page's in
 * `apps/console`.
 *
 * Every case mounts `ObjectForm`, the node every presentation is reached
 * through, under a real `I18nProvider`. The zh cases first wait for a probe
 * OUTSIDE the form to read the zh catalogue, so each assertion runs under a
 * live zh pack and a leftover English string cannot be a loading artefact.
 *
 * Only the DEFAULTS are localized: an authored `successMessage`, `submitText`,
 * `cancelText` or thank-you `title` still renders as authored, whether it is a
 * plain string or an `I18nLabel` map (the `CONTROL` cases). The provider-less
 * path is the rest of this package's suite, which renders English from the
 * defaults tables; `en` below shows that the pack's English is that English.
 *
 * Measured against the merge-base containers (the pins at this head): every
 * zh case fails, because the literals render verbatim; the `en` case fails at
 * its first assertion, because the loading line was typed with three ASCII
 * full stops. Two of the three `CONTROL` cases pass there too — authored
 * values always won, so they are the must-not-change guards — and the third
 * fails only on the refused-navigation note, which is chrome, not authored.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup, act } from '@testing-library/react';

const { toasts, fakeToast } = vi.hoisted(() => {
  const toasts: Array<{ type: string; message: string; description?: string }> = [];
  const raise =
    (type: string) =>
    (message: unknown, options?: { description?: unknown }): string => {
      toasts.push({
        type,
        message: String(message),
        ...(options?.description === undefined ? {} : { description: String(options.description) }),
      });
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

import { I18nProvider, useObjectTranslation } from '@object-ui/i18n';
import type { DataSource } from '@object-ui/types';
import { registerAllFields } from '@object-ui/fields';
import { ObjectForm } from './ObjectForm';
import { NAVIGATE_ON_SUCCESS_REFUSED_NOTE } from './formChrome';

registerAllFields();

/** The zh pack's values, written out so the wording itself is under review. */
const ZH = {
  loading: '正在加载表单…',
  errorLoading: '表单加载失败',
  create: '创建',
  update: '更新',
  cancel: '取消',
  created: '已创建',
  saved: '已保存',
  thankYou: '感谢您的提交！',
  navigateRefused: '此表单声明的 `navigateOnSuccess` 跳转目标被拒绝，因此未执行跳转。',
};

/** Every English default this card moved, as it used to be typed. */
const ENGLISH_LITERALS = [
  'Loading form',
  'Error loading form',
  'Created',
  'Saved',
  'Thanks!',
  'Thank you',
  'was refused',
];

const ORDER_SCHEMA = {
  name: 'order',
  fields: { name: { type: 'text', label: 'Name' } },
};

const SECTIONS = [{ name: 'main', label: 'Main', fields: ['name'] }];

/** The presentations `object-form` routes to, and what each needs to reach one. */
const LAYOUTS = {
  simple: {},
  tabbed: { formType: 'tabbed', sections: SECTIONS },
  split: { formType: 'split', sections: SECTIONS },
  wizard: { formType: 'wizard', sections: SECTIONS },
  drawer: { formType: 'drawer' },
  modal: { formType: 'modal' },
} as const;
type Layout = keyof typeof LAYOUTS;

/** A schema read that never settles: the form stays on its loading line. */
const pendingDataSource = () => ({
  getObjectSchema: vi.fn(() => new Promise(() => {})),
  findOne: vi.fn(() => new Promise(() => {})),
  create: vi.fn(),
  update: vi.fn(),
});

/** A schema read that fails: the form shows its load-failure panel. */
const failingDataSource = () => ({
  getObjectSchema: vi.fn(async () => {
    throw new Error('schema read refused');
  }),
  findOne: vi.fn().mockResolvedValue(null),
  create: vi.fn(),
  update: vi.fn(),
});

/** Reads and writes that succeed. `omitId` makes a declared destination unresolvable. */
const okDataSource = (opts: { omitId?: boolean } = {}) => ({
  getObjectSchema: vi.fn(async () => ORDER_SCHEMA),
  findOne: vi.fn().mockResolvedValue({ id: 'r1', name: 'Alpha' }),
  find: vi.fn().mockResolvedValue({ data: [] }),
  create: vi.fn(async (_o: string, d: Record<string, unknown>) => (opts.omitId ? { ...d } : { id: 'r1', ...d })),
  update: vi.fn(async (_o: string, id: string, d: Record<string, unknown>) => ({ id, ...d })),
  delete: vi.fn(),
});

/**
 * Reads the active catalogue outside the form, for the zh-is-live wait. It reads
 * a key no case asserts, so the probe's own text can never satisfy one.
 */
function CatalogueProbe() {
  const { t } = useObjectTranslation();
  return <span data-testid="catalogue-probe">{t('common.next')}</span>;
}

function mount(
  language: string,
  properties: Record<string, unknown>,
  ds: ReturnType<typeof okDataSource> | ReturnType<typeof pendingDataSource> | ReturnType<typeof failingDataSource>,
) {
  const schema = { type: 'object-form', objectName: 'order', mode: 'create', ...properties };
  return render(
    <I18nProvider config={{ defaultLanguage: language, detectBrowserLanguage: false }}>
      <CatalogueProbe />
      <ObjectForm schema={schema as never} dataSource={ds as unknown as DataSource} />
    </I18nProvider>,
  );
}

/** Wait until the probe reads the zh pack. */
const zhIsLive = () =>
  waitFor(() => expect(screen.getByTestId('catalogue-probe').textContent).toBe('下一步'));

/** Everything on screen, portals (the drawer and the modal) included. */
const pageText = () => document.body.textContent ?? '';

/** The input the form draws for `name`, once the schema read has landed. */
const nameInput = () =>
  waitFor(() => {
    const el = document.body.querySelector('input[name="name"]') as HTMLInputElement | null;
    if (!el) throw new Error('name input not ready');
    return el;
  });

/** Type a new `name` and submit the form, then wait for the write. */
async function fillAndSubmit(ds: ReturnType<typeof okDataSource>, write: 'create' | 'update' = 'create') {
  fireEvent.change(await nameInput(), { target: { value: 'Beta' } });
  await act(async () => {
    fireEvent.submit(document.body.querySelector('form') as HTMLFormElement);
  });
  await waitFor(() => expect(ds[write]).toHaveBeenCalledTimes(1));
}

const successToasts = () => toasts.filter((t) => t.type === 'success');

beforeEach(() => {
  toasts.length = 0;
});

afterEach(() => {
  cleanup();
});

describe('form chrome resolves through the i18n catalogue (objectui#11039)', () => {
  it.each(['simple', 'tabbed', 'split', 'wizard', 'drawer'] as const)(
    'zh %s: the loading line is the zh pack\'s',
    async (layout: Layout) => {
      mount('zh', LAYOUTS[layout], pendingDataSource());
      await zhIsLive();

      await waitFor(() => expect(pageText()).toContain(ZH.loading));
      expect(pageText()).not.toContain('Loading form');
    },
  );

  it.each(['simple', 'tabbed', 'split', 'wizard', 'drawer', 'modal'] as const)(
    'zh %s: the load-failure heading is the zh pack\'s, above the error itself',
    async (layout: Layout) => {
      mount('zh', LAYOUTS[layout], failingDataSource());
      await zhIsLive();

      const heading = await screen.findByRole('heading', { name: ZH.errorLoading });
      expect(heading.parentElement?.textContent).toContain('schema read refused');
      expect(pageText()).not.toContain('Error loading form');
    },
  );

  it.each(['simple', 'tabbed', 'split', 'drawer', 'modal'] as const)(
    'zh %s: the default submit label is 创建 on a create and 更新 on an edit',
    async (layout: Layout) => {
      const create = mount('zh', LAYOUTS[layout], okDataSource());
      await zhIsLive();
      expect(await screen.findByRole('button', { name: ZH.create, hidden: true })).toBeTruthy();
      create.unmount();

      mount('zh', { ...LAYOUTS[layout], mode: 'edit', recordId: 'r1' }, okDataSource());
      await zhIsLive();
      expect(await screen.findByRole('button', { name: ZH.update, hidden: true })).toBeTruthy();
      expect(screen.queryByRole('button', { name: 'Update', hidden: true })).toBeNull();
    },
  );

  it.each(['drawer', 'modal'] as const)(
    'zh %s: the default cancel label is 取消',
    async (layout: Layout) => {
      mount('zh', LAYOUTS[layout], okDataSource());
      await zhIsLive();

      expect(await screen.findByRole('button', { name: ZH.cancel, hidden: true })).toBeTruthy();
      expect(screen.queryByRole('button', { name: 'Cancel', hidden: true })).toBeNull();
    },
  );

  it.each(['simple', 'wizard'] as const)(
    'zh %s: the default success toast is 已创建 after a create',
    async (layout: Layout) => {
      const ds = okDataSource();
      mount('zh', LAYOUTS[layout], ds);
      await zhIsLive();
      await fillAndSubmit(ds);

      await waitFor(() => expect(successToasts()).toHaveLength(1));
      expect(successToasts()[0]).toEqual({ type: 'success', message: ZH.created });
    },
  );

  it('zh simple: the default success toast is 已保存 after an edit', async () => {
    const ds = okDataSource();
    mount('zh', { mode: 'edit', recordId: 'r1' }, ds);
    await zhIsLive();
    await fillAndSubmit(ds, 'update');

    await waitFor(() => expect(successToasts()).toHaveLength(1));
    expect(successToasts()[0].message).toBe(ZH.saved);
  });

  it.each(['simple', 'wizard'] as const)(
    'zh %s: a thank-you behaviour with no title shows the zh heading, over the default message',
    async (layout: Layout) => {
      const ds = okDataSource();
      mount('zh', { ...LAYOUTS[layout], submitBehavior: { kind: 'thank-you' } }, ds);
      await zhIsLive();
      await fillAndSubmit(ds);

      expect(await screen.findByRole('heading', { name: ZH.thankYou })).toBeTruthy();
      expect(pageText()).toContain(ZH.created);
      for (const english of ENGLISH_LITERALS) expect(pageText()).not.toContain(english);
    },
  );

  it.each(['simple', 'wizard'] as const)(
    'zh %s: a refused navigateOnSuccess rides the zh toast as the zh note',
    async (layout: Layout) => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const ds = okDataSource({ omitId: true });
      mount('zh', { ...LAYOUTS[layout], navigateOnSuccess: '/apps/x/o/record/{id}' }, ds);
      await zhIsLive();
      await fillAndSubmit(ds);

      await waitFor(() => expect(successToasts()).toHaveLength(1));
      expect(successToasts()[0]).toEqual({
        type: 'success',
        message: ZH.created,
        description: ZH.navigateRefused,
      });
      warn.mockRestore();
    },
  );

  it('CONTROL zh: an authored successMessage map and a plain submitText render as authored', async () => {
    const ds = okDataSource();
    mount('zh', {
      successMessage: { en: 'Order logged', 'zh-CN': '订单已登记' },
      submitText: 'Log order',
    }, ds);
    await zhIsLive();

    expect(await screen.findByRole('button', { name: 'Log order', hidden: true })).toBeTruthy();
    expect(screen.queryByRole('button', { name: ZH.create, hidden: true })).toBeNull();
    await fillAndSubmit(ds);

    await waitFor(() => expect(successToasts()).toHaveLength(1));
    expect(successToasts()[0].message).toBe('订单已登记');
  });

  it('CONTROL zh: an authored submitText map and a plain successMessage render as authored, and the note still speaks zh', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const ds = okDataSource({ omitId: true });
    mount('zh', {
      ...LAYOUTS.wizard,
      submitText: { en: 'Log order', 'zh-CN': '登记订单' },
      successMessage: 'Logged',
      navigateOnSuccess: '/apps/x/o/record/{id}',
    }, ds);
    await zhIsLive();

    expect(await screen.findByRole('button', { name: '登记订单', hidden: true })).toBeTruthy();
    expect(screen.queryByRole('button', { name: ZH.create, hidden: true })).toBeNull();
    await fillAndSubmit(ds);

    await waitFor(() => expect(successToasts()).toHaveLength(1));
    // The message is the author's; the note is chrome, so it is the pack's.
    expect(successToasts()[0]).toEqual({ type: 'success', message: 'Logged', description: ZH.navigateRefused });
    warn.mockRestore();
  });

  it('CONTROL zh: an authored thank-you title and cancelText map render as authored', async () => {
    const ds = okDataSource();
    mount('zh', { submitBehavior: { kind: 'thank-you', title: 'All done' } }, ds);
    await zhIsLive();
    await fillAndSubmit(ds);
    expect(await screen.findByRole('heading', { name: 'All done' })).toBeTruthy();
    expect(pageText()).not.toContain(ZH.thankYou);
    cleanup();

    mount('zh', { ...LAYOUTS.drawer, cancelText: { en: 'Back', 'zh-CN': '放弃编辑' } }, okDataSource());
    await zhIsLive();
    expect(await screen.findByRole('button', { name: '放弃编辑', hidden: true })).toBeTruthy();
    expect(screen.queryByRole('button', { name: ZH.cancel, hidden: true })).toBeNull();
  });

  it('en: the pack\'s English is the English these forms rendered, with the typographic ellipsis', async () => {
    const pending = mount('en', {}, pendingDataSource());
    await waitFor(() => expect(pageText()).toContain('Loading form…'));
    expect(pageText()).not.toContain('Loading form...');
    pending.unmount();

    const failing = mount('en', {}, failingDataSource());
    expect(await screen.findByRole('heading', { name: 'Error loading form' })).toBeTruthy();
    failing.unmount();

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const ds = okDataSource({ omitId: true });
    mount('en', { navigateOnSuccess: '/apps/x/o/record/{id}' }, ds);
    expect(await screen.findByRole('button', { name: 'Create', hidden: true })).toBeTruthy();
    await fillAndSubmit(ds);
    await waitFor(() => expect(successToasts()).toHaveLength(1));
    expect(successToasts()[0]).toEqual({
      type: 'success',
      message: 'Created',
      description: NAVIGATE_ON_SUCCESS_REFUSED_NOTE,
    });
    warn.mockRestore();
    cleanup();

    const thanks = okDataSource();
    mount('en', { submitBehavior: { kind: 'thank-you' } }, thanks);
    await fillAndSubmit(thanks);
    expect(await screen.findByRole('heading', { name: 'Thank you!' })).toBeTruthy();
  });
});
