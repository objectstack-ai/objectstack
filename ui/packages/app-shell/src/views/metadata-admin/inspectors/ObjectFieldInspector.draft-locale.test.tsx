// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// A draft object AND a published one, so the assertions can tell the two
// apart. The picker reads the draft-overlaid list (objectui#11783), where a
// draft is served with its `_draft` mark; this one has no label of its own.
vi.mock('../useMetadata', () => ({
  useMetadataClient: () => ({
    withPreviewDrafts: () => ({
      list: vi.fn().mockResolvedValue([
        { name: 'crm_account', label: 'Account' },
        { name: 'crm_quote', _draft: true },
      ]),
    }),
  }),
}));

vi.mock('../previews/useObjectFields', () => ({
  useObjectFields: () => ({ fields: [], loading: false, error: null }),
}));

import { ObjectFieldInspector } from './ObjectFieldInspector';
// The inspector's `locale` prop is the closed `'en-US' | 'zh-CN'` union, not a
// bare string — the loop below iterates exactly those two, so annotating the
// helper keeps the array's element type from widening back to `string`.
import { t, type SupportedLocale } from '../i18n';

afterEach(cleanup);

/** The lookup branch is the only one that renders the object picker. */
function renderLookup(locale: SupportedLocale) {
  return render(
    <ObjectFieldInspector
      type="object"
      name="account"
      draft={{ name: 'account', fields: { owner: { type: 'lookup', label: 'Owner' } } }}
      selection={{ kind: 'field', id: 'owner' }}
      onPatch={vi.fn()}
      onClearSelection={vi.fn()}
      onSelectionChange={vi.fn()}
      readOnly={false}
      locale={locale}
    />,
  );
}

/** Open the Related-object picker (its label read in `locale`) and wait for the named option. */
async function optionFor(container: HTMLElement, name: string, locale: SupportedLocale): Promise<HTMLElement> {
  const text = t('designer.field.relatedObject', locale);
  const label = [...container.querySelectorAll('label')].find((l) => l.textContent === text)!;
  await userEvent.click(label.parentElement!.querySelector('input')!);
  return waitFor(() => {
    const found = container.querySelector(`[data-object-name="${name}"]`);
    expect(found).toBeTruthy();
    return found as HTMLElement;
  });
}

async function draftMarker(container: HTMLElement, locale: SupportedLocale): Promise<string> {
  const opt = await optionFor(container, 'crm_quote', locale);
  return opt.querySelector('[data-draft-marker]')?.textContent ?? '';
}

const CJK = /[一-鿿]/;

describe('ObjectFieldInspector — draft-object marker is localized', () => {
  it('renders no CJK in the draft marker under an English locale', async () => {
    const { container } = renderLookup('en-US');
    const marker = await draftMarker(container, 'en-US');

    expect(marker).toBe('(draft)');
    // The regression this pins: the suffix used to be a bare `(草稿)`
    // literal, so an English user saw `crm_quote (草稿)`.
    expect(marker).not.toMatch(CJK);
  });

  it('still renders the Chinese marker under a zh locale', async () => {
    const { container } = renderLookup('zh-CN');
    expect(await draftMarker(container, 'zh-CN')).toBe('(草稿)');
  });

  it('leaves published objects unmarked in both locales', async () => {
    for (const locale of ['en-US', 'zh-CN'] as const) {
      const { container, unmount } = renderLookup(locale);
      const opt = await optionFor(container, 'crm_account', locale);
      expect(opt.querySelector('[data-draft-marker]')).toBeNull();
      expect(opt).toHaveTextContent('Account');
      expect(opt).toHaveTextContent('crm_account');
      unmount();
    }
  });
});
