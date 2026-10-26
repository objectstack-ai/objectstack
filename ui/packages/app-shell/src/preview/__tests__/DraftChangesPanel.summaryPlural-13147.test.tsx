/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#13147 — the confirm posture's summary line read "2 items · 2 flow":
 * each type segment interpolated the raw metadata type into a count-blind
 * `{{n}} {{type}}`, so no pack could agree the word with its number.
 *
 * A known type now reads through its own i18next count family
 * (`preview.changes.typeCount.*`); a type with no row keeps the raw-name
 * segment. These render the panel against a REAL i18next instance and the
 * shipped packs — `DraftChangesPanel.posture-12517.test.tsx` stubs `t()` with
 * a plain interpolator that cannot plural-select, so it cannot see this.
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

async function summaryFor(rows: Row[], lang: 'en' | 'zh' = 'en') {
  stubFetch(rows);
  const i18n = createI18n({ defaultLanguage: lang, detectBrowserLanguage: false });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <I18nProvider instance={i18n} persistLanguage={false}>
      {children}
    </I18nProvider>
  );
  render(
    <DraftChangesPanel open onOpenChange={() => {}} packageId="com.x" onPublish={() => {}} posture="confirm" />,
    { wrapper },
  );
  return screen.findByTestId('draft-changes-summary');
}

describe('Pending changes summary — each type agrees with its count (objectui#13147)', () => {
  it('two flow drafts read "2 items · 2 flows"', async () => {
    const summary = await summaryFor([
      { type: 'flow', name: 'f_a' },
      { type: 'flow', name: 'f_b' },
    ]);
    expect(summary).toHaveTextContent(/^2 items · 2 flows$/);
  });

  it('one flow and three views read "4 items · 1 flow · 3 views"', async () => {
    const summary = await summaryFor([
      { type: 'flow', name: 'f_a' },
      { type: 'view', name: 'v_a' },
      { type: 'view', name: 'v_b' },
      { type: 'view', name: 'v_c' },
    ]);
    expect(summary).toHaveTextContent(/^4 items · 1 flow · 3 views$/);
  });

  it('zh: the type reads its zh name with the count, in the pack\'s own order', async () => {
    const summary = await summaryFor(
      [
        { type: 'flow', name: 'f_a' },
        { type: 'flow', name: 'f_b' },
      ],
      'zh',
    );
    // The zh catalogue arrives asynchronously; the line re-renders when it lands.
    await waitFor(() => expect(summary).toHaveTextContent(/^2 项 · 流程 2$/));
  });

  it('CONTROL: a type with no count family keeps its raw name, unpluralised', async () => {
    const summary = await summaryFor([
      { type: 'st_unknown_kind', name: 'u_a' },
      { type: 'st_unknown_kind', name: 'u_b' },
    ]);
    expect(summary).toHaveTextContent(/^2 items · 2 st_unknown_kind$/);
  });
});
