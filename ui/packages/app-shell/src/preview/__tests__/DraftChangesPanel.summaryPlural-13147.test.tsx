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
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { createI18n, I18nProvider } from '@object-ui/i18n';

import { DEFAULT_METADATA_TYPE_REGISTRY } from '@objectstack/spec/kernel';

import { COUNTED_DRAFT_TYPES, DraftChangesPanel } from '../DraftChangesPanel';
// Warmed at module scope: the sheet's security lint loads it with a dynamic
// import, and that first transform must not be paid inside a `findBy` window.
import '@objectstack/lint';

type Row = { type: string; name: string };

function stubFetch(rows: Row[], draftBody: Record<string, unknown> = { name: 'x' }) {
  const drafts = rows.map((r) => ({ ...r, packageId: 'com.x', label: r.name }));
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body });
      if (url.includes('/_drafts')) return ok({ drafts });
      if (url.includes('state=draft')) return ok(draftBody);
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

async function summaryFor(rows: Row[], lang: 'en' | 'zh' = 'en', draftBody?: Record<string, unknown>) {
  stubFetch(rows, draftBody);
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

  it('objectstack#29902: three hook drafts read "3 items · 3 hooks"', async () => {
    const summary = await summaryFor([
      { type: 'hook', name: 'h_a' },
      { type: 'hook', name: 'h_b' },
      { type: 'hook', name: 'h_c' },
    ]);
    expect(summary).toHaveTextContent(/^3 items · 3 hooks$/);
  });

  it('CONTROL: a type with no count family keeps its raw name, unpluralised', async () => {
    const summary = await summaryFor([
      { type: 'st_unknown_kind', name: 'u_a' },
      { type: 'st_unknown_kind', name: 'u_b' },
    ]);
    expect(summary).toHaveTextContent(/^2 items · 2 st_unknown_kind$/);
  });
});

describe('Pending changes — every type a runtime author can draft reads through the packs', () => {
  it('the count table names every type the spec registry lets a runtime author create', () => {
    const draftable = DEFAULT_METADATA_TYPE_REGISTRY.filter((e) => e.allowRuntimeCreate).map((e) => e.type);
    expect(draftable.length).toBeGreaterThan(0);
    expect(draftable.filter((type) => !COUNTED_DRAFT_TYPES.includes(type))).toEqual([]);
  });

  it('zh: a field mapping and a seed read their zh names, in the summary and in the group headings', async () => {
    const summary = await summaryFor(
      [
        { type: 'mapping', name: 'm_a' },
        { type: 'seed', name: 's_a' },
      ],
      'zh',
    );
    await waitFor(() => expect(summary).toHaveTextContent(/^2 项 · 字段映射 1 · 种子数据 1$/));
    const headings = screen.getAllByRole('heading', { level: 4 }).map((h) => h.textContent);
    expect(headings).toEqual(['字段映射 1', '种子数据 1']);
  });

  it('en: the same drafts read "2 items · 1 field mapping · 1 seed data set"', async () => {
    const summary = await summaryFor([
      { type: 'mapping', name: 'm_a' },
      { type: 'seed', name: 's_a' },
    ]);
    expect(summary).toHaveTextContent(/^2 items · 1 field mapping · 1 seed data set$/);
  });
});

describe('Pending changes — a pre-publish security finding reads in the console language', () => {
  /** An object draft that never authored its sharing baseline: `security-owd-unset`. */
  const OWD_LESS = { name: 'crmext_visit', label: 'Visit', fields: { name: { type: 'text', label: 'Name' } } };

  it('zh: the row reads the zh verdict of its rule, and the rule\'s own text stays on its tooltip', async () => {
    await summaryFor([{ type: 'object', name: 'crmext_visit' }], 'zh', OWD_LESS);
    const block = await screen.findByTestId('draft-security-problems', undefined, { timeout: 8000 });
    await waitFor(() => expect(block.textContent).toContain('未声明记录共享模型（sharingModel）'));
    const row = within(block).getByRole('listitem');
    expect(row.getAttribute('title')).toMatch(/declares no sharingModel/);
  });
});
