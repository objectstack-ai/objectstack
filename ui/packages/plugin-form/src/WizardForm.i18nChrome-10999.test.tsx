/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * WizardForm's own chrome speaks the session locale (objectui#10999).
 *
 * The footer buttons (Cancel / Back / Next / Create / Update / Submitting…),
 * the "Step x of y" counter, the step indicator's fallback label and its
 * accessible name, and the empty-step notice were English literals, so a zh
 * console showed `Cancel`, `Step 1 of 3` and `Next` under a Chinese UI. They
 * now resolve through the i18n catalogue, the way the rest of plugin-form's
 * chrome does (`createSafeTranslation`).
 *
 * The four author keys — `cancelText`, `prevText`, `nextText`, `submitText` —
 * are plain strings and still win verbatim in every locale: only the DEFAULTS
 * are localized.
 *
 * The provider-less path (English from the defaults table) is exercised by the
 * other `WizardForm.*.test.tsx` files, which render without a provider and find
 * the footer by its English names. It is kept out of this file because a
 * provider mounted here leaves react-i18next's global instance behind.
 *
 * Against the parent commit's WizardForm: both zh-default cases fail (the
 * literals render verbatim); the en case fails only on the in-flight label,
 * which was typed with three ASCII full stops and is now the pack's U+2026
 * ellipsis (the `ellipsis-glyph-3878` convention); the authored case passes,
 * because author values always won — it is the must-not-change guard.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import * as React from 'react';
import { render, screen, cleanup, waitFor, fireEvent, act } from '@testing-library/react';
import { I18nProvider, useObjectTranslation } from '@object-ui/i18n';
import { registerAllFields } from '@object-ui/fields';
import { WizardForm, type WizardFormProps } from './WizardForm';

registerAllFields();

afterEach(() => cleanup());

const objectSchema = {
  name: 'wiz_obj',
  fields: {
    name: { type: 'text', label: 'Name' },
  },
};

/** `create` never settles, so the final button stays in its in-flight state. */
const makeDS = () => ({
  getObjectSchema: vi.fn().mockResolvedValue(objectSchema),
  create: vi.fn(() => new Promise(() => {})),
  update: vi.fn(() => new Promise(() => {})),
  findOne: vi.fn().mockResolvedValue({ id: 'r1', name: 'Alice' }),
});

/**
 * Two steps: the first declares no `label` (so the indicator falls back to the
 * localized step name), the second is a field-less review step (so the
 * empty-step notice shows). `allowSkip` lets a test jump to the last step
 * through the indicator without filling anything in.
 */
const baseSchema = {
  type: 'object-form',
  formType: 'wizard',
  objectName: 'wiz_obj',
  mode: 'create',
  allowSkip: true,
  sections: [
    { name: 'details', fields: ['name'] },
    { name: 'review', label: 'Review', fields: [] },
  ],
};

/**
 * Reads the active catalogue outside the wizard, so a case can wait for the zh
 * pack to be live without leaning on anything WizardForm renders.
 */
function CatalogueProbe() {
  const { t } = useObjectTranslation();
  return <span data-testid="catalogue-probe">{t('common.next')}</span>;
}

function mount(language: string, overrides: Record<string, unknown> = {}) {
  const ds = makeDS();
  const utils = render(
    <I18nProvider config={{ defaultLanguage: language, detectBrowserLanguage: false }}>
      <CatalogueProbe />
      <WizardForm
        schema={{ ...baseSchema, ...overrides } as unknown as WizardFormProps['schema']}
        dataSource={ds as unknown as WizardFormProps['dataSource']}
      />
    </I18nProvider>,
  );
  return { ds, ...utils };
}

const button = (name: string) => screen.getByRole('button', { name });

/**
 * Jump to the review step through the step indicator (`allowSkip`), then wait
 * for a text only that step renders.
 */
async function toLastStep(landmark: string) {
  fireEvent.click(screen.getByTestId('wizard-step:review'));
  await screen.findByText(landmark);
  await act(async () => {});
}

describe('WizardForm chrome resolves through the i18n catalogue (objectui#10999)', () => {
  it('zh: the footer defaults, the counter and the step indicator render Chinese', async () => {
    mount('zh');

    // First step. `findBy*` also waits out the lazy zh catalogue.
    await screen.findByRole('button', { name: '下一步' });
    expect(button('取消')).toBeTruthy();
    expect(screen.getByText('第 1 步，共 2 步')).toBeTruthy();
    expect(screen.getByRole('navigation', { name: '进度' })).toBeTruthy();
    // The unlabelled first step's indicator entry.
    expect(screen.getByTestId('wizard-step:details').textContent).toContain('第 1 步');

    await toLastStep('此步骤未配置字段');
    expect(screen.getByText('第 2 步，共 2 步')).toBeTruthy();
    expect(button('上一步')).toBeTruthy();
    const create = button('创建');

    await act(async () => {
      fireEvent.click(create);
    });
    await screen.findByRole('button', { name: '提交中…' });

    // None of the English defaults leaked through anywhere.
    const text = document.body.textContent ?? '';
    for (const english of ['Cancel', 'Next', 'Back', 'Create', 'Submitting', 'Step ', 'No fields configured']) {
      expect(text).not.toContain(english);
    }
  });

  it('zh: an edit wizard offers the localized Update', async () => {
    mount('zh', { mode: 'edit', recordId: 'r1' });

    await screen.findByRole('button', { name: '下一步' });
    await toLastStep('此步骤未配置字段');
    expect(button('更新')).toBeTruthy();
  });

  it('zh: authored cancelText / nextText / prevText / submitText render as authored', async () => {
    mount('zh', {
      cancelText: 'Abandon',
      nextText: 'Onward',
      prevText: 'Rewind',
      submitText: 'Launch project',
    });

    // The zh catalogue is live (read outside the wizard), and the wizard is up.
    await waitFor(() => expect(screen.getByTestId('catalogue-probe').textContent).toBe('下一步'));
    await screen.findByRole('button', { name: 'Onward' });
    expect(button('Abandon')).toBeTruthy();
    expect(screen.queryByRole('button', { name: '下一步' })).toBeNull();
    expect(screen.queryByRole('button', { name: '取消' })).toBeNull();

    // Landmark is an authored label, so this case reads only author keys.
    await toLastStep('Rewind');
    expect(button('Launch project')).toBeTruthy();
    expect(screen.queryByRole('button', { name: '上一步' })).toBeNull();
    expect(screen.queryByRole('button', { name: '创建' })).toBeNull();
  });

  it('en: the chrome still renders English', async () => {
    mount('en');

    await screen.findByRole('button', { name: 'Next' });
    expect(button('Cancel')).toBeTruthy();
    expect(screen.getByText('Step 1 of 2')).toBeTruthy();
    expect(screen.getByRole('navigation', { name: 'Progress' })).toBeTruthy();
    expect(screen.getByTestId('wizard-step:details').textContent).toContain('Step 1');

    await toLastStep('No fields configured for this step');
    expect(screen.getByText('Step 2 of 2')).toBeTruthy();
    expect(button('Back')).toBeTruthy();

    await act(async () => {
      fireEvent.click(button('Create'));
    });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Submitting…' })).toBeTruthy());
  });
});
