// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#26732 — the field inspector's Description and Help text
 * textareas are named by their visible labels.
 *
 * Before: the local `TextareaField` drew its `<Label>` beside the textarea
 * without closing the pair, so assistive tech read two anonymous edit fields
 * and clicking a label focused nothing. It now closes the pair the way
 * `_shared.tsx`'s form atoms do (`htmlFor` ⇄ a per-instance `useId()`).
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

vi.mock('../useMetadata', () => ({
  useMetadataClient: () => ({
    withPreviewDrafts: () => ({ list: vi.fn().mockResolvedValue([]) }),
  }),
}));

vi.mock('../previews/useObjectFields', () => ({
  useObjectFields: () => ({ fields: [], loading: false, error: null }),
}));

import { ObjectFieldInspector } from './ObjectFieldInspector';
import { t, type SupportedLocale } from '../i18n';
// `designer.field.description` / `designer.field.helpText` live in
// `@object-ui/i18n`'s `studio` namespace, whose `zh` catalogue is fetched on
// demand. Resident before any case, so the zh names are read after it lands.
import { loadStudioCatalogue } from '@object-ui/i18n/namespaces/studio';
await loadStudioCatalogue('zh');

afterEach(cleanup);

function renderTextField(locale: SupportedLocale) {
  render(
    <ObjectFieldInspector
      type="object"
      name="account"
      draft={{
        name: 'account',
        fields: {
          notes: { type: 'text', label: 'Notes', description: 'What the note is for', inlineHelpText: 'Shown under the field' },
        },
      }}
      selection={{ kind: 'field', id: 'notes' }}
      onPatch={vi.fn()}
      onClearSelection={vi.fn()}
      onSelectionChange={vi.fn()}
      readOnly={false}
      locale={locale}
    />,
  );
}

describe('objectstack#26732 — the field inspector names its Description and Help text textareas', () => {
  it('en: each textarea is found by its label and holds its own key', () => {
    renderTextField('en-US');
    const description = screen.getByRole('textbox', { name: t('designer.field.description', 'en-US') });
    const helpText = screen.getByRole('textbox', { name: t('designer.field.helpText', 'en-US') });
    expect(description.tagName).toBe('TEXTAREA');
    expect(description).toHaveValue('What the note is for');
    expect(helpText.tagName).toBe('TEXTAREA');
    expect(helpText).toHaveValue('Shown under the field');
    expect(screen.getByLabelText(t('designer.field.description', 'en-US'))).toBe(description);
  });

  it('zh: the same textareas carry the Chinese labels as their names', () => {
    renderTextField('zh-CN');
    const name = t('designer.field.description', 'zh-CN');
    // The zh catalogue is resident, so this is the Chinese label, not the en fallback.
    expect(name).toBe('描述');
    expect(screen.getByRole('textbox', { name })).toHaveValue('What the note is for');
    expect(screen.getByRole('textbox', { name: t('designer.field.helpText', 'zh-CN') })).toHaveValue(
      'Shown under the field',
    );
  });
});
