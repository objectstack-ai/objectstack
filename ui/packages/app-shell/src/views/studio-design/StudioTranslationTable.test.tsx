// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#30285 — Studio's translation table, mounted over a package read
 * through the metadata client and the language served through the SDK.
 *
 * Pinned:
 *  - a row per declared string, grouped by item, with its source text, the
 *    platform object the package points at (`sys_user`) included;
 *  - the count of what is untranslated, and the filter that shows only that;
 *  - what the language serves from another bundle counts as translated, and
 *    an answer in another (fallback) language does not;
 *  - typing a translation hands the item back with the value at the row's key;
 *  - no "no custom renderer, editing as JSON" notice: JSON is the advanced view.
 */

import * as React from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';

const DECLARED: Record<string, Array<Record<string, unknown>>> = {
  object: [
    {
      name: 'crm_account',
      label: 'Account',
      fields: {
        tier: { type: 'select', label: 'Tier', options: [{ value: 'gold', label: 'Gold' }] },
        owner: { type: 'lookup', label: 'Owner', reference: 'sys_user' },
      },
    },
  ],
  app: [{ name: 'crm', label: 'CRM', navigation: [] }],
};
const PLATFORM: Record<string, Record<string, unknown>> = { sys_user: { name: 'sys_user', label: 'User', fields: {} } };

const mockClient = {
  list: vi.fn(async (type: string) => DECLARED[type] ?? []),
  layered: vi.fn(async (type: string, name: string, options?: { packageId?: string }) => {
    const doc = options?.packageId ? (DECLARED[type] ?? []).find((d) => d.name === name) : PLATFORM[name];
    return { code: doc ?? null, effective: doc ?? null };
  }),
};
let servedAnswer: { locale: string; translations: Record<string, unknown> } = { locale: 'vi-VN', translations: {} };
const getTranslations = vi.fn(async () => servedAnswer);

vi.mock('../metadata-admin/useMetadata', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../metadata-admin/useMetadata')>();
  return { ...mod, useMetadataClient: () => mockClient };
});
vi.mock('@object-ui/react', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@object-ui/react')>();
  const adapter = { getClient: () => ({ i18n: { getTranslations } }) };
  return { ...mod, useAdapter: () => adapter };
});

import { StudioTranslationTable } from './StudioTranslationTable';

function Harness({ initial, onSeen }: { initial: Record<string, unknown>; onSeen?: (d: Record<string, unknown>) => void }) {
  const [draft, setDraft] = React.useState(initial);
  return (
    <StudioTranslationTable
      packageId="com.example.crm"
      draft={draft}
      onChange={(next) => {
        onSeen?.(next);
        setDraft(next);
      }}
      readOnly={false}
      locale="en"
    />
  );
}

const rowFor = (key: string) => document.querySelector(`[data-testid="studio-translation-row"][data-key="${key}"]`) as HTMLElement;

beforeEach(() => {
  servedAnswer = { locale: 'vi-VN', translations: {} };
  mockClient.list.mockClear();
  mockClient.layered.mockClear();
});

describe('StudioTranslationTable', () => {
  it('lists the declared strings by item, the platform object pointed at included, with the untranslated count', async () => {
    render(<Harness initial={{ name: 'crm_vi', locale: 'vi-VN', objects: { crm_account: { label: 'Tài khoản' } } }} />);
    const count = await screen.findByTestId('studio-translation-count');
    const groups = screen.getAllByTestId('studio-translation-group').map((g) => g.getAttribute('data-group'));
    expect(groups).toEqual(expect.arrayContaining(['objects.crm_account', 'objects.sys_user', 'apps.crm']));
    expect(within(rowFor('objects.sys_user.label')).getByText('User')).toBeTruthy();
    expect(within(rowFor('objects.crm_account.fields.tier.options.gold')).getByText('Gold')).toBeTruthy();
    expect(rowFor('objects.crm_account.label').getAttribute('data-state')).toBe('here');
    const total = Number(count.getAttribute('data-total'));
    expect(Number(count.getAttribute('data-untranslated'))).toBe(total - 1);
    expect(count.textContent).toBe(`${total - 1} of ${total} untranslated`);
    expect(document.body.textContent).not.toMatch(/custom renderer|JSON editing/i);
  });

  it('shows only the untranslated rows when filtered', async () => {
    render(<Harness initial={{ name: 'crm_vi', locale: 'vi-VN', objects: { crm_account: { label: 'Tài khoản' } } }} />);
    await screen.findByTestId('studio-translation-count');
    fireEvent.click(screen.getByTestId('studio-translation-only-missing'));
    const states = screen.getAllByTestId('studio-translation-row').map((r) => r.getAttribute('data-state'));
    expect(states.length).toBeGreaterThan(0);
    expect(new Set(states)).toEqual(new Set(['missing']));
    expect(rowFor('objects.crm_account.label')).toBeNull();
  });

  it('counts what the language serves from another bundle as translated, but not a fallback language', async () => {
    servedAnswer = { locale: 'vi-VN', translations: { objects: { sys_user: { label: 'Người dùng' } } } };
    const { unmount } = render(<Harness initial={{ name: 'crm_vi', locale: 'vi-VN' }} />);
    await waitFor(() => expect(rowFor('objects.sys_user.label')?.getAttribute('data-state')).toBe('elsewhere'));
    unmount();

    servedAnswer = { locale: 'en', translations: { objects: { sys_user: { label: 'User' } } } };
    render(<Harness initial={{ name: 'crm_vi', locale: 'vi-VN' }} />);
    await screen.findByTestId('studio-translation-count');
    await waitFor(() => expect(getTranslations).toHaveBeenCalledWith('vi-VN'));
    expect(rowFor('objects.sys_user.label').getAttribute('data-state')).toBe('missing');
  });

  it("hands the item back with the typed translation at the row's key", async () => {
    const seen = vi.fn();
    render(<Harness initial={{ name: 'crm_vi', label: 'Tiếng Việt', locale: 'vi-VN' }} onSeen={seen} />);
    await screen.findByTestId('studio-translation-count');
    fireEvent.change(within(rowFor('objects.sys_user.label')).getByTestId('studio-translation-input'), {
      target: { value: 'Người dùng' },
    });
    expect(seen).toHaveBeenLastCalledWith({
      name: 'crm_vi',
      label: 'Tiếng Việt',
      locale: 'vi-VN',
      objects: { sys_user: { label: 'Người dùng' } },
    });
    expect(rowFor('objects.sys_user.label').getAttribute('data-state')).toBe('here');
  });

  it('keeps the JSON as an advanced view of the translation groups', async () => {
    render(<Harness initial={{ name: 'crm_vi', locale: 'vi-VN', messages: { hello: 'Xin chào' } }} />);
    await screen.findByTestId('studio-translation-count');
    const json = screen.getByTestId('studio-translation-json-input') as HTMLTextAreaElement;
    expect(JSON.parse(json.value)).toEqual({ messages: { hello: 'Xin chào' } });
  });
});
