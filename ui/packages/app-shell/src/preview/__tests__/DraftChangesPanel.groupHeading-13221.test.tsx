/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#13221 — each per-type group heading in Pending changes printed the
 * raw metadata type with its count ("flow · 2", uppercased by CSS to
 * "FLOW · 2"): not a display name, and English in every locale.
 *
 * A heading now names its type by the same count-aware segment the summary
 * line reads (`preview.changes.typeCount.*`, objectui#13147); a type with no
 * count family keeps its raw name, as the summary does. These render the panel
 * against a REAL i18next instance and the shipped packs, so the heading's text
 * is what the pack says, not a stub's echo of a default.
 */

import '@testing-library/jest-dom/vitest';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { createI18n, I18nProvider } from '@object-ui/i18n';

import { DraftChangesPanel } from '../DraftChangesPanel';

type Row = { type: string; name: string };

function stubFetch(rows: Row[]) {
  const drafts = rows.map((r) => ({ ...r, packageId: 'com.x', label: r.name }));
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body });
      if (url.includes('/_drafts')) return ok({ drafts });
      if (url.includes('state=draft')) return ok({ name: 'x' });
      // Every published-list read: nothing is published, so every row is New.
      if (/\/meta\/\w+(\?|$)/.test(url)) return ok([]);
      return { ok: false, status: 404, json: async () => ({}) };
    }) as unknown as typeof fetch,
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

async function headingsFor(rows: Row[], lang: 'en' | 'zh' = 'en') {
  stubFetch(rows);
  const i18n = createI18n({ defaultLanguage: lang, detectBrowserLanguage: false });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <I18nProvider instance={i18n} persistLanguage={false}>
      {children}
    </I18nProvider>
  );
  render(<DraftChangesPanel open onOpenChange={() => {}} packageId="com.x" />, { wrapper });
  const list = await screen.findByTestId('draft-changes-list');
  await waitFor(() => expect(list.querySelectorAll('h4').length).toBeGreaterThan(0));
  return list;
}

const headingTexts = (list: HTMLElement) => [...list.querySelectorAll('h4')].map((h) => h.textContent);

describe('Pending changes group headings name their type in the user\'s locale (objectui#13221)', () => {
  it('two flow drafts head their group "2 flows"', async () => {
    const list = await headingsFor([
      { type: 'flow', name: 'f_a' },
      { type: 'flow', name: 'f_b' },
    ]);
    expect(headingTexts(list)).toEqual(['2 flows']);
  });

  it('zh: two flow drafts head their group with the zh name and the count', async () => {
    const list = await headingsFor(
      [
        { type: 'flow', name: 'f_a' },
        { type: 'flow', name: 'f_b' },
      ],
      'zh',
    );
    // The zh catalogue arrives asynchronously; the heading re-renders when it lands.
    await waitFor(() => expect(headingTexts(list)).toEqual(['流程 2']));
  });

  it('CONTROL: a type with no count family keeps its raw name, as the summary does', async () => {
    const list = await headingsFor([
      { type: 'st_unknown_kind', name: 'u_a' },
      { type: 'st_unknown_kind', name: 'u_b' },
    ]);
    expect(headingTexts(list)).toEqual(['2 st_unknown_kind']);
  });
});
