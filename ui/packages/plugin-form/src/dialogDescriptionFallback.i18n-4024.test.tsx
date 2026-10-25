/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The create/edit dialog's `sr-only` description FALLBACK speaks the session
 * locale — objectui#4024 (migrated from objectstack#5084).
 *
 * `ModalForm.tsx:842` and `DrawerForm.tsx:642` emitted
 * "Complete the form fields, then submit or cancel." as a bare English literal
 * whenever the form declares no `description`. The card's field report is
 * careful about what this string is: it verified the text is CLIPPED
 * (`sr-only`), not a visible subtitle — so it is what a screen reader
 * announces as the dialog's accessible description and nothing else.
 *
 * That is exactly why an app cannot work around it. The only way to displace
 * the fallback is to author a `description`, which makes a VISIBLE subtitle
 * appear on every dialog. Adding visible UI to every form in order to remove an
 * invisible untranslated string is not a trade an app should have to make.
 *
 * ## Assertions go through the accessible description, not `getByText`
 *
 * The string's whole job is to be announced, so the test asks the same question
 * assistive tech asks: what is this dialog's accessible description? A
 * `getByText` would pass just as well on a visible paragraph, which is the bug
 * this fallback exists to avoid.
 *
 * ## Red-first prediction (written BEFORE the first run)
 *
 * Pre-fix, on `origin/main`:
 *   - both zh cases FAIL — the literal is rendered verbatim, so the dialog's
 *     accessible description is the English sentence and the expected Chinese
 *     one is absent;
 *   - the "authored description wins" case and the no-provider case PASS
 *     pre-fix and after — the fallback only ever applies when the form declares
 *     nothing, and the provider-less path must keep rendering English.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import * as React from 'react';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import { I18nProvider } from '@object-ui/i18n';
import { registerAllFields } from '@object-ui/fields';
import { ModalForm } from './ModalForm';
import { DrawerForm } from './DrawerForm';

registerAllFields();

afterEach(() => cleanup());

const ds: any = {
  getObjectSchema: vi.fn().mockResolvedValue({
    name: 'task',
    fields: { title: { type: 'text', label: 'Title' } },
  }),
  create: vi.fn().mockResolvedValue({ id: '1' }),
  update: vi.fn(),
  findOne: vi.fn(),
  find: vi.fn().mockResolvedValue([]),
};

const EN_FALLBACK = 'Complete the form fields, then submit or cancel.';
const ZH_FALLBACK = '填写表单字段,然后提交或取消。';

function inLocale(language: string, body: React.ReactElement) {
  return render(
    <I18nProvider config={{ defaultLanguage: language, detectBrowserLanguage: false }}>
      {body}
    </I18nProvider>,
  );
}

/**
 * The dialog's accessible description, resolved the way a screen reader does:
 * `aria-describedby` on the `dialog` node, dereferenced.
 *
 * Written by hand rather than via `toHaveAccessibleDescription` so the failure
 * message names the string actually found.
 */
async function accessibleDescription(): Promise<string> {
  const dialog = await screen.findByRole('dialog');
  const ids = (dialog.getAttribute('aria-describedby') ?? '').split(/\s+/).filter(Boolean);
  return ids
    .map((id) => dialog.ownerDocument.getElementById(id)?.textContent ?? '')
    .join(' ')
    .trim();
}

const modal = (description?: string) => (
  <ModalForm
    schema={
      {
        objectName: 'task',
        mode: 'create',
        open: true,
        title: 'New task',
        ...(description ? { description } : {}),
        onOpenChange: vi.fn(),
      } as any
    }
    dataSource={ds}
  />
);

const drawer = (description?: string) => (
  <DrawerForm
    schema={
      {
        objectName: 'task',
        mode: 'create',
        open: true,
        title: 'New task',
        ...(description ? { description } : {}),
        onOpenChange: vi.fn(),
      } as any
    }
    dataSource={ds}
  />
);

describe('form dialog sr-only description fallback resolves from the bundle (objectui#4024)', () => {
  it('zh-CN modal: the accessible description is the translated fallback', async () => {
    inLocale('zh', modal());
    await waitFor(async () => expect(await accessibleDescription()).toBe(ZH_FALLBACK));
  });

  it('zh-CN drawer: the accessible description is the translated fallback', async () => {
    inLocale('zh', drawer());
    await waitFor(async () => expect(await accessibleDescription()).toBe(ZH_FALLBACK));
  });

  it('en modal: unchanged English sentence (must-not-change)', async () => {
    inLocale('en', modal());
    await waitFor(async () => expect(await accessibleDescription()).toBe(EN_FALLBACK));
  });

  it('an authored description still wins over the fallback, in any locale', async () => {
    inLocale('zh', modal('Only the fields marked required.'));
    await waitFor(async () =>
      expect(await accessibleDescription()).toBe('Only the fields marked required.'),
    );
  });
});

/**
 * The English no-provider fallback is pinned in a FILE OF ITS OWN —
 * `dialogDescriptionFallback.i18n-4024.no-provider.test.tsx`. `createI18n`
 * registers a react-i18next module-global default that survives `cleanup()`, so
 * a no-provider case sharing this file would resolve against whichever locale
 * ran last (objectstack#5505/#5506, recorded on
 * `packages/components/src/__tests__/sheet-dialog-close-i18n.test.tsx`).
 */
