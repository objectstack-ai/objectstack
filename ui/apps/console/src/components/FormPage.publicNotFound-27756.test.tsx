// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack-ai/objectstack#27756 — the public `/f/:slug` route printed the
 * loader's English throw, `Failed to load form (STATUS): BODY`, to an
 * anonymous visitor in every session language, server body included.
 *
 * A 404 from the public resolver now draws the console's shared not-found
 * state (`console.notFound.*`), as the internal route does since #27446, with
 * no "Go back": a guest from a shared link has no console page behind it.
 * Every other failure keeps a banner, in the session language
 * (`form.errorLoading`), and the server body never reaches the page.
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

/** A server body no visitor may see; the cases assert it never renders. */
const SERVER_DETAIL = 'No public form configured at /forms/no_such_slug';

/** Answers the public resolver with `status`; nothing else is reachable. */
function stubResolver(status: number) {
  return vi.fn(async (url: string) => {
    if (!String(url).includes('/forms/no_such_slug')) throw new Error(`unstubbed fetch: ${url}`);
    const body = { code: status === 404 ? 'FORM_NOT_FOUND' : 'INTERNAL_ERROR', error: SERVER_DETAIL };
    return {
      ok: status >= 200 && status < 300,
      status,
      statusText: 'Error',
      json: async () => body,
      text: async () => JSON.stringify(body),
    } as unknown as Response;
  });
}

function renderMissingPublicForm() {
  return render(
    <MemoryRouter initialEntries={['/f/no_such_slug']}>
      <Routes>
        <Route path="/f/:slug" element={<FormPage mode="public" />} />
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

describe('FormPage: a missing public form renders the shared localized not-found state (#27756)', () => {
  it('zh: the not-found state is the zh pack\'s, and no English reaches the page', async () => {
    inLanguage('zh');
    vi.stubGlobal('fetch', stubResolver(404));
    renderMissingPublicForm();

    const state = await screen.findByTestId('form-not-found');
    expect(state).toHaveTextContent('页面不存在');
    expect(state).toHaveTextContent('你访问的链接与该应用中的任何视图都不匹配。');
    expect(document.body.textContent).not.toMatch(/[A-Za-z]{3,}/);
  });

  it('en: the same state in English, with no "Go back" for the guest', async () => {
    inLanguage('en');
    vi.stubGlobal('fetch', stubResolver(404));
    renderMissingPublicForm();

    const state = await screen.findByTestId('form-not-found');
    expect(state).toHaveTextContent('Page not found');
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(document.body.textContent).not.toContain('Failed to load form');
    expect(document.body.textContent).not.toContain(SERVER_DETAIL);
  });

  it('CONTROL: a failure that is not a 404 keeps a banner, in zh, without the server body', async () => {
    inLanguage('zh');
    vi.stubGlobal('fetch', stubResolver(500));
    renderMissingPublicForm();

    const banner = await screen.findByTestId('form-load-failed');
    expect(banner).toHaveTextContent('表单加载失败');
    expect(screen.queryByTestId('form-not-found')).not.toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/[A-Za-z]{3,}/);
  });
});
