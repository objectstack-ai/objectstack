// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack-ai/objectstack#27446 — `/forms/NAME` for a form that does not
 * exist rendered the loader's English throw, `Form metadata not found:
 * view/NAME`, verbatim in the page body, whatever the session language.
 *
 * The internal loader now tells a 404 from the `/meta/view` read apart from
 * every other load failure, and the page draws the console's shared
 * not-found state for it — the copy and pack keys of the catch-all route
 * (`console.notFound.*`) — in the session language. Every other load failure
 * keeps the error banner (the `CONTROL` case).
 *
 * No `I18nProvider` is wrapped around the route, for the reason
 * `FormPage.chromeI18n-11039.test.tsx` gives: `createI18n` registers the
 * process-global instance every unwrapped consumer reads.
 */

import { describe, expect, it, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { createI18n } from '@object-ui/i18n';
import { FormPage } from './FormPage';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

/** Answers the `/meta/view` read with `status`; nothing else is reachable. */
function stubViewRead(status: number) {
  return vi.fn(async (url: string) => {
    if (!String(url).includes('/meta/view/no_such_form')) throw new Error(`unstubbed fetch: ${url}`);
    const body = { error: { code: 'RESOURCE_NOT_FOUND', message: 'Metadata item not found or access denied.' } };
    return {
      ok: status >= 200 && status < 300,
      status,
      statusText: 'Error',
      json: async () => body,
      text: async () => JSON.stringify(body),
    } as unknown as Response;
  });
}

function renderMissingForm() {
  return render(
    <MemoryRouter initialEntries={['/forms/no_such_form']}>
      <Routes>
        <Route path="/forms/:name" element={<FormPage mode="internal" />} />
      </Routes>
    </MemoryRouter>,
  );
}

function inLanguage(language: string) {
  createI18n({ defaultLanguage: language, detectBrowserLanguage: false });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('FormPage: a missing form renders the shared localized not-found state (#27446)', () => {
  it('zh: the not-found state is the zh pack\'s, and no English reaches the page', async () => {
    inLanguage('zh');
    vi.stubGlobal('fetch', stubViewRead(404));
    renderMissingForm();

    const state = await screen.findByTestId('form-not-found');
    expect(state).toHaveTextContent('页面不存在');
    expect(state).toHaveTextContent('你访问的链接与该应用中的任何视图都不匹配。');
    expect(screen.getByRole('button', { name: '返回' })).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/[A-Za-z]{3,}/);
  });

  it('en: the same state in English', async () => {
    inLanguage('en');
    vi.stubGlobal('fetch', stubViewRead(404));
    renderMissingForm();

    const state = await screen.findByTestId('form-not-found');
    expect(state).toHaveTextContent('Page not found');
    expect(screen.getByRole('button', { name: 'Go back' })).toBeInTheDocument();
    expect(document.body.textContent).not.toContain('Form metadata not found');
  });

  it('CONTROL: a load failure that is not a 404 keeps the error banner', async () => {
    inLanguage('zh');
    vi.stubGlobal('fetch', stubViewRead(500));
    renderMissingForm();

    expect(await screen.findByText(/Could not load form metadata \(500\)/)).toBeInTheDocument();
    expect(screen.queryByTestId('form-not-found')).not.toBeInTheDocument();
  });
});
