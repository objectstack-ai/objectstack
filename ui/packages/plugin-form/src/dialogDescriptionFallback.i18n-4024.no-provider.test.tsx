/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The form dialog's description fallback stays ENGLISH with no provider —
 * objectui#4024, and the #4514 trap.
 *
 * `ModalForm`/`DrawerForm` already own a `createSafeTranslation` table
 * (`useDiscardTranslation`), and the fallback sentence joins it rather than
 * arriving through a bare `useObjectTranslation` — so a provider-less host
 * announces the English sentence instead of `form.dialogDescriptionFallback`.
 *
 * Separate FILE, not a separate `it`: `createI18n` registers a react-i18next
 * module-global default that survives `cleanup()`, so a no-provider case
 * sharing a file with locale-mounted renders resolves against whichever locale
 * ran last (objectstack#5505/#5506).
 *
 * ## Red-first prediction (written BEFORE the first run)
 *
 * PASSES before and after — a must-not-change pin.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
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

async function accessibleDescription(): Promise<string> {
  const dialog = await screen.findByRole('dialog');
  const ids = (dialog.getAttribute('aria-describedby') ?? '').split(/\s+/).filter(Boolean);
  return ids
    .map((id) => dialog.ownerDocument.getElementById(id)?.textContent ?? '')
    .join(' ')
    .trim();
}

const schema = {
  objectName: 'task',
  mode: 'create',
  open: true,
  title: 'New task',
  onOpenChange: vi.fn(),
} as any;

describe('form dialog description fallback with no I18nProvider (objectui#4024 / #4514)', () => {
  it('modal announces the English sentence, never a raw bundle key', async () => {
    render(<ModalForm schema={schema} dataSource={ds} />);
    await waitFor(async () => expect(await accessibleDescription()).toBe(EN_FALLBACK));
  });

  it('drawer announces the English sentence, never a raw bundle key', async () => {
    render(<DrawerForm schema={schema} dataSource={ds} />);
    await waitFor(async () => expect(await accessibleDescription()).toBe(EN_FALLBACK));
  });
});
